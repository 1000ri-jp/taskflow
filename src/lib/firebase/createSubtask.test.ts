import { beforeEach, expect, it, vi } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import type { Task } from '@/types';
const fake = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), writes: [] as Record<string, unknown>[], fail: false, addDoc: vi.fn() }));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db' }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.length ? parts.join('/') : `${_db}/new-child`, id: 'new-child' }),
  serverTimestamp: () => 'SERVER_TIME',
  addDoc: fake.addDoc,
  getDoc: async (ref: { path: string; id: string }) => ({ id: ref.id, exists: () => fake.data.has(ref.path), data: () => fake.data.get(ref.path) }),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => unknown) => {
    const writes: Record<string, unknown>[] = [];
    await fn({ get: async (ref: { path: string }) => ({ exists: () => fake.data.has(ref.path), data: () => fake.data.get(ref.path) }), set: (ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data }) });
    if (fake.fail) throw new Error('offline');
    fake.writes.push(...writes);
  },
}));
import { createTask } from './firestore';
const data = Object.fromEntries(Object.entries(viewTask({ parentTaskId: 'parent', listId: 'list', title: '金額を確認', assigneeIds: [] })).filter(([key]) => !['id', 'projectId', 'createdAt', 'updatedAt'].includes(key))) as Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>;
beforeEach(() => {
  fake.data.clear(); fake.writes = []; fake.fail = false; fake.addDoc.mockReset();
  fake.data.set('projects/p', { isArchived: false, memberIds: ['user-1', 'user-2'], defaultAssigneeId: 'user-1' });
  fake.data.set('projects/p/tasks/parent', { projectId: 'p', listId: 'list', title: '請求書作成' });
  fake.data.set('projects/p/lists/list', {});
});
it('writes the new task with its parent atomically and leaves the parent unchanged', async () => {
  const before = structuredClone(fake.data);
  expect(await createTask('p', data)).toBe('new-child');
  expect(fake.writes).toEqual([{ path: 'projects/p/tasks/new-child', data: { ...data, projectId: 'p', createdAt: 'SERVER_TIME', updatedAt: 'SERVER_TIME' } }]);
  expect(fake.data).toEqual(before);
  expect(fake.addDoc).not.toHaveBeenCalled();
});
it.each(['missing-parent', 'archived-parent', 'abandoned-parent', 'moved-parent', 'foreign-parent', 'missing-list', 'archived-project'])('rejects %s without creating a standalone orphan', async state => {
  const parent = fake.data.get('projects/p/tasks/parent')!;
  if (state === 'missing-parent') fake.data.delete('projects/p/tasks/parent');
  if (state === 'archived-parent') parent.isArchived = true;
  if (state === 'abandoned-parent') parent.isAbandoned = true;
  if (state === 'moved-parent') parent.listId = 'elsewhere';
  if (state === 'foreign-parent') parent.projectId = 'elsewhere';
  if (state === 'missing-list') fake.data.delete('projects/p/lists/list');
  if (state === 'archived-project') fake.data.get('projects/p')!.isArchived = true;
  await expect(createTask('p', data)).rejects.toThrow();
  expect(fake.writes).toEqual([]); expect(fake.addDoc).not.toHaveBeenCalled();
});
it('does not create anything on failed commit', async () => {
  fake.fail = true;
  await expect(createTask('p', data)).rejects.toThrow('offline');
  expect(fake.writes).toEqual([]);
});
it('keeps existing standalone creation on its usual path', async () => {
  const standalone = { ...data };
  delete standalone.parentTaskId;
  fake.addDoc.mockResolvedValue({ id: 'standalone' });
  expect(await createTask('p', standalone)).toBe('standalone');
  expect(fake.addDoc).toHaveBeenCalledOnce(); expect(fake.writes).toEqual([]);
});

it('inherits the parent only when assignment was omitted, including an unassigned parent', async () => {
  fake.data.get('projects/p/tasks/parent')!.assigneeIds = ['user-2'];
  const withoutAssignment: Parameters<typeof createTask>[1] = { ...data };
  delete withoutAssignment.assigneeIds;
  await createTask('p', withoutAssignment);
  expect(fake.writes[0].data).toMatchObject({ assigneeIds: ['user-2'] });
  fake.writes = []; fake.data.get('projects/p/tasks/parent')!.assigneeIds = [];
  await createTask('p', withoutAssignment);
  expect(fake.writes[0].data).toMatchObject({ assigneeIds: [] });
});
it('uses the project default for new work, keeps explicit unassignment and never updates existing tasks', async () => {
  const newTask: Parameters<typeof createTask>[1] = { ...data };
  delete newTask.assigneeIds;
  delete newTask.parentTaskId;
  fake.addDoc.mockResolvedValue({ id: 'standalone' });
  await createTask('p', newTask);
  expect(fake.addDoc.mock.calls[0][1]).toMatchObject({ assigneeIds: ['user-1'] });
  await createTask('p', { ...newTask, assigneeIds: [] });
  expect(fake.addDoc.mock.calls[1][1]).toMatchObject({ assigneeIds: [] });
  expect(fake.writes).toEqual([]);
});

it('uses the list default before the project default when assignment is omitted', async () => {
  const standalone: Parameters<typeof createTask>[1] = { ...data };
  delete standalone.assigneeIds;
  delete standalone.parentTaskId;
  fake.data.get('projects/p/lists/list')!.defaultAssigneeId = 'user-2';
  fake.addDoc.mockResolvedValue({ id: 'standalone' });
  await createTask('p', standalone);
  expect(fake.addDoc.mock.calls[0][1]).toMatchObject({ assigneeIds: ['user-2'] });
  await createTask('p', { ...standalone, assigneeIds: [] });
  expect(fake.addDoc.mock.calls[1][1]).toMatchObject({ assigneeIds: [] });
});
