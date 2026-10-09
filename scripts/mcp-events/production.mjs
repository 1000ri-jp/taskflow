import { createHash, randomUUID } from 'node:crypto';
import { signedPost } from './core.mjs';
import { subscriptionStore } from './subscription-store.mjs';
import { PILOT_PROJECT, RETENTION_MS } from './policy.mjs';
import { TASK_EVENT_FIELDS as fields } from './task-fields.generated.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
function canonical(value) {
  if (value === undefined) return null;
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

export function taskEvent({ id, time, projectId, taskId, before, after, detail }) {
  if (!id || projectId !== PILOT_PROJECT || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId) ||
      !Number.isFinite(Date.parse(time)) || (!before && !after)) return null;
  const changedFields = fields.filter(k => JSON.stringify(canonical(before?.[k])) !== JSON.stringify(canonical(after?.[k])));
  if (detail) {
    if (!['comments', 'checklists', 'attachments'].includes(detail.resource) || !/^[A-Za-z0-9_-]{1,128}$/.test(detail.id ?? '') ||
        (!detail.before && !detail.after) || JSON.stringify(canonical(detail.before)) === JSON.stringify(canonical(detail.after))) return null;
    changedFields.push(detail.resource);
  }
  if (before && after && !changedFields.length) return null;
  const value = after ?? before;
  return {
    event: { eventId: 'task_' + hash(JSON.stringify([projectId, taskId, id])), name: 'task.updated', timestamp: new Date(time).toISOString(),
      data: { project_id: projectId, task_id: taskId, title: typeof value.title === 'string' ? value.title.slice(0, 1000) : '（無題）',
        is_completed: value.isCompleted === true, synthetic: false }, cursor: null },
    changeType: !before ? 'created' : !after ? 'deleted' : 'updated', changedFields,
    ...(detail ? { resource: detail.resource, resourceId: detail.id, resourceChangeType: !detail.before ? 'created' : !detail.after ? 'deleted' : 'updated' } : {}),
  };
}

// Check the actual grant, binding, Firebase revocation, and both membership representations on every delivery.
export async function connectionAuthorized(db, auth, connection, config, now = Date.now) {
  if (!config.enabled || config.projectId !== PILOT_PROJECT || connection?.mode !== 'production' ||
      connection.projectId !== PILOT_PROJECT || connection.userId !== config.allowedUid ||
      connection.clientId !== config.clientId || connection.resource !== config.resource ||
      !Number.isFinite(millis(connection.expiresAt)) || millis(connection.expiresAt) <= now()) return false;
  const [operations, binding, grant, project, members, user, profile] = await Promise.all([
    db.collection('mcpEventOperations').doc('pilot').get(),
    db.collection('mcpOAuthGrants').doc(connection.bindingId).get(),
    db.collection('mcpOAuthState').doc(connection.grantRecordId).get(),
    db.collection('projects').doc(PILOT_PROJECT).get(),
    db.collection('projects').doc(PILOT_PROJECT).collection('members').where('userId', '==', connection.userId).limit(1).get(),
    auth.getUser(connection.userId).catch(error => {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    }),
    db.collection('users').doc(connection.userId).get(),
  ]);
  const b = binding.data(), g = grant.data(), p = project.data();
  return operations.data()?.stopped !== true && b?.mode === 'production' && b.userId === connection.userId &&
    b.projectId === connection.projectId && b.clientId === config.clientId && b.resource === config.resource &&
    Number.isFinite(millis(b.expiresAt)) && millis(b.expiresAt) > now() &&
    Number.isFinite(millis(g?.expiresAt)) && millis(g.expiresAt) > now() &&
    profile.exists && Boolean(user) && !user.disabled && user.emailVerified && user.email?.endsWith('@1000ri.jp') &&
    user.providerData?.some(provider => provider.providerId === 'google.com') &&
    Number.isFinite(b.authTime) && b.authTime >= Date.parse(user.tokensValidAfterTime) / 1000 &&
    p?.memberIds?.includes(connection.userId) && !members.empty &&
    ['viewer', 'editor', 'admin'].includes(members.docs[0].data().role);
}

export function deliveryOutcome(status, attempts, now) {
  if (status >= 200 && status < 300) return { state: 'delivered', completedAt: now };
  if (status === 410) return { state: 'cancelled', reason: 'receiver_gone', completedAt: now };
  const transient = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
  if (!transient || attempts >= 8) return { state: 'dead', reason: status === 413 ? 'payload_too_large' : 'delivery_failed', completedAt: now };
  return { state: 'pending', dueAt: now + Math.min(3600000, 15000 * 2 ** (attempts - 1)) };
}

