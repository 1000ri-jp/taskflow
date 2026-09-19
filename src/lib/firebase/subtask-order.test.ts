import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reorderTaskSubtasks } from './subtask-order';

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => `${parts.at(-1)}-ref`),
  collection: vi.fn(() => 'tasks'),
  query: vi.fn(() => 'query'),
  where: vi.fn(() => 'where'),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: mocks.collection, doc: mocks.doc, getDocs: mocks.getDocs,
  query: mocks.query, runTransaction: mocks.runTransaction, where: mocks.where,
}));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db' }));

const parent = { projectId: 'p', isArchived: false, subtaskOrderIds: ['a', 'b'] };
const child = (id: string, dueDate: Date) => ({ projectId: 'p', parentTaskId: 'parent', isArchived: false, taskKind: undefined, dueDate, order: 0 });

describe('reorderTaskSubtasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocs.mockResolvedValue({ docs: [{ id: 'a' }, { id: 'b' }] });
    mocks.get.mockImplementation(async (reference: string) => {
      if (reference === 'parent-ref') return { exists: () => true, data: () => parent };
      if (reference === 'a-ref') return { exists: () => true, id: 'a', data: () => child('a', new Date('2026-09-20')) };
      if (reference === 'b-ref') return { exists: () => true, id: 'b', data: () => child('b', new Date('2026-09-15')) };
      return { exists: () => false };
    });
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback({ get: mocks.get, update: mocks.update }));
  });

  it('saves only the parent ordering field, without changing child task order or timestamps', async () => {
    await reorderTaskSubtasks('p', 'parent', ['a', 'b'], ['b', 'a']);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('parent-ref', { subtaskOrderIds: ['b', 'a'] });
  });

  it('rejects a stale visible order without writing', async () => {
    await expect(reorderTaskSubtasks('p', 'parent', ['b', 'a'], ['a', 'b'])).rejects.toThrow('変更されています');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('skips a no-op and rejects a missing parent', async () => {
    await reorderTaskSubtasks('p', 'parent', ['a', 'b'], ['a', 'b']);
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.get.mockResolvedValueOnce({ exists: () => false });
    await expect(reorderTaskSubtasks('p', 'parent', ['a', 'b'], ['b', 'a'])).rejects.toThrow('見つかりません');
  });

  it('rejects duplicate or incomplete ID lists before reading', async () => {
    await expect(reorderTaskSubtasks('p', 'parent', ['a', 'a'], ['a', 'a'])).rejects.toThrow('順序を確認');
    await expect(reorderTaskSubtasks('p', 'parent', ['a', 'b'], ['a'])).rejects.toThrow('変更されています');
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
