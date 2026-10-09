// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { memoryFirestore } from './firestore.fixture.mjs';
import { taskEvent, deliveryOutcome, connectionAuthorized, createProductionPipeline, listTaskUpdates, acknowledgeTaskUpdates, enqueueCatchup } from '../../../scripts/mcp-events/production.mjs';
import { subscriptionStore } from '../../../scripts/mcp-events/subscription-store.mjs';
import { signature } from '../../../scripts/mcp-events/core.mjs';
import { PILOT_PROJECT, RETENTION_MS, authorizationMode } from '../../../scripts/mcp-events/policy.mjs';

let db, auth, config, connection, clock, pipeline, post, store;
const key = Buffer.alloc(32, 4), secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const change = patch => ({ id: 'fixture-cloud-event', time: new Date(clock).toISOString(), projectId: PILOT_PROJECT, taskId: 'fixture-task',
  before: { title: '以前の架空タイトル', isCompleted: false }, after: { title: '新しい架空タイトル', isCompleted: true }, ...patch });
const principal = () => db.collection('mcpEventPrincipals').doc('fixture-owner');
const jobs = () => [...db.records].filter(([path]) => path.startsWith('mcpEventDeliveries/'));
beforeEach(async () => {
  clock = Date.parse('2026-10-07T00:00:00Z');
  db = memoryFirestore();
  config = { enabled: true, projectId: PILOT_PROJECT, allowedUid: 'fixture-user', clientId: 'fixture-client', resource: 'https://slowth.example.test/api/mcp' };
  connection = { ...config, mode: 'production', userId: 'fixture-user', owner: 'fixture-owner', projectId: PILOT_PROJECT,
    expiresAt: new Date(clock + 30 * 86400000), createdAt: clock - 1000, bindingId: 'fixture-binding', grantRecordId: 'fixture-grant' };
  await db.collection('mcpEventConnections').doc('fixture-owner').set(connection);
  await db.collection('mcpOAuthGrants').doc('fixture-binding').set({ ...connection, authTime: clock / 1000 - 100 });
  await db.collection('mcpOAuthState').doc('fixture-grant').set({ expiresAt: connection.expiresAt });
  await db.collection('users').doc('fixture-user').set({});
  await db.collection('projects').doc(PILOT_PROJECT).set({ memberIds: ['fixture-user'] });
  await db.collection('projects').doc(PILOT_PROJECT).collection('members').doc('fixture-user').set({ userId: 'fixture-user', role: 'viewer' });
  auth = { getUser: vi.fn().mockResolvedValue({ emailVerified: true, email: 'fixture@1000ri.jp', disabled: false,
    providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: '2026-01-01T00:00:00Z' }) };
  post = vi.fn().mockResolvedValue({ status: 200 });
  store = subscriptionStore(principal().collection('subscriptions'), key);
  await store.set('fixture-sub', { id: 'fixture-sub', owner: 'fixture-owner', projectId: PILOT_PROJECT,
    url: 'https://receiver.example.test/fixture', secret, createdAt: clock - 500, expiresAt: clock + 86400000 });
  pipeline = createProductionPipeline({ db, auth, config, key, post, now: () => clock });
});

