import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem } from '@/types';
import type { ChecklistItemMutation } from '@/lib/utils/checklist-item';

const fake = vi.hoisted(() => ({
  data: new Map<string, Record<string, unknown>>(),
  writes: [] as { path: string; data: Record<string, unknown> }[],
  reads: [] as string[], uid: 'u', failure: '',
  retry: null as (() => void) | null,
  onRead: null as ((path: string) => void) | null,
  runTransaction: vi.fn(), doc: vi.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
}));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db', getFirebaseAuth: () => ({ currentUser: fake.uid ? { uid: fake.uid } : null }) }));
vi.mock('firebase/firestore', () => ({ doc: fake.doc, runTransaction: fake.runTransaction }));
import { mutateChecklistItem } from './checklist-item';

const taskPath = 'projects/p/tasks/task';
const listPath = `${taskPath}/checklists/list`;
const items: ChecklistItem[] = [
  { id: 'a', text: '箱', isChecked: false, order: 20, dueDate: '2026-09-15' },
  { id: 'b', text: 'シール', isChecked: true, order: 4 },
];
const dateAction: ChecklistItemMutation = { kind: 'dueDate', itemId: 'a', dueDate: '2026-10-01' };
beforeEach(() => {
  vi.clearAllMocks(); fake.data.clear(); fake.writes = []; fake.reads = []; fake.uid = 'u'; fake.failure = ''; fake.retry = null; fake.onRead = null;
  fake.data.set(taskPath, { projectId: 'p', isArchived: false, dueDate: '2026-10-10' });
  fake.data.set(listPath, { taskId: 'task', title: '準備', order: 7, items: structuredClone(items) });
  fake.runTransaction.mockImplementation(async (_db, callback) => {
    while (true) {
      const writes: typeof fake.writes = [];
      const result = await callback({
        get: async (path: string) => {
          if (writes.length) throw new Error('read-after-write');
          fake.reads.push(path); fake.onRead?.(path);
          const data = structuredClone(fake.data.get(path));
          return { exists: () => data !== undefined, data: () => data };
        },
        update: (path: string, data: Record<string, unknown>) => writes.push({ path, data }),
      });
      if (fake.retry) { const retry = fake.retry; fake.retry = null; retry(); continue; }
      if (fake.failure) throw new Error(fake.failure);
      for (const write of writes) fake.data.set(write.path, { ...fake.data.get(write.path), ...write.data });
      fake.writes.push(...writes);
      return result;
    }
  });
});

