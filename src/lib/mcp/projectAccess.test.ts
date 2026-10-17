// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { taskFirestore } from './taskData.fixture';
import { readTaskData, writeTaskData, type TaskPrincipal } from './taskData';
import { saveCoordinationDelegation, loadCoordinationDelegation } from './coordinatorTransport';
const fake = vi.hoisted(() => ({ db: null as unknown, storage: vi.fn(), revokeDuringDownload: false }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getAdminStorage: fake.storage }));
vi.mock('@/lib/task/changeStamp.server', () => ({ stampTaskWrite: (_ref: unknown, data: unknown) => data }));
vi.mock('./oidc', () => ({ activeUser: vi.fn(), oidcConfig: () => ({ productionEnabled: true, taskAccessEnabled: true, multiProjectReadEnabled: true, clientId: 'client', clientIds: ['client'], resource: 'resource' }) }));
let fixture: ReturnType<typeof taskFirestore>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bindingPath = 'mcpOAuthGrants/' + hash('grant');
const original = new Date('2026-10-01T00:00:00Z');
const auth = (): TaskPrincipal => ({ userId: 'u', grantId: 'grant', expiresAt: Date.now() + 60000, authorizationExpiresAt: Date.now() + 60000,
  projectIds: ['p', 'q'], writeProjectIds: ['q'], aiProjectIds: [], eventProjectIds: [], consentVersion: 2, includeFutureProjects: false,
  taskScopes: ['tasks:read', 'tasks:write'], permissions: ['tasks:read', 'tasks:write'] });