export function createProductionPipeline({ db, auth, config, key, post, now = Date.now, report = () => {} }) {
  const deliveries = db.collection('mcpEventDeliveries');
  const principal = owner => db.collection('mcpEventPrincipals').doc(owner);
  const subscriptions = owner => subscriptionStore(principal(owner).collection('subscriptions'), key);
  return {
    async capture(change) {
      if (!config.enabled) return { captured: 0 };
      const normalized = taskEvent(change);
      if (!normalized) return { captured: 0 };
      const occurredAt = Date.parse(normalized.event.timestamp);
      // Delayed triggers outside retention are not replayable; log metadata only.
      if (occurredAt + RETENTION_MS <= now()) return { captured: 0, expired: true };
      const candidates = await db.collection('mcpEventConnections').where('projectId', '==', PILOT_PROJECT).get();
      let captured = 0;
      for (const doc of candidates.docs) {
        const connection = doc.data();
        if (!await connectionAuthorized(db, auth, connection, config, now) || occurredAt < connection.createdAt) continue;
        const active = (await subscriptions(doc.id).values()).filter(sub => sub.expiresAt > now() &&
          sub.projectId === PILOT_PROJECT && Number.isFinite(sub.createdAt) && sub.createdAt <= occurredAt);
        // Retain the authorized feed during a subscription renewal interruption.
        // Only active callbacks get jobs; reconnect can wake Dot to drain backlog.
        const journalRef = principal(doc.id).collection('journal').doc(normalized.event.eventId);
        const expiresAt = Math.min(occurredAt + RETENTION_MS, millis(connection.expiresAt));
        const created = await db.runTransaction(async tx => {
          // Trigger retries never reset an acknowledgement or delivery state.
          if ((await tx.get(journalRef)).exists) return false;
          tx.create(journalRef, { ...normalized, acknowledged: false, occurredAt, expiresAt,
            mcpExpiresAt: new Date(expiresAt) });
          for (const sub of active) {
            const id = hash(JSON.stringify([doc.id, sub.id, normalized.event.eventId]));
            tx.create(deliveries.doc(id), { owner: doc.id, subscriptionId: sub.id, eventId: normalized.event.eventId,
              state: 'pending', attempts: 0, dueAt: now(), expiresAt, mcpExpiresAt: new Date(expiresAt) });
          }
          return true;
        });
        if (created) captured++;
      }
      return { captured };
    },
    async process(id) {
      if (!config.enabled) return { state: 'disabled' };
      const ref = deliveries.doc(id), lease = randomUUID();
      const job = await db.runTransaction(async tx => {
        const record = (await tx.get(ref)).data();
        if (!record || record.state !== 'pending' || record.dueAt > now()) return null;
        if (record.expiresAt <= now()) {
          tx.update(ref, { state: 'dead', reason: 'retention_expired', completedAt: now() }); return null;
        }
        // dueAt is also the lease deadline; crashed attempts become eligible again.
        const attempts = record.attempts + 1;
        tx.update(ref, { lease, attempts, dueAt: now() + 60000 });
        return { ...record, attempts };
      });
      if (!job) return { state: 'skipped' };
      let outcome;
      let status = 0;
      try {
        const connection = (await db.collection('mcpEventConnections').doc(job.owner).get()).data();
        const store = subscriptions(job.owner);
        const sub = await store.get(job.subscriptionId);
        const journal = (await principal(job.owner).collection('journal').doc(job.eventId).get()).data();
        if (!sub || sub.expiresAt <= now() || !journal || journal.expiresAt <= now() ||
            !await connectionAuthorized(db, auth, connection, config, now) || sub.expiresAt <= now() || journal.expiresAt <= now()) {
          outcome = { state: 'cancelled', reason: 'authorization_or_subscription_ended', completedAt: now() };
        } else if (job.kind === 'recovery_wake' && journal.acknowledged) {
          outcome = { state: 'cancelled', reason: 'already_acknowledged', completedAt: now() };
        } else if (job.attempts > 8) {
          outcome = { state: 'dead', reason: 'attempt_limit', completedAt: now() };
        } else {
          // Recovery wakes have a distinct transport identity. The journal's source
          // eventId stays unchanged so Dot can still deduplicate and acknowledge it.
          const response = await signedPost(sub, journal.event, job.webhookId ?? journal.event.eventId, post, now);
          status = response.status;
          outcome = deliveryOutcome(status, job.attempts, now());
          if (status === 410) await store.delete(sub.id);
        }
      } catch (error) {
        // A deleted Firebase account ends access; transport/storage failures can recover.
        outcome = error.code === 'auth/user-not-found'
          ? { state: 'cancelled', reason: 'account_deleted', completedAt: now() }
          : deliveryOutcome(0, job.attempts, now());
      }
      const committed = await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.lease !== lease) return false;
        tx.update(ref, { ...outcome, status, lease: null }); return true;
      });
      const result = { state: outcome.state, status, attempts: job.attempts,
        ...(outcome.reason ? { reason: outcome.reason } : {}) };
      if (committed) report(result);
      return result;
    },
    async sweep() {
      if (!config.enabled) return { processed: 0 };
      const jobs = await deliveries.where('state', '==', 'pending').where('dueAt', '<=', now())
        .orderBy('dueAt').limit(100).get();
      // Bound outbound concurrency and execution time for this one-project pilot.
      for (let offset = 0; offset < jobs.docs.length; offset += 4) {
        await Promise.all(jobs.docs.slice(offset, offset + 4).map(doc => this.process(doc.id)));
      }
      return { processed: jobs.docs.length };
    },
  };
}