it('requires the production flag and exact read, identity, offline scopes', () => {
  expect(authorizationMode('events:read openid offline_access', false)).toBeNull();
  expect(authorizationMode('openid offline_access events:read', true)).toBe('production');
  for (const scope of ['events:read openid', 'events:test offline_access', 'events:read openid offline_access tasks:write', 'events:read openid offline_access openid']) expect(authorizationMode(scope, true)).toBeNull();
  expect(authorizationMode('events:test openid', true)).toBe('test');
});
it('captures create/update/delete, clips title and uses stable CloudEvent identity', () => {
  expect(taskEvent(change({ before: null })).changeType).toBe('created');
  expect(taskEvent(change()).changeType).toBe('updated');
  expect(taskEvent(change({ after: null })).changeType).toBe('deleted');
  expect(taskEvent(change()).event.eventId).toBe(taskEvent(change()).event.eventId);
  expect(taskEvent(change({ after: { title: 'x'.repeat(3000) } })).event.data.title).toHaveLength(1000);
  expect(taskEvent(change()).event.data.synthetic).toBe(false);
});
it('ignores other projects, timestamp-only updates and semantically equal records', () => {
  expect(taskEvent(change({ projectId: 'another-project' }))).toBeNull();
  expect(taskEvent(change({ before: { title: 'same', updatedAt: 1, workState: { a: 1, b: 2 } }, after: { title: 'same', updatedAt: 2, workState: { b: 2, a: 1 } } }))).toBeNull();
});
it('encrypts callback keys, retains rotation, and rejects tampering', async () => {
  await store.set('fixture-sub', { id: 'fixture-sub', secret, previousSecret: 'old-fixture-secret', expiresAt: clock + 1000 });
  const record = db.records.get('mcpEventPrincipals/fixture-owner/subscriptions/fixture-sub');
  expect(JSON.stringify(record)).not.toContain(secret); expect(record.secret).toBeUndefined();
  expect((await store.get('fixture-sub')).previousSecret).toBe('old-fixture-secret');
  record.deliveryKey.body = Buffer.alloc(32).toString('base64');
  await expect(store.get('fixture-sub')).rejects.toThrow();
});
it('persists journal and delivery before webhook, then survives new worker instances and duplicate capture', async () => {
  expect(await pipeline.capture(change())).toEqual({ captured: 1 });
  expect(post).not.toHaveBeenCalled();
  expect(await pipeline.capture(change())).toEqual({ captured: 0 });
  expect(jobs()).toHaveLength(1);
  const replacement = createProductionPipeline({ db, auth, config, key, post, now: () => clock });
  await replacement.sweep();
  expect(post).toHaveBeenCalledOnce(); expect(jobs()[0][1].state).toBe('delivered');
  expect((await listTaskUpdates(principal(), PILOT_PROJECT, 20, () => clock)).events).toHaveLength(1);
});
it('retains bursts and removes only acknowledged events, idempotently', async () => {
  for (let n = 0; n < 3; n++) await pipeline.capture(change({ id: 'fixture-' + n }));
  const page = await listTaskUpdates(principal(), PILOT_PROJECT, 2, () => clock);
  expect(page.events).toHaveLength(2); expect(page.has_more).toBe(true);
  const ids = page.events.map(row => row.event.eventId);
  expect(await acknowledgeTaskUpdates(db, principal(), PILOT_PROJECT, ids, () => clock)).toEqual({ acknowledged: 2 });
  expect(await acknowledgeTaskUpdates(db, principal(), PILOT_PROJECT, ids, () => clock)).toEqual({ acknowledged: 2 });
  expect((await listTaskUpdates(principal(), PILOT_PROJECT, 2, () => clock)).events).toHaveLength(1);
});
it('rejects an entire acknowledgement batch containing missing or cross-grant IDs', async () => {
  await pipeline.capture(change());
  const id = taskEvent(change()).event.eventId;
  await expect(acknowledgeTaskUpdates(db, principal(), PILOT_PROJECT, [id, 'task_missing'], () => clock)).rejects.toThrow();
  await expect(acknowledgeTaskUpdates(db, db.collection('mcpEventPrincipals').doc('other-grant'), PILOT_PROJECT, [id], () => clock)).rejects.toThrow();
  expect((await listTaskUpdates(principal(), PILOT_PROJECT, 20, () => clock)).events).toHaveLength(1);
});
it('filters expired journal rows before pagination without waiting for TTL deletion', async () => {
  await pipeline.capture(change());
  const id = taskEvent(change()).event.eventId;
  await principal().collection('journal').doc(id).update({ expiresAt: clock - 1 });
  await pipeline.capture(change({ id: 'fresh-fixture' }));
  expect((await listTaskUpdates(principal(), PILOT_PROJECT, 1, () => clock)).events[0].event.eventId).toBe(taskEvent(change({ id: 'fresh-fixture' })).event.eventId);
});
it('retries transient errors with the same ID/body and a new valid signing timestamp', async () => {
  post.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });
  await pipeline.capture(change()); const id = jobs()[0][0].split('/').at(-1);
  expect((await pipeline.process(id)).state).toBe('pending');
  expect((await pipeline.process(id)).state).toBe('skipped');
  clock += 60000;
  expect((await pipeline.process(id)).state).toBe('delivered');
  const first = post.mock.calls[0][1], second = post.mock.calls[1][1];
  expect(first.body).toBe(second.body); expect(first.headers['webhook-id']).toBe(second.headers['webhook-id']);
  expect(first.headers['webhook-timestamp']).not.toBe(second.headers['webhook-timestamp']);
  expect(second.headers['webhook-signature']).toBe(signature(secret, second.headers['webhook-id'], second.headers['webhook-timestamp'], second.body));
});
it.each([410, 413, 400, 401, 403])('does not retry permanent HTTP %s', async status => {
  post.mockResolvedValue({ status }); await pipeline.capture(change());
  const id = jobs()[0][0].split('/').at(-1);
  expect(['dead', 'cancelled']).toContain((await pipeline.process(id)).state);
  clock += 60000; await pipeline.process(id); expect(post).toHaveBeenCalledOnce();
  if (status === 410) expect(await store.get('fixture-sub')).toBeUndefined();
});
it.each([0, 408, 425, 429, 500, 503])('bounds retryable HTTP %s at eight attempts', status => {
  expect(deliveryOutcome(status, 7, clock).state).toBe('pending');
  expect(deliveryOutcome(status, 8, clock).state).toBe('dead');
});
it('leases simultaneous attempts so only one sends, and recovers a crashed lease', async () => {
  await pipeline.capture(change()); const id = jobs()[0][0].split('/').at(-1);
  const result = await Promise.all([pipeline.process(id), pipeline.process(id)]);
  expect(result.map(row => row.state).sort()).toEqual(['delivered', 'skipped']); expect(post).toHaveBeenCalledOnce();
  await db.collection('mcpEventDeliveries').doc(id).update({ state: 'pending', lease: 'crashed', dueAt: clock + 60000 });
  expect((await pipeline.process(id)).state).toBe('skipped'); clock += 60001;
  expect((await pipeline.process(id)).state).toBe('delivered'); expect(post).toHaveBeenCalledTimes(2);
});
it.each(['grant', 'binding', 'membership-array', 'membership-doc', 'user-profile', 'disabled-user', 'deleted-user', 'revoked-firebase', 'stop'])('stops queued delivery after %s revocation', async reason => {
  await pipeline.capture(change());
  if (reason === 'grant') await db.collection('mcpOAuthState').doc('fixture-grant').delete();
  if (reason === 'binding') await db.collection('mcpOAuthGrants').doc('fixture-binding').delete();
  if (reason === 'membership-array') await db.collection('projects').doc(PILOT_PROJECT).update({ memberIds: [] });
  if (reason === 'membership-doc') await db.collection('projects').doc(PILOT_PROJECT).collection('members').doc('fixture-user').delete();
  if (reason === 'user-profile') await db.collection('users').doc('fixture-user').delete();
  if (reason === 'disabled-user') auth.getUser.mockResolvedValue({ disabled: true });
  if (reason === 'deleted-user') auth.getUser.mockRejectedValue(Object.assign(new Error('fixture deleted'), { code: 'auth/user-not-found' }));
  if (reason === 'revoked-firebase') auth.getUser.mockResolvedValue({ emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: new Date(clock + 1000).toISOString() });
  if (reason === 'stop') await db.collection('mcpEventOperations').doc('pilot').set({ stopped: true });
  await pipeline.sweep(); expect(post).not.toHaveBeenCalled(); expect(jobs()[0][1].state).toBe('cancelled');
});
it('does not capture before consent or send after subscription expiry', async () => {
  expect((await pipeline.capture(change({ time: new Date(clock - 2000).toISOString() }))).captured).toBe(0);
  clock += 86400001; expect((await pipeline.capture(change())).captured).toBe(1); expect(jobs()).toHaveLength(0);
});
it('saves authorized backlog during renewal interruption and wakes a renewed callback', async () => {
  await store.delete('fixture-sub');
  await pipeline.capture(change()); expect(jobs()).toHaveLength(0);
  const sub = { id: 'renewed-sub', owner: 'fixture-owner', projectId: PILOT_PROJECT,
    secret, url: 'https://receiver.example.test/fixture', createdAt: clock + 1, expiresAt: clock + 86400000 };
  await store.set(sub.id, sub);
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  expect(jobs()).toHaveLength(1); await pipeline.sweep(); expect(post).toHaveBeenCalledOnce();
});
it('wakes a delivered but unacknowledged backlog when the same subscription renews', async () => {
  await pipeline.capture(change()); await pipeline.sweep();
  const original = jobs()[0][1], originalWebhook = post.mock.calls[0][1];
  const sub = { ...(await store.get('fixture-sub')), expiresAt: clock + 86400000 + 1000 };
  await store.set(sub.id, sub);
  await Promise.all([
    enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock),
    enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock),
  ]);
  expect(jobs()).toHaveLength(2);
  const wake = jobs().find(([, job]) => job.kind === 'recovery_wake')[1];
  expect(wake.eventId).toBe(original.eventId);
  expect(wake.webhookId).not.toBe(original.eventId);
  expect(jobs().filter(([, job]) => job.state === 'pending')).toHaveLength(1);
  await pipeline.sweep();
  const recoveryWebhook = post.mock.calls[1][1];
  expect(recoveryWebhook.body).toBe(originalWebhook.body);
  expect(recoveryWebhook.headers['webhook-id']).toBe(wake.webhookId);
  expect(recoveryWebhook.headers['X-MCP-Subscription-Id']).toBe('fixture-sub');
  expect((await listTaskUpdates(principal(), PILOT_PROJECT, 20, () => clock)).events[0].event.eventId).toBe(original.eventId);
  clock += 60001;
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  expect(jobs()).toHaveLength(2);
  expect(jobs().find(([, job]) => job.eventId === original.eventId && !job.kind)[1].state).toBe('delivered');
});
it('bounds rapid renewal wakes and preserves an already pending recovery', async () => {
  await pipeline.capture(change()); await pipeline.sweep();
  let sub = { ...(await store.get('fixture-sub')), expiresAt: clock + 86400000 + 1000 };
  await store.set(sub.id, sub);
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  for (let n = 0; n < 3; n++) {
    clock += 1000; sub = { ...sub, expiresAt: sub.expiresAt + 1000 };
    await store.set(sub.id, sub);
    await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  }
  expect(jobs()).toHaveLength(2);
  clock += 60001;
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  expect(jobs()).toHaveLength(2);
  await pipeline.sweep();
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  expect(jobs()).toHaveLength(3);
  await enqueueCatchup(db, principal(), 'fixture-owner', { ...sub, expiresAt: sub.expiresAt + 1000 }, () => clock);
  expect(jobs()).toHaveLength(3);
});
it('retries a recovery wake with its stable transport ID and unchanged source event', async () => {
  await pipeline.capture(change()); await pipeline.sweep();
  const sub = { ...(await store.get('fixture-sub')), expiresAt: clock + 86400000 + 1000 };
  await store.set(sub.id, sub);
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  post.mockResolvedValueOnce({ status: 503 });
  await pipeline.sweep();
  const first = post.mock.calls[1][1];
  clock += 60001; await pipeline.sweep();
  const retried = post.mock.calls[2][1];
  expect(retried.body).toBe(first.body);
  expect(retried.headers['webhook-id']).toBe(first.headers['webhook-id']);
  expect(retried.headers['webhook-timestamp']).not.toBe(first.headers['webhook-timestamp']);
  expect(JSON.parse(retried.body).eventId).toBe(taskEvent(change()).event.eventId);
  expect(jobs().find(([, job]) => job.kind === 'recovery_wake')[1]).toMatchObject({ state: 'delivered', attempts: 2 });
});
it('does not enqueue or send recovery wakes after the source event is acknowledged', async () => {
  await pipeline.capture(change()); await pipeline.sweep();
  const sub = { ...(await store.get('fixture-sub')), expiresAt: clock + 86400000 + 1000 };
  await store.set(sub.id, sub);
  await enqueueCatchup(db, principal(), 'fixture-owner', sub, () => clock);
  const eventId = taskEvent(change()).event.eventId;
  await acknowledgeTaskUpdates(db, principal(), PILOT_PROJECT, [eventId], () => clock);
  await pipeline.sweep();
  expect(post).toHaveBeenCalledOnce();
  expect(jobs().find(([, job]) => job.kind === 'recovery_wake')[1]).toMatchObject({ state: 'cancelled', reason: 'already_acknowledged' });
  await enqueueCatchup(db, principal(), 'fixture-owner', { ...sub, expiresAt: sub.expiresAt + 1000 }, () => clock);
  expect(jobs()).toHaveLength(2);
});
it('disabled producer and wrong configured project perform no task capture', async () => {
  config.enabled = false; expect(await pipeline.capture(change())).toEqual({ captured: 0 }); expect(jobs()).toHaveLength(0);
  config.enabled = true; config.projectId = 'another-project'; expect(await connectionAuthorized(db, auth, connection, config, () => clock)).toBe(false);
});
it('does not send after expiry reached during authorization checks', async () => {
  await pipeline.capture(change());
  auth.getUser.mockImplementationOnce(async () => { clock += 86400001; return { emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: '2026-01-01T00:00:00Z' }; });
  await pipeline.sweep(); expect(post).not.toHaveBeenCalled();
});
it('rejects delayed capture outside seven-day retention', async () => {
  const result = await pipeline.capture(change({ time: new Date(clock - RETENTION_MS - 1).toISOString() }));
  expect(result).toEqual({ captured: 0, expired: true });
});

it('captures real comment/checklist/attachment changes without including their text or URLs', async () => {
  for (const resource of ['comments', 'checklists', 'attachments']) {
    await pipeline.capture(change({ id: 'detail-' + resource, before: { title: '仕事', isCompleted: false }, after: { title: '仕事', isCompleted: false }, detail: { resource, id: 'child', before: null, after: { content: 'private body not forwarded', url: 'https://example.test/private' } } }));
  }
  const page = await listTaskUpdates(principal(), PILOT_PROJECT, 20, () => clock);
  expect(page.events).toHaveLength(3);
  expect(page.events.map(e => e.resource).sort()).toEqual(['attachments', 'checklists', 'comments']);
  expect(JSON.stringify(page)).not.toContain('private');
  expect(taskEvent(change({ detail: { resource: 'unknown', id: 'x', before: null, after: {} } }))).toBeNull();
});
it('automatically observes model fields that the old hand-written list omitted', () => {
  expect(taskEvent(change({ before: { title: '仕事', relatedTaskIds: [] }, after: { title: '仕事', relatedTaskIds: ['other-task'] } })).changedFields).toEqual(['relatedTaskIds']);
});
