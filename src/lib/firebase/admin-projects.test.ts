import { beforeEach, expect, it, vi } from 'vitest';
import { getAdminDb } from './admin';
import { createProjectTask } from './admin-projects';

vi.mock('./admin', () => ({ getAdminDb: vi.fn() }));
const docs = new Map<string, Record<string, unknown>>();
const writes = vi.fn();
function snapshot(path: string) {
  return { id: path.split('/').at(-1), exists: docs.has(path), data: () => docs.get(path) };
}
function reference(path: string) {
  return { path, id: path.split('/').at(-1), get: async () => snapshot(path), collection: (name: string) => collection(`${path}/${name}`) };
}
function collection(path: string) {
  const value = {
    doc: (id: string) => reference(`${path}/${id}`),
    get: async () => ({ docs: [...docs.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(snapshot) }),
    orderBy: () => value,
    add: async (data: Record<string, unknown>) => {
      const key = `${path}/new`; writes(key, data); docs.set(key, data); return reference(key);
    },
  };
  return value;
}
beforeEach(() => {
  docs.clear(); writes.mockClear();
  docs.set('projects/p', { memberIds: ['main', 'other'], defaultAssigneeId: 'main', isArchived: false });
  docs.set('projects/p/lists/list', { name: '未着手', order: 0 });
  vi.mocked(getAdminDb).mockReturnValue({ collection } as unknown as ReturnType<typeof getAdminDb>);
});

it.each([
  [undefined, ['main']],
  [[], []],
  [['other'], ['other']],
] as [string[] | undefined, string[]][])('API creation preserves default vs explicit assignment: %j', async (explicit, expected) => {
  const result = await createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事', assigneeIds: explicit });
  expect(result.task.assigneeIds).toEqual(expected);
  expect(docs.get('projects/p/tasks/new')?.assigneeIds).toEqual(expected);
  expect(writes).toHaveBeenCalledOnce();
});
it('does not assign a departed default or rewrite existing tasks', async () => {
  docs.set('projects/p', { memberIds: ['other'], defaultAssigneeId: 'main' });
  docs.set('projects/p/tasks/existing', { title: '既存', listId: 'list', assigneeIds: ['other'] });
  const result = await createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事' });
  expect(result.task.assigneeIds).toEqual([]);
  expect(docs.get('projects/p/tasks/existing')?.assigneeIds).toEqual(['other']);
  expect(writes).toHaveBeenCalledOnce();
});
it('uses unassigned when the project has no default', async () => {
  docs.set('projects/p', { memberIds: ['other'] });
  expect((await createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事' })).task.assigneeIds).toEqual([]);
});
it('uses the list primary assignee ahead of the project primary assignee', async () => {
  docs.set('projects/p/lists/list', { name: '未着手', order: 0, defaultAssigneeId: 'other' });
  const result = await createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事' });
  expect(result.task.assigneeIds).toEqual(['other']);
  expect(docs.get('projects/p/tasks/new')?.assigneeIds).toEqual(['other']);
});
it('ignores a list primary assignee who is no longer a project member', async () => {
  docs.set('projects/p/lists/list', { name: '未着手', order: 0, defaultAssigneeId: 'left' });
  const result = await createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事' });
  expect(result.task.assigneeIds).toEqual(['main']);
});
it('rejects an explicit non-member before saving', async () => {
  await expect(createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事', assigneeIds: ['outsider'] })).rejects.toThrow('INVALID_ASSIGNEE');
  expect(writes).not.toHaveBeenCalled();
});
it('does not write when project retrieval fails', async () => {
  docs.delete('projects/p');
  await expect(createProjectTask('p', 'other', { listId: 'list', title: '新しい仕事' })).rejects.toThrow('NOT_FOUND');
  expect(writes).not.toHaveBeenCalled();
});
