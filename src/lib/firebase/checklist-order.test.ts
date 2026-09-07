import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reorderChecklistItem } from './checklist-order';
import { moveChecklistItem, sortedChecklistItems } from '@/lib/utils/checklist';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), runTransaction: vi.fn(), doc: vi.fn(() => 'checklist-ref') }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, runTransaction: mocks.runTransaction }));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db' }));

const items = [
  { id: 'b', text: '箱', isChecked: true, order: 20 },
  { id: 'a', text: 'シール', isChecked: false, order: 10 },
  { id: 'c', text: 'テープ', isChecked: false, order: 30 },
];

describe('checklist order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ items }) });
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback({ get: mocks.get, update: mocks.update }));
  });

  it('moves only order, preserves checked/text/extra fields, and does not mutate input', () => {
    const original = structuredClone(items);
    expect(sortedChecklistItems(items).map(item => item.id)).toEqual(['a', 'b', 'c']);
    const result = moveChecklistItem(items, 'a', 'c');
    expect(result.map(item => [item.id, item.order])).toEqual([['b', 0], ['c', 1], ['a', 2]]);
    expect(result[0]).toMatchObject({ text: '箱', isChecked: true });
    expect(moveChecklistItem(result, 'a', 'b').map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(items).toEqual(original);
  });

  it('updates only the requested checklist using its latest item contents', async () => {
    const latest = [...items, { id: 'd', text: '他の人が追加', isChecked: true, order: 40 }].map(item => item.id === 'a' ? { ...item, text: '最新のシール', isChecked: true } : item);
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ title: 'そのまま', items: latest }) });
    const saved = await reorderChecklistItem('project', 'task', 'list', 'a', 'c');
    expect(mocks.doc).toHaveBeenCalledWith('db', 'projects', 'project', 'tasks', 'task', 'checklists', 'list');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('checklist-ref', { items: saved });
    expect(saved.map(item => item.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(saved[2]).toMatchObject({ text: '最新のシール', isChecked: true });
    expect(saved[3]).toMatchObject({ text: '他の人が追加', isChecked: true });
  });

  it('recalculates the move on a transaction retry instead of reusing stale items', async () => {
    mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ items }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: items.map(item => ({ ...item, isChecked: true })) }) });
    mocks.runTransaction.mockImplementation(async (_db, callback) => {
      await callback({ get: mocks.get, update: mocks.update });
      return callback({ get: mocks.get, update: mocks.update });
    });
    const result = await reorderChecklistItem('p', 't', 'c', 'a', 'b');
    expect(result.every(item => item.isChecked)).toBe(true);
  });

  it('skips same-position writes and rejects stale or duplicate IDs without dropping items', async () => {
    await reorderChecklistItem('p', 't', 'c', 'a', 'a');
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(reorderChecklistItem('p', 't', 'c', 'a', 'deleted')).rejects.toThrow('項目が変更');
    expect(() => moveChecklistItem([...items, items[0]], 'a', 'b')).toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted checklist and propagates offline/permission failures', async () => {
    mocks.get.mockResolvedValue({ exists: () => false });
    await expect(reorderChecklistItem('p', 't', 'c', 'a', 'b')).rejects.toThrow('見つかりません');
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.runTransaction.mockRejectedValue(new Error('permission-denied'));
    await expect(reorderChecklistItem('p', 't', 'c', 'a', 'b')).rejects.toThrow('permission-denied');
  });
});