describe('checklist item transaction', () => {
  it('renames against the latest retry snapshot while preserving unrelated changes', async () => {
    const latest = [{ ...items[0], isChecked: true, order: 45, dueDate: '2026-09-29' }, { ...items[1], text: '別の項目の修正' }];
    fake.retry = () => fake.data.set(listPath, { ...fake.data.get(listPath), items: latest });
    const action = { kind: 'text', itemId: 'a', text: '梱包箱', expectedText: '箱' } as const;
    const saved = await mutateChecklistItem('p', 'task', 'list', action);
    expect(saved).toEqual([{ ...latest[0], text: '梱包箱' }, latest[1]]);
    expect(fake.writes).toHaveLength(1);
    await mutateChecklistItem('p', 'task', 'list', action);
    expect(fake.writes).toHaveLength(1);
  });

  it('rejects a concurrent rename without overwriting it', async () => {
    const latest = [{ ...items[0], text: '同僚の修正' }, items[1]];
    fake.retry = () => fake.data.set(listPath, { ...fake.data.get(listPath), items: latest });
    await expect(mutateChecklistItem('p', 'task', 'list', { kind: 'text', itemId: 'a', text: '梱包箱', expectedText: '箱' })).rejects.toThrow('項目名が変更されています');
    expect(fake.writes).toEqual([]);
    expect(fake.data.get(listPath)?.items).toEqual(latest);
  });
  it('reads the latest parent/list, writes only items, and retains concurrent sibling changes and metadata', async () => {
    const latest = [{ ...items[0], text: '最新の箱', isChecked: true, order: 12, owner: 'Nao' }, items[1], { id: 'new', text: '他の人が追加', isChecked: false, order: 30, dueDate: '2026-09-20' }];
    fake.data.set(listPath, { ...fake.data.get(listPath), items: latest });
    const saved = await mutateChecklistItem('p', 'task', 'list', dateAction);
    expect(fake.reads).toEqual([taskPath, listPath]);
    expect(fake.writes).toEqual([{ path: listPath, data: { items: saved } }]);
    expect(saved).toEqual([{ ...latest[0], dueDate: '2026-10-01' }, ...latest.slice(1)]);
    expect(fake.data.get(listPath)).toMatchObject({ taskId: 'task', title: '準備', order: 7 });
    expect(fake.data.get(taskPath)?.dueDate).toBe('2026-10-10');
    expect(saved[1]).not.toHaveProperty('dueDate');
  });
  it.each<ChecklistItemMutation>([
    dateAction,
    { kind: 'add', item: { id: 'added', text: '追加する項目' } },
    { kind: 'toggle', itemId: 'a', isChecked: true },
    { kind: 'remove', itemId: 'a' },
  ])('reapplies intent %j to the latest transaction retry snapshot', async action => {
    const latest = [{ ...items[0], text: '別の人が更新', isChecked: true, dueDate: '2026-09-29', order: 45 }, { ...items[1], dueDate: '2026-09-28' }, { id: 'concurrent', text: '並行追加', isChecked: true, order: 90 }];
    fake.retry = () => fake.data.set(listPath, { ...fake.data.get(listPath), items: latest });
    const saved = await mutateChecklistItem('p', 'task', 'list', action);
    expect(fake.reads).toEqual([taskPath, listPath, taskPath, listPath]);
    expect(saved.find(item => item.id === 'b')).toEqual(latest[1]);
    expect(saved.find(item => item.id === 'concurrent')).toEqual(latest[2]);
    if (action.kind === 'add') expect(saved.at(-1)).toEqual({ ...action.item, isChecked: false, order: 91 });
    if (action.kind === 'dueDate') expect(saved[0]).toEqual({ ...latest[0], dueDate: '2026-10-01' });
    if (action.kind === 'remove') expect(saved.some(item => item.id === 'a')).toBe(false);
    if (action.kind === 'toggle') {
      expect(saved[0]).toEqual(latest[0]);
      expect(fake.writes).toEqual([]);
    }
  });
  it('captures an addition before awaiting and treats an already committed identical addition as a no-op', async () => {
    const action: ChecklistItemMutation = { kind: 'add', item: { id: 'added', text: '元の追加' } };
    fake.onRead = () => { action.item.text = '呼び出し後の変更'; };
    await mutateChecklistItem('p', 'task', 'list', action);
    const added = (fake.data.get(listPath)!.items as ChecklistItem[]).find(item => item.id === 'added');
    expect(added?.text).toBe('元の追加');
    fake.onRead = null;
    added!.isChecked = true; added!.dueDate = '2026-09-30';
    const saved = await mutateChecklistItem('p', 'task', 'list', { kind: 'add', item: { id: 'added', text: '元の追加' } });
    expect(fake.writes).toHaveLength(1);
    expect(saved.at(-1)).toMatchObject({ isChecked: true, dueDate: '2026-09-30' });
    await expect(mutateChecklistItem('p', 'task', 'list', action)).rejects.toThrow('変更されています');
    expect(fake.writes).toHaveLength(1);
  });
  it('skips equivalent dates, clears a saved date to null, and preserves legacy absent dates', async () => {
    await mutateChecklistItem('p', 'task', 'list', { kind: 'dueDate', itemId: 'a', dueDate: '2026-09-15' });
    await mutateChecklistItem('p', 'task', 'list', { kind: 'dueDate', itemId: 'b', dueDate: null });
    expect(fake.writes).toEqual([]);
    await mutateChecklistItem('p', 'task', 'list', { kind: 'dueDate', itemId: 'a', dueDate: null });
    const saved = await mutateChecklistItem('p', 'task', 'list', { kind: 'dueDate', itemId: 'a', dueDate: null });
    expect(fake.writes).toHaveLength(1);
    expect(saved[0].dueDate).toBeNull();
    expect(saved[1]).not.toHaveProperty('dueDate');
  });
  it.each(['task-missing', 'list-missing', 'archived', 'wrong-task', 'wrong-project', 'items-missing', 'duplicate-items', 'item-deleted'])('rejects stale or invalid persisted state without writing: %s', scenario => {
    if (scenario === 'task-missing') fake.data.delete(taskPath);
    if (scenario === 'list-missing') fake.data.delete(listPath);
    if (scenario === 'archived') fake.data.get(taskPath)!.isArchived = true;
    if (scenario === 'wrong-task') fake.data.get(listPath)!.taskId = 'other';
    if (scenario === 'wrong-project') fake.data.get(taskPath)!.projectId = 'other';
    if (scenario === 'items-missing') delete fake.data.get(listPath)!.items;
    if (scenario === 'duplicate-items') fake.data.get(listPath)!.items = [items[0], items[0]];
    if (scenario === 'item-deleted') fake.data.get(listPath)!.items = [items[1]];
    return expect(mutateChecklistItem('p', 'task', 'list', dateAction)).rejects.toThrow().then(() => expect(fake.writes).toEqual([]));
  });
  it('accepts legacy missing embedded scope fields but rejects invalid scope and date before accessing Firebase', async () => {
    delete fake.data.get(taskPath)!.projectId; delete fake.data.get(listPath)!.taskId;
    await mutateChecklistItem('p', 'task', 'list', dateAction);
    fake.runTransaction.mockClear(); fake.doc.mockClear();
    await expect(mutateChecklistItem('p/other', 'task', 'list', dateAction)).rejects.toThrow('指定');
    await expect(mutateChecklistItem('p', '..', 'list', dateAction)).rejects.toThrow('指定');
    await expect(mutateChecklistItem('p', 'task', '\n', dateAction)).rejects.toThrow('指定');
    await expect(mutateChecklistItem('p', 'task', 'list', { ...dateAction, dueDate: '2026-02-29' })).rejects.toThrow('期限');
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(fake.doc).not.toHaveBeenCalled();
  });
  it.each(['', 'another-user'])('rejects auth changes after a read, including a no-op date (%s)', async uid => {
    fake.onRead = () => { fake.uid = uid; };
    await expect(mutateChecklistItem('p', 'task', 'list', { ...dateAction, dueDate: '2026-09-15' })).rejects.toThrow('ログイン状態');
    expect(fake.writes).toEqual([]);
  });
  it('rejects unauthenticated calls and an auth change before a transaction retry', async () => {
    fake.uid = '';
    await expect(mutateChecklistItem('p', 'task', 'list', dateAction)).rejects.toThrow('ログイン');
    expect(fake.runTransaction).not.toHaveBeenCalled();
    fake.uid = 'u'; fake.retry = () => { fake.uid = 'other'; };
    await expect(mutateChecklistItem('p', 'task', 'list', dateAction)).rejects.toThrow('ログイン状態');
    expect(fake.writes).toEqual([]);
  });
  it.each(['offline', 'permission-denied'])('propagates transaction failure without a partial update: %s', async failure => {
    fake.failure = failure;
    await expect(mutateChecklistItem('p', 'task', 'list', dateAction)).rejects.toThrow(failure);
    expect(fake.writes).toEqual([]);
    expect(fake.data.get(listPath)!.items).toEqual(items);
  });
});


