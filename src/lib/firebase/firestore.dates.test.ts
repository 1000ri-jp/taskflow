import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ paths: false, add: vi.fn(), update: vi.fn(), get: vi.fn(), txUpdate: vi.fn(), txSet: vi.fn(), moai: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...parts: string[]) => mock.paths ? { path: parts.join('/') } : 'tasks'),
  doc: vi.fn((parent, ...parts: string[]) => mock.paths ? { path: parts.length ? parts.join('/') : `${parent.path}/generated` } : 'task-ref'), addDoc: mock.add, updateDoc: mock.update,
  runTransaction: vi.fn(async (_db, callback) => callback({ get: mock.get, update: mock.txUpdate, set: mock.txSet })),
  deleteDoc: vi.fn(), getDoc: vi.fn(async () => ({ id: 'p', exists: () => true, data: () => ({ memberIds: ['u','user-1'], isArchived: false }) })), getDocs: vi.fn(), getDocsFromServer: vi.fn(), setDoc: vi.fn(), query: vi.fn(), where: vi.fn(),
  orderBy: vi.fn(), onSnapshot: vi.fn(), serverTimestamp: () => 'SERVER_TIMESTAMP', writeBatch: vi.fn(), Timestamp: class {}, documentId: vi.fn(), limit: vi.fn(),
}));
vi.mock('./moaiLabel', () => ({ ensureMoaiLabel: mock.moai }));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db', getFirebaseAuth: () => ({currentUser:{uid:'u',displayName:'本人'}}) }));
import { archiveTask, createTask, restoreTask, updateTask } from './firestore';
import { viewTask } from '@/test/taskViewFixtures';
beforeEach(() => { vi.clearAllMocks(); mock.paths = false; mock.add.mockResolvedValue({id:'new'}); });
describe('task write date guard', () => {
  it('blocks invalid creation before writing and permits a same-day task', async () => {
    const task = viewTask({ startDate: new Date('2026-09-20T00:00:00+09:00'), dueDate: new Date('2026-09-16T00:00:00+09:00') });
    await expect(createTask('p', task)).rejects.toThrow('開始日は期限以前');
    expect(mock.add).not.toHaveBeenCalled();
    await expect(createTask('p', { ...task, startDate: task.dueDate })).resolves.toBe('new');
  });
  it('compares a partial edit with the current stored other date and writes nothing on failure', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ startDate: {toDate: () => new Date('2026-09-20')}, dueDate: {toDate: () => new Date('2026-09-25')} }) });
    await expect(updateTask('p','t',{dueDate:new Date('2026-09-16')})).rejects.toThrow('開始日は期限以前');
    expect(mock.txUpdate).not.toHaveBeenCalled(); expect(mock.txSet).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    await expect(updateTask('p','t',{startDate:new Date('2026-09-26')})).rejects.toThrow('開始日は期限以前');
    expect(mock.txUpdate).not.toHaveBeenCalled();
  });
  it('allows repairing legacy dates, including clearing one side, without blocking unrelated edits', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ startDate: new Date('2026-09-20'), dueDate: new Date('2026-09-16') }) });
    await updateTask('p','t',{startDate:null});
    expect(mock.txUpdate).toHaveBeenCalledWith('task-ref',{startDate:null,updatedAt:'SERVER_TIMESTAMP'});
    await updateTask('p','t',{startDate:new Date('2026-09-15'),dueDate:new Date('2026-09-16')});
    await updateTask('p','t',{title:'タイトル'});
    expect(mock.txUpdate).toHaveBeenCalledWith('task-ref',{title:'タイトル',updatedAt:'SERVER_TIMESTAMP'});
    expect(mock.txSet).toHaveBeenLastCalledWith('task-ref',expect.objectContaining({userId:'u',changes:[{field:'title',oldValue:'',newValue:'タイトル'}]}));
  });
});



it('adds the Moai label for AI creation while retaining caller labels and leaves manual creation unchanged',async()=>{
 mock.moai.mockResolvedValue('existing-moai');
 const task=viewTask({aiSuggested:true,labelIds:['keep','existing-moai']});
 await createTask('p',task);
 expect(mock.moai).toHaveBeenCalledExactlyOnceWith('p');
 expect(mock.add).toHaveBeenCalledWith('tasks',expect.objectContaining({labelIds:['keep','existing-moai'],aiSuggested:true}));
 expect(task.labelIds).toEqual(['keep','existing-moai']);
 mock.moai.mockClear();await createTask('p',viewTask({labelIds:['keep']}));
 expect(mock.moai).not.toHaveBeenCalled();
 expect(mock.add).toHaveBeenLastCalledWith('tasks',expect.objectContaining({labelIds:['keep']}));
});

it('does not create a false update or history entry when values are unchanged', async () => {
  const dueDate = new Date('2026-09-18');
  mock.get.mockResolvedValue({ exists: () => true, data: () => ({ title: '同じ', dueDate: {toDate: () => dueDate} }) });
  await updateTask('p', 't', {title: '同じ', dueDate});
  expect(mock.txUpdate).not.toHaveBeenCalled(); expect(mock.txSet).not.toHaveBeenCalled();
});
it('records the saved before/after values and actor in the same transaction as the edit', async () => {
  mock.get.mockResolvedValue({ exists: () => true, data: () => ({ title:'元', dueDate: new Date('2026-09-16') }) });
  const dueDate = new Date('2026-09-18');
  await updateTask('p','t',{title:'変更',dueDate});
  expect(mock.txUpdate).toHaveBeenCalledExactlyOnceWith('task-ref',{title:'変更',dueDate,updatedAt:'SERVER_TIMESTAMP'});
  expect(mock.txSet).toHaveBeenCalledExactlyOnceWith('task-ref',expect.objectContaining({targetId:'t',targetName:'変更',userId:'u',userName:'本人',createdAt:'SERVER_TIMESTAMP',changes:[{field:'title',oldValue:'元',newValue:'変更'},{field:'dueDate',oldValue:'2026-09-16T00:00:00.000Z',newValue:'2026-09-18T00:00:00.000Z'}]}));
  expect(mock.update).not.toHaveBeenCalled();
});

it('stamps browser creation, edits, archive and restore atomically, leaving activity records unstamped', async () => {
  mock.paths = true;
  await createTask('p', viewTask());
  expect(mock.add).toHaveBeenCalledWith({ path: 'projects/p/tasks' }, expect.objectContaining({ apiChangedAt: 'SERVER_TIMESTAMP' }));
  mock.get.mockResolvedValue({ exists: () => true, data: () => ({ title: 'old', listId: 'todo' }) });
  await updateTask('p', 't', { title: 'new', listId: 'done' });
  expect(mock.txUpdate).toHaveBeenCalledWith({ path: 'projects/p/tasks/t' }, expect.objectContaining({ title: 'new', listId: 'done', apiChangedAt: 'SERVER_TIMESTAMP' }));
  expect(mock.txSet.mock.calls[0][1]).not.toHaveProperty('apiChangedAt');
  await archiveTask('p', 't', 'u'); await restoreTask('p', 't');
  expect(mock.update.mock.calls.map(args => args[1])).toMatchObject([{ isArchived: true, apiChangedAt: 'SERVER_TIMESTAMP' }, { isArchived: false, apiChangedAt: 'SERVER_TIMESTAMP' }]);
});
