import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardComments } from './useDashboardComments';
import { loadDashboardComments } from '@/lib/dashboard/comments';
import type { DashboardTask } from '@/lib/dashboard/brief';

const auth = vi.hoisted(() => ({ firebaseUser: { uid: 'user-a' } as { uid: string } | null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth) }));
vi.mock('@/lib/dashboard/comments', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/dashboard/comments')>(), loadDashboardComments: vi.fn() }));
const task = { id: 'task', projectId: 'p1', listId: 'l1', title: 'タスク', projectName: 'プロジェクト', isArchived: false } as DashboardTask;
const data: Awaited<ReturnType<typeof loadDashboardComments>> = {
  items: [{
    key: 'comment',
    taskId: 'task',
    projectId: 'p1',
    comment: {
      id: 'comment',
      taskId: 'task',
      content: '確認コメント',
      authorId: 'user-a',
      mentions: [],
      createdAt: new Date(2026, 8, 3),
      updatedAt: new Date(2026, 8, 3),
    },
    authorName: '投稿者',
    listName: '列',
  }],
  failedTasks: 0,
  errorCodes: [],
  metadataIncomplete: false,
};
describe('useDashboardComments', () => {
  beforeEach(() => { vi.resetAllMocks(); auth.firebaseUser = { uid: 'user-a' }; vi.mocked(loadDashboardComments).mockResolvedValue(data); });
  afterEach(cleanup);
  it('waits for tasks and skips disabled channels and signed-out sessions', async () => {
    const { rerender, result } = renderHook(({ loading, enabled }) => useDashboardComments([task], loading, null, enabled), { initialProps: { loading: true, enabled: true } });
    expect(loadDashboardComments).not.toHaveBeenCalled();
    rerender({ loading: false, enabled: false });
    expect(loadDashboardComments).not.toHaveBeenCalled();
    auth.firebaseUser = null;
    rerender({ loading: false, enabled: true });
    expect(loadDashboardComments).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
  it('loads once for stable IDs, supports refresh, and reflects current titles', async () => {
    const { result, rerender } = renderHook(({ tasks }) => useDashboardComments(tasks, false, null, true), { initialProps: { tasks: [task] } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ tasks: [{ ...task, title: '変更後', projectName: '新しい名前' }] });
    expect(loadDashboardComments).toHaveBeenCalledTimes(1);
    expect(result.current.items[0].task.title).toBe('変更後');
    act(() => result.current.refresh());
    await waitFor(() => expect(loadDashboardComments).toHaveBeenCalledTimes(2));
  });
  it('hides removed tasks and old account data immediately, cancelling late responses', async () => {
    const { result, rerender } = renderHook(({ tasks }) => useDashboardComments(tasks, false, null, true), { initialProps: { tasks: [task] } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const oldCancelled = vi.mocked(loadDashboardComments).mock.calls[0][1]!;
    auth.firebaseUser = null;
    rerender({ tasks: [task] });
    expect(result.current.items).toEqual([]);
    expect(oldCancelled()).toBe(true);
    auth.firebaseUser = { uid: 'user-b' };
    vi.mocked(loadDashboardComments).mockReturnValue(new Promise(() => {}));
    rerender({ tasks: [] });
    expect(result.current.items).toEqual([]);
  });
  it('excludes archived tasks and reports task-source failures', async () => {
    const { result } = renderHook(() => useDashboardComments([task, { ...task, id: 'archived', isArchived: true }], false, new Error('denied'), true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(loadDashboardComments).toHaveBeenCalledWith([{ id: 'task', projectId: 'p1', listId: 'l1' }], expect.any(Function));
    expect(result.current.hasError).toBe(true);
  });
});
