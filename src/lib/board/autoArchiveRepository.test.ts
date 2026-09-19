// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAutoArchive, runAutoArchive, runAutoArchiveBatch, saveAutoArchive } from './autoArchiveRepository';

type Data = Record<string, unknown>;
const fake = vi.hoisted(() => ({ db: null as unknown, failRead: '', failCommit: false, readsAfterWrite: 0 }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));
let documents: Map<string, Data>;
let serial: Promise<unknown>;
let sequence = 0;
class Ref {
  constructor(public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async get() {
    if (fake.failRead === this.path) throw new Error('Synthetic read failure');
    const value = documents.get(this.path);
    return { id: this.id, ref: this, exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) };
  }
}
class Query {
  filters: [string, string, unknown][] = []; maximum = Infinity; after = '';
  constructor(public path: string) {}
  doc(id = `generated-${++sequence}`) { return new Ref(`${this.path}/${id}`); }
  where(field: string, operator: string, value: unknown) { this.filters.push([field, operator, value]); return this; }
  limit(value: number) { this.maximum = value; return this; }
  orderBy() { return this; }
  startAfter(id: string) { this.after = `${this.path}/${id}`; return this; }
  async get() {
    if (fake.failRead === this.path) throw new Error('Synthetic query failure');
    const paths = [...documents.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1)
      .filter(path => this.filters.every(([field, op, value]) => op === 'array-contains' ? Array.isArray(documents.get(path)![field]) && (documents.get(path)![field] as unknown[]).includes(value) : documents.get(path)![field] === value) && path > this.after)
      .sort().slice(0, this.maximum);
    const docs = await Promise.all(paths.map(path => new Ref(path).get()));
    return { docs, size: docs.length, empty: !docs.length };
  }
}
const now = new Date('2026-09-13T03:00:00.000Z');
const completed = new Date('2026-08-01T03:00:00.000Z');
const path = (taskId = 't', projectId = 'p') => `projects/${projectId}/tasks/${taskId}`;
const settingPath = (uid = 'u') => `users/${uid}/settings/autoArchive`;
const projectSetting = (projectId = 'p') => `projects/${projectId}/settings/autoArchive`;
const task = (id = 't', projectId = 'p') => documents.get(path(id, projectId))!;
const activities = () => [...documents].filter(([key]) => key.includes('/activityLogs/'));
const grant = (uid = 'u', days: number | null = 30, mode = 'custom') => ({ version: 1, revision: 1, mode, days, updatedBy: uid, updatedAt: completed });
function project(id = 'p', ownerId = 'u', memberIds = [ownerId, 'v']) {
  documents.set(`projects/${id}`, { ownerId, memberIds, isArchived: false });
  for (const uid of memberIds) documents.set(`projects/${id}/members/${uid}`, { userId: uid, role: uid === ownerId ? 'admin' : 'editor' });
}
function putTask(id = 't', extra: Data = {}, projectId = 'p') {
  documents.set(path(id, projectId), { projectId, title: id, listId: 'l', isCompleted: true, completedAt: completed, isArchived: false, isAbandoned: false,
    archivedAt: null, archivedBy: null, assigneeIds: ['u'], dependsOnTaskIds: [], createdAt: completed, updatedAt: completed, ...extra });
}
async function saveDefault(days: number | null = 30, uid = 'u') {
  const view = await readAutoArchive(uid, null);
  return saveAutoArchive(uid, { projectId: null, mode: 'custom', days, revision: view.revision });
}
async function saveProject(days: number | null, mode: 'custom' | 'inherit' = 'custom', uid = 'u') {
  const view = await readAutoArchive(uid, 'p');
  return saveAutoArchive(uid, { projectId: 'p', mode, days, revision: view.revision });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  documents = new Map(); serial = Promise.resolve(); sequence = 0; fake.failRead = ''; fake.failCommit = false; fake.readsAfterWrite = 0;
  fake.db = {
    doc: (key: string) => new Ref(key), collection: (key: string) => new Query(key),
    runTransaction: (run: (tx: unknown) => Promise<unknown>) => {
      const operation = serial.then(async () => {
        const writes: { kind: 'set' | 'update' | 'create'; ref: Ref; value: Data }[] = [];
        const append = (kind: 'set' | 'update' | 'create', ref: Ref, value: Data) => writes.push({ kind, ref, value: structuredClone(value) });
        const value = await run({
          get: (ref: Ref | Query) => { if (writes.length) { fake.readsAfterWrite++; throw new Error('Reads must precede writes'); } return ref.get(); },
          set: (ref: Ref, data: Data) => append('set', ref, data), update: (ref: Ref, data: Data) => append('update', ref, data), create: (ref: Ref, data: Data) => append('create', ref, data),
        });
        if (fake.failCommit && writes.length) { fake.failCommit = false; throw new Error('Synthetic commit failure'); }
        for (const write of writes) {
          if (write.kind === 'update' && !documents.has(write.ref.path) || write.kind === 'create' && documents.has(write.ref.path)) throw new Error('Invalid write');
        }
        for (const write of writes) documents.set(write.ref.path, write.kind === 'update' ? { ...documents.get(write.ref.path), ...write.value } : write.value);
        return value;
      });
      serial = operation.catch(() => undefined); return operation;
    },
  };
  project(); putTask(); documents.set('projects/p/lists/l', { name: '確認済み' });
});
afterEach(() => { expect(fake.readsAfterWrite).toBe(0); vi.useRealTimers(); });

