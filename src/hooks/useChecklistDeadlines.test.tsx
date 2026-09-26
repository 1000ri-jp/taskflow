import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useChecklistDeadlines } from './useChecklistDeadlines';
import { viewTask } from '@/test/taskViewFixtures';
import type { Checklist } from '@/types';
const fake = vi.hoisted(() => ({ listeners: [] as { read: (lists: Checklist[]) => void; fail: () => void; stop: ReturnType<typeof vi.fn> }[] }));
vi.mock('@/lib/firebase/firestore', () => ({ subscribeToTaskChecklists: (_p: string, _t: string, read: (lists: Checklist[]) => void, fail: () => void) => {
  const stop = vi.fn(); fake.listeners.push({ read, fail, stop }); return stop;
} }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const task = { ...viewTask({ id: 'payment', assigneeIds: ['me'], hasChecklistDeadlines: true }), projectName: '事務' };
const list: Checklist = { id: 'list', taskId: 'payment', title: '支払', order: 0, createdAt: new Date(), items: [{ id: 'item', text: '銀行への振込', order: 0, isChecked: false, dueDate: '2026-09-24', dueTime: '08:00', deadlinePolicy: 'strict' }] };
beforeEach(() => { fake.listeners = []; });
it('reads live checklist work, preserves a completed parent, and removes checked or deleted items', () => {
  const { result } = renderHook(() => useChecklistDeadlines([{ ...task, isCompleted: true }], 'me'));
  expect(result.current.loading).toBe(true);
  act(() => fake.listeners[0].read([list]));
  expect(result.current.items[0]).toMatchObject({ at: '2026-09-24T08:00:00+09:00', item: { text: '銀行への振込' } });
  act(() => fake.listeners[0].read([{ ...list, items: [{ ...list.items[0], text: '変更済み', isChecked: true }] }]));
  expect(result.current.items).toEqual([]);
  act(() => fake.listeners[0].read([]));
  expect(result.current).toMatchObject({ items: [], error: false, loading: false });
});
it('isolates accounts and assignee filters, ignores late callbacks, and reports failed reads', () => {
  const view = renderHook(({ user, tasks }) => useChecklistDeadlines(tasks, user), { initialProps: { user: 'me', tasks: [task] } });
  act(() => fake.listeners[0].read([list]));
  const old = fake.listeners[0];
  view.rerender({ user: 'other', tasks: [task] });
  expect(old.stop).toHaveBeenCalledOnce();
  act(() => old.read([list]));
  expect(view.result.current.items).toEqual([]);
  view.rerender({ user: 'me', tasks: [task] });
  act(() => fake.listeners[1].fail());
  expect(view.result.current).toMatchObject({ error: true, items: [], loading: false });
  act(() => fake.listeners[1].read([list]));
  expect(view.result.current.error).toBe(false);
  view.rerender({ user: 'me', tasks: [{ ...task, isArchived: true }] });
  expect(view.result.current.items).toEqual([]);
});
it('does not subscribe to ordinary tasks or other assignees and permits explicit all-member scope', () => {
  const view = renderHook(({ all }) => useChecklistDeadlines([{ ...task, assigneeIds: ['other'] }, { ...task, id: 'ordinary', hasChecklistDeadlines: false }], 'me', all ? 'all' : 'mine'), { initialProps: { all: false } });
  expect(fake.listeners).toHaveLength(0);
  view.rerender({ all: true });
  expect(fake.listeners).toHaveLength(1);
});
