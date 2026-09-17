import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { subscribeToArchivedTasks } from '@/lib/firebase/firestore';
import { useArchivedTasks } from './useArchivedTasks';
import type { Task } from '@/types';

vi.mock('@/lib/firebase/firestore', () => ({ subscribeToArchivedTasks: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const subscriptions: { id: string; next: (tasks: Task[]) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  subscriptions.length = 0;
  vi.mocked(subscribeToArchivedTasks).mockImplementation((id, next, error) => {
    const stop = vi.fn(); subscriptions.push({ id, next, error: error!, stop }); return stop;
  });
});
it('distinguishes loading, failure and empty; retries and ignores the old subscription', async () => {
  const { result, unmount } = renderHook(() => useArchivedTasks('p'));
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(subscriptions).toHaveLength(1));
  act(() => subscriptions[0].error(new Error('offline')));
  expect(result.current.error?.message).toBe('offline');
  expect(result.current.isLoading).toBe(false);
  act(() => result.current.retry());
  await waitFor(() => expect(subscriptions).toHaveLength(2));
  expect(subscriptions[0].stop).toHaveBeenCalledOnce();
  expect(result.current.isLoading).toBe(true);
  act(() => subscriptions[0].next([{ id: 'late' } as Task]));
  expect(result.current.tasks).toEqual([]);
  act(() => subscriptions[1].next([]));
  expect(result.current.error).toBeNull(); expect(result.current.isLoading).toBe(false);
  unmount(); expect(subscriptions[1].stop).toHaveBeenCalledOnce();
});
it('does not carry archive rows or delayed errors into a different project', async () => {
  const { result, rerender } = renderHook(({ id }) => useArchivedTasks(id), { initialProps: { id: 'p' } });
  await waitFor(() => expect(subscriptions).toHaveLength(1));
  act(() => subscriptions[0].next([{ id: 'old' } as Task]));
  rerender({ id: 'q' });
  expect(result.current.tasks).toEqual([]);
  await waitFor(() => expect(subscriptions).toHaveLength(2));
  act(() => subscriptions[0].error(new Error('late')));
  expect(result.current.error).toBeNull();
  act(() => subscriptions[1].next([{ id: 'new' } as Task]));
  expect(result.current.tasks.map(t => t.id)).toEqual(['new']);
});