describe('archive settings and access', () => {
  it('keeps unsaved defaults and projects OFF without creating settings or touching tasks', async () => {
    const before = structuredClone(documents);
    expect(await readAutoArchive('u', null)).toMatchObject({ days: 30, effectiveDays: null, configured: false, mode: 'custom' });
    expect(await readAutoArchive('u', 'p')).toMatchObject({ days: 30, effectiveDays: null, configured: false, mode: 'inherit', preview: null });
    expect(await runAutoArchiveBatch()).toEqual({ checked: 1, archived: 0, failed: 0, nextCursor: null });
    expect(documents).toEqual(before);
  });
  it('inherits only the owner default, supports project OFF and returns to inheritance', async () => {
    await saveDefault(30); await saveDefault(7, 'v');
    expect(await readAutoArchive('v', 'p')).toMatchObject({ effectiveDays: 30, defaultDays: 30, mode: 'inherit', canEdit: false });
    expect((await readAutoArchive('u', 'p')).preview?.candidates).toEqual([{ id: 't', title: 't', listName: '確認済み', completedAt: completed.toISOString(), elapsedDays: 43 }]);
    expect(await saveProject(null)).toMatchObject({ effectiveDays: null, days: null, mode: 'custom', configured: true });
    expect((await runAutoArchive('v')).archived).toBe(0);
    expect(await saveProject(null, 'inherit')).toMatchObject({ effectiveDays: 30, mode: 'inherit' });
    expect(task().isArchived).toBe(false);
  });
  it('allows member reads but rejects editor/viewer/non-member writes and non-member reads', async () => {
    const view = await readAutoArchive('v', 'p'); expect(view.canEdit).toBe(false);
    for (const role of ['editor', 'viewer']) {
      documents.get('projects/p/members/v')!.role = role;
      await expect(saveAutoArchive('v', { projectId: 'p', mode: 'custom', days: 7, revision: view.revision })).rejects.toMatchObject({ status: 403 });
    }
    await expect(readAutoArchive('outsider', 'p')).rejects.toMatchObject({ status: 403 });
    documents.get('projects/p')!.memberIds = ['u'];
    await expect(saveAutoArchive('v', { projectId: 'p', mode: 'custom', days: null, revision: view.revision })).rejects.toMatchObject({ status: 403 });
    expect(documents.has(projectSetting())).toBe(false);
  });
  it('rejects stale default, inherited-default and project revisions rather than losing another edit', async () => {
    const defaultView = await readAutoArchive('u', null); const projectView = await readAutoArchive('u', 'p');
    await saveDefault(7);
    await expect(saveAutoArchive('u', { projectId: null, mode: 'custom', days: 30, revision: defaultView.revision })).rejects.toMatchObject({ status: 409 });
    await expect(saveAutoArchive('u', { projectId: 'p', mode: 'custom', days: 30, revision: projectView.revision })).rejects.toMatchObject({ status: 409 });
    const ready = await readAutoArchive('u', 'p');
    const writes = await Promise.allSettled([7, 30].map(days => saveAutoArchive('u', { projectId: 'p', mode: 'custom', days, revision: ready.revision })));
    expect(writes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(documents.get(projectSetting())!.days).toBe(7);
  });
  it('does not allow last-run status alone to invalidate a settings form', async () => {
    await saveDefault(); const before = await readAutoArchive('u', 'p'); await runAutoArchiveBatch();
    expect((await readAutoArchive('u', 'p')).revision).toBe(before.revision);
    await expect(saveAutoArchive('u', { projectId: 'p', days: null, mode: 'custom', revision: before.revision })).resolves.toMatchObject({ effectiveDays: null });
  });
  it.each([false, undefined, 0, 1.5, 3651, '7'])('rejects malformed period %s rather than silently disabling automation', async days => {
    const current = await readAutoArchive('u', null);
    await expect(saveAutoArchive('u', { projectId: null, mode: 'custom', revision: current.revision, days: days as never })).rejects.toMatchObject({ status: 422 });
    expect(documents.has(settingPath())).toBe(false);
  });
  it('fails closed for corrupt settings and invalid paths without inventing a default grant', async () => {
    documents.set(settingPath(), { ...grant(), days: false });
    await expect(readAutoArchive('u', null)).rejects.toMatchObject({ status: 503 });
    expect((await runAutoArchiveBatch()).failed).toBe(1); expect(task().isArchived).toBe(false);
    await expect(readAutoArchive('u', 'p/tasks/x')).rejects.toMatchObject({ status: 422 });
  });
});

describe('transactional automatic archive', () => {
  it('shares a once-per-JST-day ledger across users, tabs and the background worker, including empty checks', async () => {
    await saveDefault(); Object.assign(task(), { completedAt: now });
    await runAutoArchive('u');
    const previousRun = structuredClone(documents.get('projects/p/settings/autoArchiveRun'));
    putTask('later');
    const results = await Promise.all([runAutoArchive('u'), runAutoArchive('v'), runAutoArchiveBatch()]);
    expect(results.every(result => result.archived === 0)).toBe(true);
    expect(task('later').isArchived).toBe(false); expect(activities()).toHaveLength(0);
    expect(documents.get('projects/p/settings/autoArchiveRun')).toEqual(previousRun);
    vi.setSystemTime(new Date('2026-09-13T23:59:59.999+09:00'));
    expect((await runAutoArchiveBatch()).archived).toBe(0);
    vi.setSystemTime(new Date('2026-09-14T00:00:00+09:00'));
    const midnight = await Promise.all([runAutoArchive('u'), runAutoArchiveBatch()]);
    expect(midnight.reduce((count, result) => count + result.archived, 0)).toBe(1);
    expect(activities()).toHaveLength(1);
  });
  it('runs a newly saved policy once on the same day and coalesces it with daily requests', async () => {
    await saveDefault(90); await runAutoArchive('u'); expect(task().isArchived).toBe(false);
    await saveDefault(30);
    const results = await Promise.all([runAutoArchive('u'), runAutoArchiveBatch(), runAutoArchive('v')]);
    expect(results.reduce((count, result) => count + result.archived, 0)).toBe(1); expect(activities()).toHaveLength(1);
    const after = structuredClone(documents);
    await runAutoArchive('u'); expect(documents).toEqual(after);
  });
  it('catches up once at the current day after a long absence without replaying missed dates', async () => {
    await saveDefault(90); await runAutoArchive('u');
    vi.setSystemTime(new Date('2026-12-20T08:00:00+09:00'));
    expect((await runAutoArchive('u')).archived).toBe(1);
    expect(documents.get('projects/p/settings/autoArchiveRun')).toMatchObject({ day: '2026-12-20', archivedCount: 1 });
    await runAutoArchiveBatch(); expect(activities()).toHaveLength(1);
  });
  it('does not let an unrelated default save rerun a custom project setting on the same day', async () => {
    await saveProject(90); await runAutoArchive('u');
    putTask('older', { completedAt: new Date('2026-01-01') });
    await saveDefault(7); expect((await runAutoArchive('u')).archived).toBe(0);
    expect(task('older').isArchived).toBe(false);
    await saveProject(90); expect((await runAutoArchive('u')).archived).toBe(1);
  });
  it('checks current grant authority before honoring a completed day and keeps the failure visible', async () => {
    documents.get('projects/p/members/v')!.role = 'admin'; await saveProject(90, 'custom', 'v');
    await runAutoArchive('u');
    documents.get('projects/p/members/v')!.role = 'editor';
    expect((await runAutoArchive('u')).failed).toBe(1);
    expect((await readAutoArchive('u', 'p')).lastRun?.error).toContain('権限が失効');
    expect(task().isArchived).toBe(false); expect(activities()).toHaveLength(0);
    documents.get('projects/p')!.memberIds = ['u'];
    expect((await runAutoArchive('v')).checked).toBe(0);
  });
  it('archives an eligible family atomically, preserving completion, content and relationships and recording each task once', async () => {
    await saveDefault();
    putTask('parent', { description: '共有本文', completionPolicy: { required: [{ taskId: 't' }] } });
    task().parentTaskId = 'parent'; documents.set(`${path()}/comments/c`, { content: '原文コメント' });
    const before = structuredClone(task());
    expect(await runAutoArchiveBatch()).toEqual({ checked: 1, archived: 2, failed: 0, nextCursor: null });
    expect(task()).toEqual({ ...before, isArchived: true, archivedAt: now, archivedBy: 'u', updatedAt: now, autoArchiveCompletedAt: completed });
    expect(task('parent')).toMatchObject({ isArchived: true, description: '共有本文', completionPolicy: { required: [{ taskId: 't' }] } });
    expect(documents.get(`${path()}/comments/c`)).toEqual({ content: '原文コメント' });
    expect(activities()).toHaveLength(2);
    expect(activities()[0][1]).toMatchObject({ action: 'update', userId: 'u', userName: '自動アーカイブ', createdAt: now });
    const after = structuredClone(task());
    expect((await runAutoArchiveBatch()).archived).toBe(0); expect(task()).toEqual(after); expect(activities()).toHaveLength(2);
  });
  it('does not rearchive a restored completion, but a genuinely new completion becomes eligible again', async () => {
    await saveDefault(); await runAutoArchiveBatch();
    Object.assign(task(), { isArchived: false, archivedAt: null, archivedBy: null, updatedAt: now });
    expect((await readAutoArchive('u', 'p')).preview).toMatchObject({ candidates: [], restoredCount: 1 });
    expect((await runAutoArchiveBatch()).archived).toBe(0);
    Object.assign(task(), { isCompleted: false, completedAt: null }); expect((await runAutoArchiveBatch()).archived).toBe(0);
    Object.assign(task(), { isCompleted: true, completedAt: new Date('2026-08-10T03:00:00.000Z') });
    vi.setSystemTime(new Date('2026-09-14T00:00:00+09:00'));
    expect((await runAutoArchiveBatch()).archived).toBe(1);
    expect(task().autoArchiveCompletedAt).toEqual(new Date('2026-08-10T03:00:00.000Z'));
  });
  it('protects still-needed parents, dependencies and explicit required children to a fixed point', async () => {
    await saveDefault();
    task().dependsOnTaskIds = ['dependency']; putTask('dependency');
    putTask('parent', { completionPolicy: { required: [{ taskId: 't' }] } });
    putTask('open', { isCompleted: false, parentTaskId: 'parent' });
    const view = await readAutoArchive('u', 'p'); expect(view.preview).toMatchObject({ candidates: [], protectedCount: 3 });
    expect((await runAutoArchiveBatch()).archived).toBe(0); expect(activities()).toHaveLength(0);
  });
  it('rechecks grant authority, current completion, project owner and archived state on every run', async () => {
    await saveDefault();
    documents.get('projects/p/members/v')!.role = 'admin'; await saveProject(7, 'custom', 'v');
    documents.get('projects/p/members/v')!.role = 'editor';
    expect((await runAutoArchiveBatch()).failed).toBe(1); expect(task().isArchived).toBe(false);
    expect((await readAutoArchive('v', 'p')).lastRun?.error).toContain('設定を保存し直してください');
    await saveProject(null, 'inherit'); Object.assign(task(), { isCompleted: false, completedAt: null });
    expect((await runAutoArchiveBatch()).archived).toBe(0);
    Object.assign(task(), { isCompleted: true, completedAt: completed }); documents.get('projects/p')!.isArchived = true;
    expect((await runAutoArchiveBatch()).archived).toBe(0);
    documents.get('projects/p')!.isArchived = false; documents.get('projects/p')!.ownerId = 'v';
    expect((await runAutoArchiveBatch()).archived).toBe(0); // v never granted owner defaults.
    expect(task().isArchived).toBe(false);
  });
  it('does not run another project merely because the caller supplied a cursor and advances failed projects safely', async () => {
    await saveDefault(); project('q', 'other', ['other']); putTask('private', {}, 'q'); documents.set(settingPath('other'), grant('other'));
    expect(await runAutoArchive('u')).toEqual({ checked: 1, archived: 1, failed: 0, nextCursor: null });
    expect(task('private', 'q').isArchived).toBe(false);
    expect(await runAutoArchive('u', 'projects/p')).toEqual({ checked: 0, archived: 0, failed: 0, nextCursor: null });
    expect((await runAutoArchiveBatch()).archived).toBe(1);
  });
  it('rechecks relations after preview so a newly added unfinished child keeps its completed parent visible', async () => {
    await saveDefault();
    expect((await readAutoArchive('u', 'p')).preview?.candidates.map(item => item.id)).toEqual(['t']);
    putTask('new-child', { parentTaskId: 't', isCompleted: false, completedAt: null });
    expect((await runAutoArchiveBatch()).archived).toBe(0);
    expect(task().isArchived).toBe(false); expect(activities()).toHaveLength(0);
  });
  it('preserves all tasks and history after a commit failure or incomplete read, then retries once', async () => {
    await saveDefault(); const before = structuredClone(documents);
    fake.failCommit = true; expect((await runAutoArchiveBatch()).failed).toBe(1); expect(documents).toEqual(before);
    fake.failRead = 'projects/p/tasks'; expect((await runAutoArchiveBatch()).failed).toBe(1); expect(documents).toEqual(before);
    fake.failRead = ''; expect((await runAutoArchiveBatch()).archived).toBe(1); expect(activities()).toHaveLength(1);
  });
  it('does not partially archive a family beyond the 200-task write cap and makes that stop visible', async () => {
    await saveDefault();
    for (let i = 0; i < 200; i++) putTask(`child-${i}`, { parentTaskId: 't' });
    expect((await readAutoArchive('u', 'p')).preview?.candidates).toHaveLength(201);
    expect(await runAutoArchiveBatch()).toMatchObject({ checked: 1, failed: 1, archived: 0 });
    expect([...documents].filter(([key]) => /^projects\/p\/tasks\/[^/]+$/.test(key)).every(([, data]) => !data.isArchived)).toBe(true);
    expect(activities()).toHaveLength(0);
    expect((await readAutoArchive('u', 'p')).lastRun?.error).toContain('200件を超える');
  });
  it('rejects a task snapshot over 1000 instead of computing relationships from a truncated prefix', async () => {
    await saveDefault();
    for (let i = 0; i < 1000; i++) putTask(`old-${i}`, { isArchived: true });
    await expect(readAutoArchive('u', 'p')).rejects.toMatchObject({ status: 503 });
    expect(await runAutoArchiveBatch()).toMatchObject({ failed: 1, archived: 0 });
    expect(task().isArchived).toBe(false); expect(activities()).toHaveLength(0);
    expect(documents.get('projects/p/settings/autoArchiveRun')!.error).toContain('1000件を超える');
  });
  it('paginates whole projects in pages of 20 without skipping the extra fetched project', async () => {
    documents.clear();
    for (let i = 0; i < 23; i++) project(`p${String(i).padStart(2, '0')}`, i % 2 ? 'u' : 'v', ['u', 'v']);
    const first = await runAutoArchiveBatch(); expect(first).toEqual({ checked: 20, archived: 0, failed: 0, nextCursor: 'projects/p19' });
    expect(await runAutoArchiveBatch(first.nextCursor!)).toEqual({ checked: 3, archived: 0, failed: 0, nextCursor: null });
    await expect(runAutoArchiveBatch('users/u')).rejects.toMatchObject({ status: 422 });
    await expect(runAutoArchiveBatch('projects/../x')).rejects.toMatchObject({ status: 422 });
    expect([...documents.keys()].some(key => key.includes('/settings/'))).toBe(false);
  });
});