export async function enqueueCatchup(db, principalRef, owner, sub, now = Date.now) {
  const page = await listTaskUpdates(principalRef, sub.projectId, 1, now);
  if (!page.events.length) return;
  const event = page.events[0].event;
  const journalRef = principalRef.collection('journal').doc(event.eventId);
  const id = hash(JSON.stringify([owner, sub.id, event.eventId]));
  const ref = db.collection('mcpEventDeliveries').doc(id);
  const wakeId = hash(JSON.stringify([owner, sub.id, event.eventId, 'recovery_wake', sub.expiresAt]));
  const wakeRef = db.collection('mcpEventDeliveries').doc(wakeId);
  const guardRef = principalRef.collection('recoveryWakes').doc(sub.id);
  await db.runTransaction(async tx => {
    const [previousDoc, journalDoc, guardDoc, wakeDoc] = await Promise.all([
      tx.get(ref), tx.get(journalRef), tx.get(guardRef), tx.get(wakeRef),
    ]);
    const previous = previousDoc.data(), journal = journalDoc.data(), guard = guardDoc.data();
    if (!journal || journal.acknowledged || journal.expiresAt <= now() || sub.expiresAt <= now()) return;
    if (previous?.state === 'pending') return;
    const job = { owner, subscriptionId: sub.id, eventId: event.eventId, state: 'pending', attempts: 0,
      dueAt: now(), expiresAt: journal.expiresAt, mcpExpiresAt: new Date(journal.expiresAt) };
    if (previous?.state !== 'delivered') {
      tx.set(ref, job);
      return;
    }
    // A 2xx receipt does not prove that Dot ran. Renewing the same callback can
    // wake its unacknowledged backlog once, even when the original job delivered.
    // Keep a stable identity for this renewal and bound rapid repeated renewals.
    if (wakeDoc.exists || guard?.renewalExpiresAt === sub.expiresAt ||
        (Number.isFinite(guard?.lastWakeAt) && now() - guard.lastWakeAt < 60000)) return;
    if (guard?.deliveryId && (await tx.get(db.collection('mcpEventDeliveries').doc(guard.deliveryId))).data()?.state === 'pending') return;
    tx.create(wakeRef, { ...job, kind: 'recovery_wake', webhookId: 'wake_' + wakeId });
    tx.set(guardRef, { renewalExpiresAt: sub.expiresAt, lastWakeAt: now(), deliveryId: wakeId,
      mcpExpiresAt: new Date(journal.expiresAt) });
  });
}

export async function listTaskUpdates(principalRef, projectId, limit, now = Date.now) {
  const docs = await principalRef.collection('journal').where('acknowledged', '==', false)
    .where('expiresAt', '>', now()).orderBy('expiresAt').orderBy('occurredAt').limit(limit + 1).get();
  const records = docs.docs.map(doc => doc.data()).filter(r => r.expiresAt > now() && r.event?.data?.project_id === projectId);
  return { project_id: projectId, events: records.slice(0, limit).map(r => ({ event: r.event,
    change_type: r.changeType, changed_fields: r.changedFields,
    ...(r.resource ? { resource: r.resource, resource_id: r.resourceId, resource_change_type: r.resourceChangeType } : {}) })), has_more: records.length > limit, retention_days: 7 };
}

export async function acknowledgeTaskUpdates(db, principalRef, projectId, ids, now = Date.now, authorizationExpiresAt = Infinity) {
  return db.runTransaction(async tx => {
    const refs = ids.map(id => principalRef.collection('journal').doc(id));
    const records = await Promise.all(refs.map(ref => tx.get(ref)));
    // Validate the complete batch before any writes; missing/cross-grant IDs never succeed.
    if (authorizationExpiresAt <= now() || records.some(doc => !doc.exists || doc.data().expiresAt <= now() || doc.data().event?.data?.project_id !== projectId)) {
      throw new Error('Event unavailable');
    }
    refs.forEach(ref => tx.update(ref, { acknowledged: true, acknowledgedAt: now() }));
    return { acknowledged: ids.length };
  });
}
