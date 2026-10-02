// @vitest-environment node
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/projects/[projectId]/tasks/changes/route';
import { createApiToken, deactivateApiToken } from '@/lib/auth/apiTokens';
import { archiveProjectTask, createProjectTask, restoreProjectTask, updateProjectTask } from '@/lib/firebase/admin-projects';
import { listProjectTaskChanges } from './changeRepository';
import { asTimestamp, changeLowerBound, changeTime, decodeChangeCursor, encodeChangeCursor, PAGE_CURSOR_MAX_AGE_MS, timeIso } from './changeCursor';
import { stampTaskWrite as serverStamp } from './changeStamp.server';
import { stampTaskWrite as clientStamp } from './changeStamp.client';

// Replace only the app's database factory. Auth/token lookup, project access,
// repository, Admin/browser SDK transport and Firestore rules execute for real.
const state = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: () => {
    if (!state.db) throw new Error('Emulator database is not initialized');
    return state.db;
  },
  verifyAuthToken: async () => { throw new Error('Only synthetic emulator PATs are used here'); },
}));

const address = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = process.env.TASK_CHANGES_EMULATOR_PROJECT === 'demo-taskflow-delta';
const reader = 'integration-reader';
type Page = Awaited<ReturnType<typeof listProjectTaskChanges>>;
let db: Firestore;
let rules: RulesTestEnvironment;
let project: string;
let counter = 0;
let agedAt: Timestamp;
const tasks = () => db.collection('projects').doc(project).collection('tasks');
const taskData = (title: string) => ({ title, listId: 'todo', isCompleted: false, isArchived: false });
async function seedProject(id: string) {
  await db.doc(`projects/${id}`).set({ ownerId: reader, memberIds: [reader], isArchived: false });
  await db.doc(`projects/${id}/members/${reader}`).set({ userId: reader, role: 'viewer' });
  await db.doc(`projects/${id}/lists/todo`).set({ name: 'Todo', order: 0 });
}
async function collect(id: string, cursor: string | null, limit = 2) {
  const result: Page['tasks'] = [];
  let snapshotAt: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await listProjectTaskChanges(id, cursor, limit);
    snapshotAt ??= page.snapshotAt;
    expect(page.snapshotAt).toBe(snapshotAt);
    result.push(...page.tasks);
    if (!page.nextCursor) return { tasks: result, checkpoint: page.checkpoint! };
    expect(page.checkpoint).toBeNull();
    cursor = page.nextCursor;
  }
  throw new Error('Unexpected pagination loop');
}
async function token(permissions: ('tasks:read' | 'tasks:write')[] = ['tasks:read'], projectIds: string[] | null = [project], expiresAt: Date | null = null) {
  return createApiToken(reader, { name: 'Synthetic local test', actorDisplayName: null, actorIcon: null, permissions, projectIds, expiresAt });
}
async function request(key: string | null, cursor: string | null = null, limit = '1', id = project) {
  const url = new URL(`http://localhost/api/projects/${id}/tasks/changes`);
  url.searchParams.set('limit', limit);
  if (cursor) url.searchParams.set('cursor', cursor);
  return GET(new NextRequest(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} }), { params: Promise.resolve({ projectId: id }) });
}