const patch = () => ({ project_id: 'q', operations: [{ id: 'patch', resource: 'task', action: 'patch', task_id: 'a', expected_version: original.toISOString(), data: { title: '変更済み' } }] });
const task = (p: string) => fixture.records.get('projects/' + p + '/tasks/a')!;
beforeEach(() => {
  fixture = taskFirestore(); fake.db = fixture.db; fake.revokeDuringDownload = false;
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'fictional.appspot.com'); vi.stubEnv('SLOWTH_MCP_COORDINATION_PROJECT_IDS', 'q');
  fake.storage.mockImplementation(() => ({ bucket: () => ({ file: () => ({ getMetadata: async () => [{ size: 2, generation: '1' }],
    createReadStream: async function* () { if (fake.revokeDuringDownload) fixture.records.delete('projects/p/members/u'); yield Buffer.from('ok'); },
  }) }) }));
  for (const id of ['p', 'q', 'r']) {
    fixture.records.set('projects/' + id, { name: '架空' + id, memberIds: ['u'], isArchived: false, updatedAt: original });
    fixture.records.set('projects/' + id + '/members/u', { userId: 'u', role: id === 'p' ? 'viewer' : 'editor' });
    fixture.records.set('projects/' + id + '/lists/todo', { name: '作業', order: 0 });
    fixture.records.set('projects/' + id + '/tasks/a', { projectId: id, listId: 'todo', title: id + 'の仕事', description: '本文', order: 0,
      assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null,
      isDueDateFixed: true, isCompleted: false, isArchived: false, createdAt: original, updatedAt: original, createdBy: 'u' });
    fixture.records.set('projects/' + id + '/tasks/a/comments/c', { content: id + 'のコメント', authorId: 'u', updatedAt: original });
    fixture.records.set('projects/' + id + '/tasks/a/attachments/file', { name: '資料', type: 'text/plain', size: 2,
      url: 'https://firebasestorage.googleapis.com/v0/b/fictional.appspot.com/o/' + encodeURIComponent('projects/' + id + '/tasks/a/attachments/file') + '?alt=media&token=fixture' });
  }
  fixture.records.set('users/u', { displayName: '架空ユーザー' }); fixture.records.set('users/u/settings/aiSettings', { allowedProjectIds: ['q'] });
  fixture.records.set(bindingPath, { ...auth(), mode: 'production', clientId: 'client', resource: 'resource', authTime: 123, expiresAt: new Date(Date.now() + 60000) });
  fixture.records.set('mcpOAuthState/' + hash('Grant:grant'), { expiresAt: new Date(Date.now() + 60000) });
});
afterEach(() => vi.unstubAllEnvs());
it('lists and paginates only consented projects with independent effective permissions', async () => {
  const first = await readTaskData(auth(), { resource: 'projects', limit: 1 }) as { items: unknown[]; next_cursor: string };
  expect(first.items).toEqual([{ id: 'p', name: '架空p', role: 'viewer', permissions: { read: true, write: false, ai_work: false, events: false } }]);
  const second = await readTaskData(auth(), { resource: 'projects', cursor: first.next_cursor, limit: 1 });
  expect(second).toMatchObject({ items: [{ id: 'q', permissions: { write: true, ai_work: false, events: false } }], next_cursor: null, include_future_projects: false });
  expect(JSON.stringify([first, second])).not.toContain('架空r');
  await expect(readTaskData({ ...auth(), grantId: 'different' }, { resource: 'projects', cursor: first.next_cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});
it('allows progress and viewer reads independently of AI work settings', async () => {
  expect(await readTaskData(auth(), { project_id: 'p', resource: 'project_status' })).toMatchObject({ project: { id: 'p' }, summary: { totalTasks: 1, completedTasks: 0 } });
  expect(await readTaskData(auth(), { project_id: 'p', resource: 'task', task_id: 'a' })).toMatchObject({ task: { title: 'pの仕事' }, comments: { items: [{ content: 'pのコメント' }] } });
});
it.each(['tasks', 'task', 'comments', 'checklists', 'attachments', 'subtasks', 'history', 'reactions', 'attachment_content', 'coordination_context', 'project_status'])('denies unconsented projects for %s before returning any resource', async resource => {
  await expect(readTaskData(auth(), { project_id: 'r', resource, task_id: 'a', comment_id: 'c', resource_id: 'file' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(fake.storage).not.toHaveBeenCalled();
});
it('requires an explicit target instead of silently selecting the first of several projects', async () => {
  await expect(readTaskData(auth(), { resource: 'tasks' })).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
  await expect(writeTaskData(auth(), { operations: [] })).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
});
it('does not add newly visible projects to an existing grant or accept a forged wider principal', async () => {
  const before = structuredClone(fixture.records.get(bindingPath));
  const principal = { ...auth(), projectIds: ['p', 'q', 'r'] };
  await expect(readTaskData(principal, { project_id: 'r', resource: 'tasks' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(fixture.records.get(bindingPath)).toEqual(before);
});
it.each(['array', 'role-document', 'invalid-role', 'archived'])('denies tasks and children after %s access loss while keeping other projects readable', async reason => {
  if (reason === 'array') fixture.records.get('projects/p')!.memberIds = [];
  if (reason === 'role-document') fixture.records.delete('projects/p/members/u');
  if (reason === 'invalid-role') fixture.records.get('projects/p/members/u')!.role = 'owner';
  if (reason === 'archived') fixture.records.get('projects/p')!.isArchived = true;
  for (const resource of ['task', 'comments', 'subtasks', 'attachment_content']) await expect(readTaskData(auth(), { project_id: 'p', resource, task_id: 'a', resource_id: 'file' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await readTaskData(auth(), { project_id: 'q', resource: 'task', task_id: 'a' })).toMatchObject({ task: { title: 'qの仕事' } });
  expect(await readTaskData(auth(), { resource: 'projects' })).toMatchObject({ items: [{ id: 'q' }] });
});
it('checks the exact attachment path and rechecks membership after downloading bytes', async () => {
  expect(await readTaskData(auth(), { project_id: 'p', resource: 'attachment_content', task_id: 'a', resource_id: 'file' })).toMatchObject({ base64: Buffer.from('ok').toString('base64') });
  fixture.records.get('projects/p/tasks/a/attachments/file')!.url = fixture.records.get('projects/r/tasks/a/attachments/file')!.url;
  await expect(readTaskData(auth(), { project_id: 'p', resource: 'attachment_content', task_id: 'a', resource_id: 'file' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  fixture.records.get('projects/p/tasks/a/attachments/file')!.url = 'https://firebasestorage.googleapis.com/v0/b/fictional.appspot.com/o/' + encodeURIComponent('projects/p/tasks/a/attachments/file');
  fake.revokeDuringDownload = true;
  await expect(readTaskData(auth(), { project_id: 'p', resource: 'attachment_content', task_id: 'a', resource_id: 'file' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('permits writes only in the separately consented project, including all child operation kinds', async () => {
  const before = structuredClone([...fixture.records]);
  for (const resource of ['task', 'comment', 'checklist', 'attachment', 'subtasks', 'reaction']) await expect(writeTaskData(auth(), { project_id: 'p', operations: [{ id: 'denied', resource, action: 'patch', task_id: 'a', data: {} }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect([...fixture.records]).toEqual(before);
  expect(await writeTaskData(auth(), patch())).toMatchObject({ results: [{ ok: true }] }); expect(task('q').title).toBe('変更済み');
});
it('rechecks write consent inside the transaction and rolls back if it was removed', async () => {
  const run = fixture.db.runTransaction;
  fixture.db.runTransaction = async callback => { fixture.records.get(bindingPath)!.writeProjectIds = []; return run(callback); };
  expect(await writeTaskData(auth(), patch())).toMatchObject({ results: [{ ok: false, error: { code: 'FORBIDDEN' } }] }); expect(task('q').title).toBe('qの仕事');
});
it('does not infer AI coordination or delegation authority from ordinary write consent', async () => {
  const before = structuredClone([...fixture.records]);
  const output = await writeTaskData(auth(), { project_id: 'q', operations: [{ id: 'work', resource: 'coordination_policy', action: 'set', data: {} }] });
  expect(output).toMatchObject({ results: [{ ok: false, error: { code: 'FORBIDDEN' } }] });
  await expect(fixture.db.runTransaction(tx => saveCoordinationDelegation(tx as never, auth(), 'q', 'plan'))).rejects.toMatchObject({ code: 'DELEGATION_REVOKED' });
  expect([...fixture.records]).toEqual(before);
});
it('narrows an explicitly permitted AI delegation to one project and revokes it with source AI consent', async () => {
  const principal = { ...auth(), aiProjectIds: ['q'] }; fixture.records.get(bindingPath)!.aiProjectIds = ['q'];
  await fixture.db.runTransaction(tx => saveCoordinationDelegation(tx as never, principal, 'q', 'plan'));
  const delegated = await loadCoordinationDelegation('q', 'plan');
  expect(delegated).toMatchObject({ consentVersion: 2, projectIds: ['q'], writeProjectIds: ['q'], aiProjectIds: ['q'], eventProjectIds: [], includeFutureProjects: false });
  await readTaskData(delegated, { resource: 'task', task_id: 'a' });
  fixture.records.get(bindingPath)!.aiProjectIds = [];
  await expect(readTaskData(delegated, { resource: 'task', task_id: 'a' })).rejects.toMatchObject({ code: 'DELEGATION_REVOKED' });
});
it('refuses revoked and expired v2 bindings even when a previously authenticated principal is reused', async () => {
  fixture.records.get(bindingPath)!.expiresAt = new Date(0);
  await expect(readTaskData(auth(), { project_id: 'p', resource: 'tasks' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  fixture.records.delete(bindingPath);
  await expect(readTaskData(auth(), { project_id: 'q', resource: 'comments', task_id: 'a' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
