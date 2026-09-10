import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_COUNTDOWN_KEY, useLocalCountdown } from './useLocalCountdown';
import type { DashboardTask } from '@/lib/dashboard/brief';

const task = { id: 't', projectId: 'p', projectName: '展示会', title: '出展準備', dueDate: new Date('2026-09-23T00:00:00+09:00'), isCompleted: false, isAbandoned: false, isArchived: false } as DashboardTask;
const target = { projectId: 'p', taskId: 't' };
describe('local test countdown', () => {
  beforeEach(() => { localStorage.removeItem(LOCAL_COUNTDOWN_KEY); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('saves only target IDs in browser storage, restores on reload, and clears', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result, unmount } = renderHook(() => useLocalCountdown([task], false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.save({ target, revision: 0 }); });
    expect(JSON.parse(localStorage.getItem(LOCAL_COUNTDOWN_KEY)!)).toEqual({ target, revision: 1 });
    expect(result.current.data?.task?.title).toBe('出展準備');
    unmount();
    const restored = renderHook(() => useLocalCountdown([task], false));
    await waitFor(() => expect(restored.result.current.data?.target).toEqual(target));
    await act(async () => { await restored.result.current.save({ target: null, revision: 1 }); });
    expect(restored.result.current.data?.status).toBe('unset');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('uses current readable task data and hides inaccessible or archived tasks', async () => {
    localStorage.setItem(LOCAL_COUNTDOWN_KEY, JSON.stringify({ target, revision: 1 }));
    const { result, rerender } = renderHook(({ tasks }) => useLocalCountdown(tasks, false), { initialProps: { tasks: [task] } });
    await waitFor(() => expect(result.current.data?.task?.title).toBe('出展準備'));
    rerender({ tasks: [{ ...task, title: '新しい名前', dueDate: new Date('2026-09-24T00:00:00+09:00'), isCompleted: true }] });
    expect(result.current.data?.task).toMatchObject({ title: '新しい名前', dueDate: '2026-09-23T15:00:00.000Z', isCompleted: true });
    rerender({ tasks: [] });
    expect(result.current.data?.task).toBeNull();
    expect(result.current.data?.status).toBe('unavailable');
    rerender({ tasks: [{ ...task, isArchived: true }] });
    expect(result.current.data?.task).toBeNull();
  });
  it('observes other tabs and prevents stale settings from overwriting them', async () => {
    const { result } = renderHook(() => useLocalCountdown([task], false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      localStorage.setItem(LOCAL_COUNTDOWN_KEY, JSON.stringify({ target, revision: 2 }));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_COUNTDOWN_KEY }));
    });
    expect(result.current.data?.revision).toBe(2);
    await act(async () => { await expect(result.current.save({ target: null, revision: 0 })).rejects.toThrow('別のタブ'); });
    expect(result.current.data?.target).toEqual(target);
  });
  it('does not pretend to save when storage is blocked', async () => {
    const { result } = renderHook(() => useLocalCountdown([task], false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await act(async () => { await expect(result.current.save({ target, revision: 0 })).rejects.toThrow('保存できません'); });
    expect(result.current.data?.status).toBe('unset');
  });
  it('rejects completed or undated selections without storage writes', async () => {
    const { result } = renderHook(() => useLocalCountdown([{ ...task, isCompleted: true }], false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await expect(result.current.save({ target, revision: 0 })).rejects.toThrow('未完了タスク'); });
    expect(localStorage.getItem(LOCAL_COUNTDOWN_KEY)).toBeNull();
  });
});