describe.runIf(enabled)('task changes against isolated Firestore emulator', () => {
  beforeAll(async () => {
    if (!address || !/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Explicit loopback emulator host required');
    const port = Number(address.split(':')[1]);
    if (port < 1024 || port > 65535) throw new Error('Invalid emulator port');
    db = new Firestore({ projectId: 'demo-taskflow-delta' });
    state.db = db;
    rules = await initializeTestEnvironment({ projectId: 'demo-taskflow-delta', firestore: { host: '127.0.0.1', port, rules: readFileSync('firestore.rules', 'utf8') } });
    const metadata = await db.doc('integrationMetadata/aged').get();
    const prior = metadata.get('at');
    if (prior instanceof Timestamp && Date.now() - prior.toMillis() < PAGE_CURSOR_MAX_AGE_MS - 120_000) {
      agedAt = prior;
    } else {
      await seedProject('integration-aged');
      const batch = db.batch();
      for (const id of ['a', 'b', 'c']) {
        const ref = db.doc(`projects/integration-aged/tasks/${id}`);
        batch.set(ref, serverStamp(ref, taskData(`aged-${id}`)));
      }
      await batch.commit();
      const first = await listProjectTaskChanges('integration-aged', null, 1);
      agedAt = asTimestamp(decodeChangeCursor(first.nextCursor, 'integration-aged')!.at);
      await db.doc('integrationMetadata/aged').set({ at: agedAt });
    }
  }, 20_000);
  beforeEach(async () => { project = `integration-case-${++counter}`; await seedProject(project); });
  afterAll(async () => { await rules?.cleanup(); await db?.terminate(); state.db = null; });

  it('bootstraps legacy and archived documents across pages without backfilling or inventing business dates', async () => {
    for (const id of ['a', 'b', 'c']) await tasks().doc(id).set({ ...taskData(id), isArchived: id === 'b' });
    const before = await tasks().doc('a').get();
    const full = await collect(project, null, 1);
    expect(full.tasks.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(full.tasks[1].isArchived).toBe(true);
    expect(full.tasks.every(t => t.updatedAt === null && t.createdAt === null)).toBe(true);
    expect(full.tasks.every(t => /\.\d{9}Z$/.test(t.changeVersion))).toBe(true);
    const after = await tasks().doc('a').get();
    expect(after.get('apiChangedAt')).toBeUndefined();
    expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
  });

  it('uses real API writers for create, date transaction, completion, archive and restore', async () => {
    let checkpoint = (await collect(project, null)).checkpoint;
    const created = await createProjectTask(project, reader, { title: 'Created', listId: 'todo', assigneeIds: [] });
    const id = created.task.id;
    for (const mutate of [
      () => updateProjectTask(project, id, { title: 'Edited', dueDate: '2026-12-01' }),
      () => updateProjectTask(project, id, { isCompleted: true }),
      () => archiveProjectTask(project, id, reader),
      () => restoreProjectTask(project, id),
    ]) {
      const initial = await collect(project, checkpoint);
      const before = initial.tasks.find(t => t.id === id)!;
      expect(before).toBeTruthy();
      await mutate();
      const next = await collect(project, initial.checkpoint);
      const changed = next.tasks.find(t => t.id === id)!;
      expect(changed.changeVersion).not.toBe(before.changeVersion);
      expect((await tasks().doc(id).get()).get('apiChangedAt')).toBeInstanceOf(Timestamp);
      checkpoint = next.checkpoint;
    }
    expect((await collect(project, checkpoint)).tasks[0]).toMatchObject({ title: 'Edited', isCompleted: true, isArchived: false });
  });

  it('commits batch transforms atomically, preserves business dates and paginates equal markers by ID', async () => {
    const checkpoint = (await collect(project, null)).checkpoint;
    const businessDate = Timestamp.fromMillis(1);
    const batch = db.batch();
    for (const id of ['d', 'b', 'a', 'c']) {
      const ref = tasks().doc(id);
      batch.set(ref, serverStamp(ref, { ...taskData(id), updatedAt: businessDate }));
    }
    await batch.commit();
    const raw = await tasks().get();
    const markers = raw.docs.map(d => d.get('apiChangedAt') as Timestamp);
    expect(markers.every(m => m.isEqual(markers[0]))).toBe(true);
    expect(markers[0].nanoseconds % 1_000_000).toBe(0);
    const round = await collect(project, checkpoint, 1);
    expect(round.tasks.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(round.tasks.every(t => t.updatedAt === businessDate.toDate().toISOString())).toBe(true);
  });

  it('keeps bootstrap continuations and retries stable across pending updates and inserts', async () => {
    for (const id of ['a', 'b', 'c']) await tasks().doc(id).set(taskData(id));
    const first = await listProjectTaskChanges(project, null, 1);
    await tasks().doc('b').update(serverStamp(tasks().doc('b'), { title: 'new-b', isArchived: true }));
    await tasks().doc('aa').set(serverStamp(tasks().doc('aa'), taskData('inserted')));
    const second = await listProjectTaskChanges(project, first.nextCursor, 1);
    expect(second.snapshotAt).toBe(first.snapshotAt);
    expect(second.tasks[0]).toMatchObject({ id: 'b', title: 'b', isArchived: false });
    expect(await listProjectTaskChanges(project, first.nextCursor, 1)).toEqual(second);
    const third = await listProjectTaskChanges(project, second.nextCursor, 1);
    expect(third.tasks.map(t => t.id)).toEqual(['c']);
    const delta = await collect(project, third.checkpoint, 1);
    expect(delta.tasks.map(t => t.id).sort()).toEqual(['aa', 'b']);
    expect(delta.tasks.find(t => t.id === 'b')).toMatchObject({ title: 'new-b', isArchived: true });
  });

  it('retains delta sort positions during concurrent updates and sees the new version in the next round', async () => {
    const checkpoint = (await collect(project, null)).checkpoint;
    const batch = db.batch();
    for (const id of ['a', 'b', 'c']) batch.set(tasks().doc(id), serverStamp(tasks().doc(id), taskData(id)));
    await batch.commit();
    const first = await listProjectTaskChanges(project, checkpoint, 1);
    expect(first.tasks[0].id).toBe('a');
    await tasks().doc('b').update(serverStamp(tasks().doc('b'), { title: 'moved-sort-position' }));
    const tail = await collect(project, first.nextCursor, 1);
    expect(tail.tasks.map(t => t.id)).toEqual(['b', 'c']);
    expect(tail.tasks[0].title).toBe('b');
    const next = await collect(project, tail.checkpoint, 1);
    expect(next.tasks.find(t => t.id === 'b')?.title).toBe('moved-sort-position');
  });

  it('includes the exact overlap boundary; full synchronization recovers writes outside it', async () => {
    const checkpoint = (await collect(project, null)).checkpoint;
    const at = decodeChangeCursor(checkpoint, project)!.at;
    const boundary = asTimestamp(changeLowerBound(at));
    const outside = Timestamp.fromMillis(boundary.toMillis() - 1);
    await tasks().doc('boundary').set({ ...taskData('boundary'), apiChangedAt: boundary });
    await tasks().doc('outside').set({ ...taskData('outside'), apiChangedAt: outside });
    expect((await collect(project, checkpoint)).tasks.map(t => t.id)).toEqual(['boundary']);
    expect((await collect(project, null)).tasks.map(t => t.id)).toEqual(['boundary', 'outside']);
  });

  it('requires full reconciliation for unstamped writers and hard deletes', async () => {
    await tasks().doc('deleted').set(serverStamp(tasks().doc('deleted'), taskData('deleted')));
    const checkpoint = (await collect(project, null)).checkpoint;
    await tasks().doc('unstamped').set(taskData('unstamped'));
    await tasks().doc('deleted').delete();
    expect((await collect(project, checkpoint)).tasks).toEqual([]);
    expect((await collect(project, null)).tasks.map(t => t.id)).toEqual(['unstamped']);
  });

  it('authenticates actual synthetic PATs and checks scopes and permissions with real database reads', async () => {
    await tasks().doc('a').set(taskData('a'));
    const allowed = await token();
    const ok = await request(allowed.plainTextKey);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await ok.json()).tasks[0].id).toBe('a');
    expect((await db.doc(`users/${reader}/apiTokens/${allowed.apiKey.id}`).get()).get('lastUsedAt')).toBeInstanceOf(Timestamp);
    expect((await request((await token(['tasks:write'])).plainTextKey)).status).toBe(403);
    expect((await request((await token(['tasks:read'], ['another-project'])).plainTextKey)).status).toBe(403);
    expect((await request(allowed.plainTextKey, null, '1', 'another-project')).status).toBe(403);
  });

  it('rechecks membership, membership role and token revocation on continued pages', async () => {
    for (const id of ['a', 'b']) await tasks().doc(id).set(taskData(id));
    const key = await token();
    const first = await (await request(key.plainTextKey)).json() as Page;
    expect(first.nextCursor).toBeTruthy();
    await db.doc(`projects/${project}`).update({ memberIds: [] });
    expect((await request(key.plainTextKey, first.nextCursor)).status).toBe(403);
    await db.doc(`projects/${project}`).update({ memberIds: [reader] });
    await db.doc(`projects/${project}/members/${reader}`).update({ role: 'removed' });
    expect((await request(key.plainTextKey, first.nextCursor)).status).toBe(403);
    await db.doc(`projects/${project}/members/${reader}`).delete();
    expect((await request(key.plainTextKey, first.nextCursor)).status).toBe(403);
    await db.doc(`projects/${project}/members/${reader}`).set({ userId: reader, role: 'viewer' });
    expect((await request(key.plainTextKey, first.nextCursor)).status).toBe(200);
    await deactivateApiToken(reader, key.apiKey.id);
    expect((await request(key.plainTextKey, first.nextCursor)).status).toBe(401);
  });

  it('returns authentication, limit, project, foreign-cursor and expiry errors without a checkpoint', async () => {
    const key = (await token()).plainTextKey;
    const expiredPage = encodeChangeCursor({ v: 1, project, kind: 'page', mode: 'bootstrap', at: changeTime(Timestamp.fromMillis(Date.now() - PAGE_CURSOR_MAX_AGE_MS - 1)), after: { id: 'a' } });
    const foreign = encodeChangeCursor({ v: 1, project: 'another-project', kind: 'checkpoint', at: changeTime(Timestamp.now()) });
    for (const response of [await request(null), await request('tf_synthetic_invalid'), await request((await token(['tasks:read'], [project], new Date(1))).plainTextKey)]) {
      expect(response.status).toBe(401); expect(await response.json()).not.toHaveProperty('checkpoint');
    }
    const old = await request(key, expiredPage);
    expect(old.status).toBe(409); expect(await old.json()).toEqual({ error: 'CURSOR_EXPIRED' });
    expect((await request(key, foreign)).status).toBe(400);
    expect((await request(key, null, '201')).status).toBe(400);
    const anyProject = (await token(['tasks:read'], null)).plainTextKey;
    expect((await request(anyProject, null, '1', 'missing-project')).status).toBe(404);
  });

  it('enforces actual browser rules while allowing a member serverTimestamp marker', async () => {
    const member = rules.authenticatedContext(reader, { email: `${reader}@1000ri.jp`, email_verified: true }).firestore();
    const ref = doc(member, `projects/${project}/tasks/browser`);
    const checkpoint = (await collect(project, null)).checkpoint;
    await assertSucceeds(setDoc(ref, clientStamp(ref, { ...taskData('browser'), updatedAt: new Date(1) })));
    await assertSucceeds(updateDoc(ref, clientStamp(ref, { title: 'browser-updated' })));
    const saved = await tasks().doc('browser').get();
    expect(saved.get('apiChangedAt')).toBeInstanceOf(Timestamp);
    expect((await collect(project, checkpoint)).tasks[0]).toMatchObject({ title: 'browser-updated', updatedAt: new Date(1).toISOString() });
    await assertFails(updateDoc(ref, clientStamp(ref, { completionPolicy: { requiresReview: true } })));
    for (const [uid, email] of [['outsider', 'outsider@1000ri.jp'], [reader, 'reader@example.com']]) {
      const external = rules.authenticatedContext(uid, { email, email_verified: true }).firestore();
      const target = doc(external, ref.path);
      await assertFails(getDoc(target));
      await assertFails(updateDoc(target, clientStamp(target, { title: 'denied' })));
    }
  });

  it('ignores comment-only writes and keeps projects isolated', async () => {
    await tasks().doc('a').set(taskData('a'));
    const checkpoint = (await collect(project, null)).checkpoint;
    await tasks().doc('a').collection('comments').doc('comment').set({ content: 'Only comment changed' });
    const other = db.doc('projects/other-project/tasks/other');
    await other.set(serverStamp(other, taskData('other')));
    expect((await collect(project, checkpoint)).tasks).toEqual([]);
    expect((await collect('other-project', null)).tasks.map(t => t.id)).toEqual(['other']);
  });

  it('continues a real snapshot older than one minute after its pending task changes', async () => {
    // Fresh emulator runs spend at most 61 seconds here; polling in short chunks
    // keeps the runner responsive. Reuse an earlier fixture in this emulator.
    while (Date.now() - agedAt.toMillis() <= 61_000) await delay(Math.min(10_000, 61_100 - (Date.now() - agedAt.toMillis())));
    const ref = db.doc('projects/integration-aged/tasks/b');
    await ref.update(serverStamp(ref, { title: 'new-aged-b' }));
    const cursor = encodeChangeCursor({ v: 1, project: 'integration-aged', kind: 'page', mode: 'bootstrap', at: changeTime(agedAt), after: { id: 'a' } });
    const page = await listProjectTaskChanges('integration-aged', cursor, 1);
    expect(page.snapshotAt).toBe(timeIso(changeTime(agedAt)));
    expect(page.tasks[0]).toMatchObject({ id: 'b', title: 'aged-b' });
    expect(await listProjectTaskChanges('integration-aged', cursor, 1)).toEqual(page);
    const last = await listProjectTaskChanges('integration-aged', page.nextCursor, 1);
    expect(last.tasks.map(t => t.id)).toEqual(['c']);
    expect((await collect('integration-aged', last.checkpoint)).tasks.find(t => t.id === 'b')?.title).toBe('new-aged-b');
    console.log(`Verified historical continuation age: ${Math.floor((Date.now() - agedAt.toMillis()) / 1000)} seconds`);
  }, 90_000);

  it.skipIf(process.env.TASK_CHANGES_VERIFY_LONG_CURSOR !== 'true')('retains a page near 45 minutes and returns 409 after its real expiry', async () => {
    // Opt in explicitly: no fake clock or fabricated historical readTime.
    const validAge = PAGE_CURSOR_MAX_AGE_MS - 15_000;
    while (Date.now() - agedAt.toMillis() < validAge) await delay(Math.min(10_000, validAge - (Date.now() - agedAt.toMillis())));
    const cursor = encodeChangeCursor({ v: 1, project: 'integration-aged', kind: 'page', mode: 'bootstrap', at: changeTime(agedAt), after: { id: 'a' } });
    const ageBeforeRead = Date.now() - agedAt.toMillis();
    expect(ageBeforeRead).toBeLessThan(PAGE_CURSOR_MAX_AGE_MS);
    const retained = await listProjectTaskChanges('integration-aged', cursor, 1);
    expect(retained.snapshotAt).toBe(timeIso(changeTime(agedAt)));
    expect(retained.tasks[0]).toMatchObject({ id: 'b', title: 'aged-b' });
    console.log(`Verified retained historical page age: ${ageBeforeRead} ms`);
    while (Date.now() - agedAt.toMillis() <= PAGE_CURSOR_MAX_AGE_MS + 1000) await delay(Math.min(10_000, PAGE_CURSOR_MAX_AGE_MS + 1100 - (Date.now() - agedAt.toMillis())));
    const key = await token(['tasks:read'], ['integration-aged']);
    const expired = await request(key.plainTextKey, cursor, '1', 'integration-aged');
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ error: 'CURSOR_EXPIRED' });
    await expect(listProjectTaskChanges('integration-aged', cursor, 1)).rejects.toThrow('CURSOR_EXPIRED');
    const checkpoint = encodeChangeCursor({ v: 1, project: 'integration-aged', kind: 'checkpoint', at: changeTime(agedAt) });
    expect((await request(key.plainTextKey, checkpoint, '100', 'integration-aged')).status).toBe(200);
    console.log(`Verified expired page and usable completed checkpoint age: ${Date.now() - agedAt.toMillis()} ms`);
  }, PAGE_CURSOR_MAX_AGE_MS + 60_000);
});
