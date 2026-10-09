// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { taskFirestore } from './taskData.fixture';
import { readTaskData, writeTaskData, type TaskOperation, type TaskPrincipal } from './taskData';
import { models, taskContract } from './taskContract';
import { ownedObject, validateUpload } from './taskFiles';
const fake = vi.hoisted(() => ({ db: null as unknown, files: new Map<string, { bytes: Buffer; metadata: Record<string, unknown> }>() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getAdminStorage: () => ({ bucket: () => ({ file: (path: string) => ({
  save: async (bytes: Buffer, options: Record<string, unknown>) => { if (fake.files.has(path)) throw Object.assign(new Error('exists'), { code: 412 }); fake.files.set(path, { bytes, metadata: { ...(options.metadata as object), size: bytes.length, generation: '1', contentType: options.contentType } }); },
  getMetadata: async () => [fake.files.get(path)!.metadata],
  createReadStream: async function* ({ start, end }: { start: number; end: number }) { yield fake.files.get(path)!.bytes.subarray(start, end + 1); },
}) }) }) }));
vi.mock('@/lib/task/changeStamp.server', () => ({ stampTaskWrite: (_ref: unknown, data: unknown) => data }));
let fixture: ReturnType<typeof taskFirestore>;
const now = new Date('2026-10-07T01:00:00Z');
const base = { projectId: 'p', listId: 'todo', title: '仕事', description: '詳細', order: 0, assigneeIds: ['u'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: true, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, createdAt: now, updatedAt: now, createdBy: 'u' };
const auth = (): TaskPrincipal => ({ userId: 'u', grantId: 'grant', expiresAt: Date.now() + 60000, authorizationExpiresAt: Date.now() + 60000, projectIds: ['p'], taskScopes: ['tasks:read', 'tasks:write'], permissions: ['tasks:read', 'tasks:write'] });
const task = (id = 'a') => fixture.records.get(`projects/p/tasks/${id}`)!;
const version = (id = 'a') => (task(id).updatedAt as Date).toISOString();
const write = (op: Partial<TaskOperation> & Pick<TaskOperation, 'resource' | 'action' | 'data'>) => writeTaskData(auth(), { operations: [{ id: 'op', task_id: 'a', ...op }] });
const success = async (op: Parameters<typeof write>[0]) => { const output = await write(op); expect(output.results[0]).toMatchObject({ ok: true }); return output.results[0].result!; };
beforeEach(() => {
  fixture = taskFirestore(); fake.db = fixture.db; fake.files.clear(); vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'fictional.appspot.com');
  for (const [path, data] of Object.entries({
    'projects/p': { memberIds: ['u', 'v'], isArchived: false }, 'projects/p/members/u': { userId: 'u', role: 'editor' }, 'projects/p/members/v': { userId: 'v', role: 'editor' },
    'users/u': { displayName: '本人' }, 'users/v': { displayName: '別の人' }, 'projects/p/lists/todo': { name: '作業' },
    'projects/p/tasks/a': base, 'projects/p/tasks/b': { ...base, title: '次の仕事' },
    [`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`]: { userId: 'u', projectId: 'p', mode: 'production', expiresAt: new Date(Date.now() + 60000), taskScopes: ['tasks:read', 'tasks:write'] },
  })) fixture.records.set(path, structuredClone(data));
});
it('covers every model field and returns all extended task fields with canonical child versions', async () => {
  Object.assign(task(), { workState: { status: 'wait', reason: '素材待ち', resumeCondition: '届く', reviewAt: null }, completionCriteria: '公開', relatedTaskIds: ['b'], automation: { check: 'confirmed' } });
  fixture.records.set('projects/p/tasks/a/comments/c', { content: '話', authorId: 'u', createdAt: now, updatedAt: now });
  const aggregate = await readTaskData(auth(), { resource: 'task', task_id: 'a' });
  expect(aggregate).toMatchObject({ task: { completionCriteria: '公開', relatedTaskIds: ['b'], automation: { check: 'confirmed' }, _version: now.toISOString() }, comments: { items: [{ id: 'c', content: '話', _version: expect.any(String) }], next_cursor: null } });
  expect(Object.keys(taskContract().task_fields)).toEqual(Object.keys(models.Task.properties!));
});
it('writes ordinary full-model fields together, preserves unrelated fields, and rejects managed metadata', async () => {
  await success({ resource: 'task', action: 'patch', expected_version: version(), data: { title: '更新', description: '本文', completionCriteria: '公開', primaryAssigneeId: 'u', workState: { status: 'wait', reason: '素材', resumeCondition: '届く', reviewAt: null }, relatedTaskIds: ['b'], dependsOnTaskIds: ['b'], deadlinePolicy: 'strict', taskKind: 'decision', durationDays: 2, startDate: '2026-10-10' } });
  expect(task()).toMatchObject({ title: '更新', completionCriteria: '公開', primaryAssigneeId: 'u', createdBy: 'u', workState: { status: 'wait' } });
  for (const field of ['createdBy', 'reviewRequests', 'isCompleted', 'isArchived', 'automation', 'parentTaskId']) {
    const data = { [field]: task()[field] ?? (field === 'isCompleted' || field === 'isArchived' ? true : field === 'reviewRequests' || field === 'automation' ? {} : 'u') };
    expect((await write({ id: field, resource: 'task', action: 'patch', expected_version: version(), data })).results[0].ok).toBe(false);
  }
  await success({ id: 'unset', resource: 'task', action: 'patch', expected_version: version(), unset: ['deadlinePolicy', 'taskKind'], data: {} });
  expect(task().deadlinePolicy).toBeUndefined(); expect(task().taskKind).toBeUndefined();
});
it.each([
  { name: 'explicit fixed mode with matching dates and duration', data: { startDate: '2026-10-09', dueDate: '2026-10-10', durationDays: 2, isDueDateFixed: true }, fixed: true, due: '2026-10-09T15:00:00.000Z', duration: 2 },
  { name: 'explicit fixed mode derives duration from the supplied deadline', data: { startDate: '2026-10-09', dueDate: '2026-10-10', durationDays: 30, isDueDateFixed: true }, fixed: true, due: '2026-10-09T15:00:00.000Z', duration: 2 },
  { name: 'explicit duration mode derives the deadline', data: { startDate: '2026-10-09', dueDate: '2026-10-20', durationDays: 2, isDueDateFixed: false }, fixed: false, due: '2026-10-09T15:00:00.000Z', duration: 2 },
  { name: 'implicit mode preserves the existing duration-edit behavior', data: { startDate: '2026-10-09', dueDate: '2026-10-20', durationDays: 2 }, fixed: false, due: '2026-10-09T15:00:00.000Z', duration: 2 },
  { name: 'explicit fixed mode preserves duration when dates are absent', data: { durationDays: 2, isDueDateFixed: true }, fixed: true, due: null, duration: 2 },
])('honors schedule field precedence: $name', async ({ data, fixed, due, duration }) => {
  await success({ resource: 'task', action: 'patch', expected_version: version(), data });
  const aggregate = await readTaskData(auth(), { resource: 'task', task_id: 'a' });
  expect(aggregate).toMatchObject({ task: { isDueDateFixed: fixed, dueDate: due, durationDays: duration } });
});
it('enforces explicit task scopes, project membership, grant revocation and AI scope without writing', async () => {
  const before = structuredClone([...fixture.records]);
  await expect(readTaskData({ ...auth(), taskScopes: [] }, { resource: 'task', task_id: 'a' })).rejects.toThrow('OAuth');
  await expect(writeTaskData({ ...auth(), taskScopes: ['tasks:read'] }, { operations: [] })).rejects.toThrow('OAuth');
  await expect(readTaskData(auth(), { project_id: 'other', resource: 'tasks' })).rejects.toThrow('許可');
  expect([...fixture.records]).toEqual(before);
  fixture.records.set('users/u/settings/aiSettings', { allowedProjectIds: ['other'] });
  await expect(write({ resource: 'task', action: 'patch', expected_version: version(), data: { title: '拒否' } })).rejects.toThrow('AI利用');
  fixture.records.delete('users/u/settings/aiSettings'); fixture.records.get('projects/p/members/u')!.role = 'viewer';
  await expect(write({ resource: 'task', action: 'patch', data: { title: '拒否' } })).rejects.toThrow('権限');
  fixture.records.get('projects/p/members/u')!.role = 'editor';
  fixture.records.delete(`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`);
  expect((await write({ resource: 'task', action: 'patch', expected_version: version(), data: { title: '拒否' } })).results[0].ok).toBe(false);
  expect(task().title).toBe('仕事');
});
it('makes exact retries safe, rejects reused IDs with different content, and atomically rolls back failures', async () => {
  const op = { resource: 'task' as const, action: 'patch', expected_version: version(), data: { title: '保存' } };
  await success(op); const saved = structuredClone([...fixture.records]);
  expect(await success(op)).toMatchObject({ already_applied: true }); expect([...fixture.records]).toEqual(saved);
  expect((await write({ ...op, data: { title: '別' } })).results[0]).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  fixture.fail(true); expect((await write({ id: 'new', resource: 'task', action: 'patch', expected_version: version(), data: { title: '失敗' } })).results[0].ok).toBe(false); expect([...fixture.records]).toEqual(saved);
});
it('creates and reorders subtasks, checks parent versions, and prevents nesting and invalid relationships', async () => {
  await success({ resource: 'task', action: 'create', task_id: 'child', expected_task_version: version(), data: { title: '子', listId: 'todo', parentTaskId: 'a', assigneeIds: ['u'] } });
  expect(task('child')).toMatchObject({ parentTaskId: 'a', createdBy: 'u' });
  await success({ id: 'second', resource: 'task', action: 'create', task_id: 'child2', expected_task_version: version(), data: { title: '子2', listId: 'todo', parentTaskId: 'a' } });
  await success({ id: 'sort', resource: 'subtasks', action: 'reorder', expected_version: version(), data: { itemId: 'child2', targetId: 'child' } });
  expect(task().subtaskOrderIds).toEqual(['child2', 'child']);
  expect((await write({ id: 'nested', resource: 'task', action: 'create', task_id: 'nested', expected_task_version: version('child'), data: { title: '孫', listId: 'todo', parentTaskId: 'child' } })).results[0].ok).toBe(false);
  task('b').dependsOnTaskIds = ['a'];
  expect((await write({ id: 'cycle', resource: 'task', action: 'patch', expected_version: version(), data: { dependsOnTaskIds: ['b'] } })).results[0].ok).toBe(false);
  await success({ id: 'reparent', resource: 'workflow', action: 'apply', task_id: 'child2', expected_version: version('child2'), data: { action: 'reparent', parentTaskId: 'b' } });
  expect(task('child2').parentTaskId).toBe('b');
});
it('submits and edits own comments, enforces review history, and performs actual review workflow', async () => {
  const comment = await success({ resource: 'comment', action: 'submit', resource_id: 'c', expected_version: version(), data: { content: 'メモ', attachments: [], notifyIds: [] } });
  expect(comment.commentId).toBe('c');
  const read = await readTaskData(auth(), { resource: 'comments', task_id: 'a', resource_id: 'c' }) as { item: { _version: string } };
  await success({ id: 'edit', resource: 'comment', action: 'patch', resource_id: 'c', expected_version: read.item._version, data: { content: '更新' } });
  const review = await success({ id: 'review', resource: 'comment', action: 'submit', resource_id: 'r', expected_version: version(), data: { content: '成果物です', review: { content: '確認', assigneeIds: ['u'], dueDate: null, policy: 'all' } } });
  expect(review.reviewTaskId).toBe('review-r');
  const aggregate = await readTaskData(auth(), { resource: 'task', task_id: 'a' }) as { reviews: { id: string; updatedAt: string }[] };
  expect(aggregate.reviews[0].id).toBe('review-r');
  await success({ id: 'approve', resource: 'workflow', action: 'apply', task_id: 'review-r', expected_version: aggregate.reviews[0].updatedAt, data: { action: 'approve', note: '確認済み' } });
  expect(task().reviewRequests).toMatchObject({ 'review-r': { cycle: { responses: { u: { outcome: 'approved' } } } } });
  const source = await readTaskData(auth(), { resource: 'comments', task_id: 'a', resource_id: 'r' }) as { item: { _version: string } };
  expect((await write({ id: 'erase-review', resource: 'comment', action: 'delete', resource_id: 'r', expected_version: source.item._version, data: {} })).results[0].ok).toBe(false);
});
it('supports checklists, all item mutations and ordering with version and deadline protection', async () => {
  const checklist = await success({ resource: 'checklist', action: 'create', resource_id: 'list', data: { title: '手順', items: [{ id: 'one', text: '一', isChecked: false, order: 0 }, { id: 'two', text: '二', isChecked: false, order: 1 }] } });
  const deadline = await success({ id: 'deadline', resource: 'checklist_item', action: 'mutate', resource_id: 'list', expected_version: checklist.version as string, data: { kind: 'deadline', itemId: 'one', dueDate: '2026-10-10', dueTime: '12:00', deadlinePolicy: 'strict' } });
  expect(task().hasChecklistDeadlines).toBe(true);
  const sorted = await success({ id: 'sort', resource: 'checklist_item', action: 'reorder', resource_id: 'list', expected_version: deadline.version as string, data: { itemId: 'two', targetId: 'one' } });
  expect(fixture.records.get('projects/p/tasks/a/checklists/list')!.items).toMatchObject([{ id: 'two' }, { id: 'one' }]);
  expect((await write({ id: 'stale', resource: 'checklist', action: 'patch', resource_id: 'list', expected_version: checklist.version as string, data: { title: '上書き' } })).results[0].ok).toBe(false);
  await success({ id: 'remove', resource: 'checklist', action: 'delete', resource_id: 'list', expected_version: sorted.version as string, data: {} });
  expect(task().hasChecklistDeadlines).toBe(false);
});
it('sets recurrence and completes once through workflow, preserving the next occurrence on retry', async () => {
  await success({ resource: 'recurrence', action: 'set', expected_version: version(), data: { settings: { seriesId: 'series', unit: 'month', interval: 1, anchorDate: '2026-10-07', endDate: null, listId: 'todo' } } });
  const op = { id: 'done', resource: 'workflow' as const, action: 'apply', expected_version: version(), data: { action: 'complete' } };
  await success(op); expect(task().isCompleted).toBe(true); expect(task('repeat-series-1')).toMatchObject({ recurrence: { occurrence: 1 }, isCompleted: false });
  task('repeat-series-1').title = '次回編集'; await success(op); expect(task('repeat-series-1').title).toBe('次回編集');
});
it('writes own comment reactions and scopes completion policy processing to this task', async () => {
  await success({ resource: 'comment', action: 'submit', resource_id: 'c', expected_version: version(), data: { content: 'メモ' } });
  await success({ id: 'react', resource: 'reaction', action: 'set', data: { commentId: 'c', kind: 'seen', active: true, stampId: 'wave' } });
  expect(await readTaskData(auth(), { resource: 'reactions', task_id: 'a', comment_id: 'c' })).toMatchObject({ items: [{ userId: 'u', marks: { seen: { stampId: 'wave' } } }] });
  fixture.records.set('projects/p/tasks/child', { ...base, parentTaskId: 'a' });
  await success({ id: 'policy', resource: 'completion_policy', action: 'set', expected_version: version(), data: { policy: { condition: '子を完了', required: [{ taskId: 'child', assigneeId: 'u' }] } } });
  expect(task().completionPolicy).toMatchObject({ grantedBy: 'u', required: [{ taskId: 'child' }] });
});
it('uploads immutable bytes, reads registered content in bounded ranges and rejects external/path/hash attacks', async () => {
  const bytes = Buffer.from('架空の添付です'), data = { name: '確認.txt', type: 'text/plain', base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
  const uploaded = await success({ resource: 'attachment', action: 'upload', resource_id: 'file', data });
  const read = await readTaskData(auth(), { resource: 'attachment_content', task_id: 'a', resource_id: 'file', offset: 0, length: 4 }) as { base64: string; next_offset: number };
  expect(Buffer.from(read.base64, 'base64')).toEqual(bytes.subarray(0, 4)); expect(read.next_offset).toBe(4);
  await success({ resource: 'attachment', action: 'upload', resource_id: 'file', data }); expect(fake.files.size).toBe(1);
  expect(() => validateUpload({ ...data, sha256: '0'.repeat(64) })).toThrow();
  expect(() => ownedObject('https://example.test/file', 'p', 'a')).toThrow();
  expect(() => ownedObject('https://firebasestorage.googleapis.com/v0/b/fictional.appspot.com/o/projects%2Fother%2Ftasks%2Fa%2Fattachments%2Fx', 'p', 'a')).toThrow('添付');
  await success({ id: 'delete-file', resource: 'attachment', action: 'delete', resource_id: 'file', expected_version: uploaded.version as string, data: {} });
  await expect(readTaskData(auth(), { resource: 'attachment_content', task_id: 'a', resource_id: 'file' })).rejects.toThrow('見つかりません');
});
it('drains pages without truncation and refuses cursors copied across resources', async () => {
  for (let i = 0; i < 7; i++) fixture.records.set(`projects/p/tasks/a/comments/c${i}`, { content: String(i) });
  let cursor: string | undefined; const ids = [];
  do { const result = await readTaskData(auth(), { resource: 'comments', task_id: 'a', limit: 2, ...(cursor ? { cursor } : {}) }) as { items: { id: string }[]; next_cursor: string | null }; ids.push(...result.items.map(row => row.id)); cursor = result.next_cursor ?? undefined; } while (cursor);
  expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7);
  const first = await readTaskData(auth(), { resource: 'comments', task_id: 'a', limit: 2 }) as { next_cursor: string };
  await expect(readTaskData(auth(), { resource: 'checklists', task_id: 'a', cursor: first.next_cursor })).rejects.toThrow('ページ');
});
it('reports partial batch success and unattempted operations honestly', async () => {
  const output = await writeTaskData(auth(), { operations: [
    { id: 'first', resource: 'task', action: 'patch', task_id: 'a', expected_version: version(), data: { title: '反映済み' } },
    { id: 'conflict', resource: 'task', action: 'patch', task_id: 'a', expected_version: version(), data: { title: '古い' } },
    { id: 'last', resource: 'task', action: 'patch', task_id: 'b', expected_version: version('b'), data: { title: '未実行' } },
  ] });
  expect(output).toMatchObject({ atomic: false, stopped_at: 1, unattempted_ids: ['last'], results: [{ ok: true }, { ok: false, error: { code: 'VERSION_CONFLICT' } }] });
  expect(task().title).toBe('反映済み'); expect(task('b').title).toBe('次の仕事');
});