it('atomically saves a strict item deadline and subscription hint without changing the parent deadline', async () => {
  const saved = await mutateChecklistItem('p', 'task', 'list', { kind: 'deadline', itemId: 'a', dueDate: '2026-09-24', dueTime: '08:00', deadlinePolicy: 'strict' });
  expect(saved[0]).toMatchObject({ dueDate: '2026-09-24', dueTime: '08:00', deadlinePolicy: 'strict' });
  expect(fake.writes).toContainEqual({ path: taskPath, data: { hasChecklistDeadlines: true } });
  expect(fake.data.get(taskPath)?.dueDate).toBe('2026-10-10');
  expect(saved[1]).toEqual(items[1]);
});

it('does not publish a subscription hint when saving the checklist fails', async () => {
  fake.failure = 'permission-denied';
  await expect(mutateChecklistItem('p', 'task', 'list', { kind: 'deadline', itemId: 'a', dueDate: '2026-09-24', dueTime: '08:00', deadlinePolicy: 'strict' })).rejects.toThrow('permission-denied');
  expect(fake.writes).toEqual([]);
  expect(fake.data.get(taskPath)).not.toHaveProperty('hasChecklistDeadlines');
  expect(fake.data.get(listPath)?.items).toEqual(items);
});

it.each(['24:00', '08:60', '', '8:00'])('rejects invalid strict times before accessing Firebase: %s', async dueTime => {
  await expect(mutateChecklistItem('p', 'task', 'list', { kind: 'deadline', itemId: 'a', dueDate: '2026-09-24', dueTime, deadlinePolicy: 'strict' })).rejects.toThrow('時刻');
  expect(fake.runTransaction).not.toHaveBeenCalled();
});
