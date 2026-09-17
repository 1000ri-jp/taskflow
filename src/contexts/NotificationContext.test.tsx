import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotifications, useTaskCommentUnread } from './NotificationContext';
import {
  createNotification,
  deleteNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToUserNotifications,
} from '@/lib/firebase/firestore';
import type { Notification } from '@/types';
import { organizationMockKey, readOrganizationMock } from '@/lib/task/organizationMock';

const auth = vi.hoisted(() => ({
  user: { id: 'user-a', displayName: 'A' } as { id: string; displayName: string } | null,
  mock: false,
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => auth.mock }));
vi.mock('@/lib/firebase/firestore', () => ({
  subscribeToUserNotifications: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  deleteNotification: vi.fn(),
  createNotification: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

const notification = { id: 'notice-a', userId: 'user-a', isRead: false } as Notification;

describe('NotificationProvider subscription state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, 'locks', { configurable:true, value:{request:async(_name:string,fn:()=>unknown)=>fn()} });
    localStorage.removeItem(organizationMockKey('secretary-demo'));
    auth.user = { id: 'user-a', displayName: 'A' };
    auth.mock = false;
    vi.mocked(subscribeToUserNotifications).mockReturnValue(vi.fn());
  });

  it('shares unread comment state across cards and follows reads, errors, and account changes', () => {
    const { result, rerender } = renderHook(() => [useTaskCommentUnread('p', 't'), useTaskCommentUnread('q', 't')], { wrapper });
    const [, success, failure] = vi.mocked(subscribeToUserNotifications).mock.calls[0];
    const comment: Notification = { ...notification, projectId: 'p', taskId: 't', type: 'comment_added', data: {} };
    expect(result.current[0]).toMatchObject({ hasUnread: false, isLoading: true });
    act(() => success([comment]));
    expect(result.current.map(value => value.hasUnread)).toEqual([true, false]);
    expect(subscribeToUserNotifications).toHaveBeenCalledOnce();
    act(() => success([{ ...comment, isRead: true }]));
    expect(result.current[0].hasUnread).toBe(false);
    act(() => success([{ ...comment, userId: 'other-user' }]));
    expect(result.current[0].hasUnread).toBe(false);
    act(() => failure!(new Error('offline')));
    expect(result.current[0].error?.message).toBe('offline');
    act(() => success([comment]));
    auth.user = { id: 'user-b', displayName: 'B' };
    rerender();
    expect(result.current[0]).toMatchObject({ hasUnread: false, isLoading: true });
  });

  it('shares one subscription and distinguishes loading, empty success, and errors', () => {
    const { result, rerender } = renderHook(() => [useNotifications(), useNotifications()], { wrapper });
    const [, success, failure] = vi.mocked(subscribeToUserNotifications).mock.calls[0];
    expect(result.current[0]).toMatchObject({ notifications: [], unreadCount: 0, isLoading: true, error: null });
    expect(subscribeToUserNotifications).toHaveBeenCalledTimes(1);

    act(() => success([]));
    expect(result.current[0]).toMatchObject({ notifications: [], isLoading: false, error: null });
    act(() => success([notification]));
    expect(result.current[0].unreadCount).toBe(1);
    const error = new Error('permission denied');
    act(() => failure!(error));
    expect(result.current[0]).toMatchObject({ notifications: [], unreadCount: 0, isLoading: false, error });
    expect(result.current[1].error).toBe(error);
    act(() => success([{ ...notification, isRead: true }]));
    expect(result.current[0]).toMatchObject({ unreadCount: 0, isLoading: false, error: null });

    auth.user = { id: 'user-a', displayName: 'A renamed' };
    rerender();
    expect(subscribeToUserNotifications).toHaveBeenCalledTimes(1);
  });

  it('hides the old scope on the first new-user render and ignores late callbacks', () => {
    const seen: Array<{ userId: string | null; ids: string[]; isLoading: boolean; error: Error | null }> = [];
    const { result, rerender } = renderHook(() => {
      const current = useNotifications();
      seen.push({ userId: auth.user?.id ?? null, ids: current.notifications.map(item => item.id), isLoading: current.isLoading, error: current.error });
      return current;
    }, { wrapper });
    const [, successA, failureA] = vi.mocked(subscribeToUserNotifications).mock.calls[0];
    const stopA = vi.mocked(subscribeToUserNotifications).mock.results[0].value;
    act(() => successA([notification]));

    auth.user = { id: 'user-b', displayName: 'B' };
    rerender();
    expect(stopA).toHaveBeenCalledOnce();
    expect(seen.find(item => item.userId === 'user-b')).toEqual({ userId: 'user-b', ids: [], isLoading: true, error: null });
    act(() => { successA([notification]); failureA!(new Error('old error')); });
    expect(result.current).toMatchObject({ notifications: [], isLoading: true, error: null });

    const [, successB, failureB] = vi.mocked(subscribeToUserNotifications).mock.calls[1];
    act(() => successB([{ ...notification, id: 'notice-b', userId: 'user-b' }]));
    expect(result.current.notifications[0].id).toBe('notice-b');
    act(() => { successA([notification]); failureA!(new Error('old error')); });
    expect(result.current.notifications[0].id).toBe('notice-b');
    expect(result.current.error).toBeNull();

    auth.user = null;
    rerender();
    expect(result.current).toMatchObject({ notifications: [], unreadCount: 0, isLoading: false, error: null });
    act(() => { successB([notification]); failureB!(new Error('old error')); });
    expect(result.current).toMatchObject({ notifications: [], isLoading: false, error: null });

    auth.user = { id: 'user-a', displayName: 'A' };
    rerender();
    expect(result.current).toMatchObject({ notifications: [], isLoading: true, error: null });
    act(() => successA([notification]));
    expect(result.current.notifications).toEqual([]);
  });

  it('does not revive a previous snapshot when switching back before a new snapshot arrives', () => {
    const { result, rerender } = renderHook(useNotifications, { wrapper });
    const [, successA] = vi.mocked(subscribeToUserNotifications).mock.calls[0];
    act(() => successA([notification]));
    auth.user = { id: 'user-b', displayName: 'B' };
    rerender();
    auth.user = { id: 'user-a', displayName: 'A' };
    rerender();
    expect(result.current).toMatchObject({ notifications: [], isLoading: true, error: null });
    act(() => successA([notification]));
    expect(result.current.notifications).toEqual([]);
  });

  it('clears an old error when the user changes and handles synchronous setup failure', async () => {
    const error = new Error('initialization failed');
    vi.mocked(subscribeToUserNotifications).mockImplementationOnce(() => { throw error; });
    const { result, rerender } = renderHook(useNotifications, { wrapper });
    await act(async () => {});
    expect(result.current).toMatchObject({ notifications: [], isLoading: false, error });
    auth.user = { id: 'user-b', displayName: 'B' };
    rerender();
    expect(result.current).toMatchObject({ notifications: [], isLoading: true, error: null });
    act(() => vi.mocked(subscribeToUserNotifications).mock.calls[1][1]([]));
    expect(result.current).toMatchObject({ notifications: [], isLoading: false, error: null });
  });

  it('ignores a queued initialization error after its scope is removed', async () => {
    vi.mocked(subscribeToUserNotifications).mockImplementationOnce(() => { throw new Error('old setup failure'); });
    const { result, rerender, unmount } = renderHook(useNotifications, { wrapper });
    auth.user = { id: 'user-b', displayName: 'B' };
    rerender();
    const [, success] = vi.mocked(subscribeToUserNotifications).mock.calls[1];
    act(() => success([]));
    await act(async () => {});
    expect(result.current).toMatchObject({ notifications: [], isLoading: false, error: null });
    const stop = vi.mocked(subscribeToUserNotifications).mock.results[1].value;
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps mock reads and all context operations away from Firestore', async () => {
    auth.mock = true;
    const { result } = renderHook(useNotifications, { wrapper });
    expect(result.current).toMatchObject({ notifications: [], unreadCount: 0, isLoading: false, error: null });
    await result.current.markAsRead('notification');
    await result.current.markAllAsRead();
    await result.current.remove('notification');
    await result.current.sendBellNotification('project', 'Project', 'task', 'Task', 'message', ['recipient']);
    expect(subscribeToUserNotifications).not.toHaveBeenCalled();
    expect(markNotificationAsRead).not.toHaveBeenCalled();
    expect(markAllNotificationsAsRead).not.toHaveBeenCalled();
    expect(deleteNotification).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('shows saved mock product reminders and follows completion without reading or writing Firestore', async () => {
    auth.mock = true;
    const work = readOrganizationMock(); const now = new Date().toISOString();
    work.data.memberIds.push('user-a');
    const parent = work.data.tasks['purchase-parent']; parent.dueDate = new Date(now);
    parent.completionPolicy = { kind: 'all_required_children', condition: '全員が購入した', grantedBy: 'user-a', grantedAt: now, required: [{ taskId: 'purchase-peer', assigneeId: 'demo-colleague' }] };
    work.automationStates = { 'user-a': { uid: 'user-a', revision: 1, automationEnabled: true, grants: [], reminders: [{ projectId: 'secretary-demo', taskId: 'purchase-parent', dueDate: now, snoozedUntil: null, notifiedSignature: 'pending', sequence: 0 }] } };
    const key = organizationMockKey('secretary-demo'); const saved = JSON.stringify(work); localStorage.setItem(key, saved);
    const { result } = renderHook(useNotifications, { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    expect(result.current.notifications[0]).toMatchObject({ type: 'due_reminder', data: { automation: true }, userId: 'user-a' });
    expect(localStorage.getItem(key)).toBe(saved); expect(subscribeToUserNotifications).not.toHaveBeenCalled(); expect(createNotification).not.toHaveBeenCalled();
    parent.isCompleted = true;
    act(() => { localStorage.setItem(key, JSON.stringify(work)); window.dispatchEvent(new Event('taskflow-work-updated')); });
    expect(result.current.notifications).toEqual([]);
  });

  it('resets an existing subscription when entering mock mode', () => {
    const { result, rerender } = renderHook(useNotifications, { wrapper });
    const [, success, failure] = vi.mocked(subscribeToUserNotifications).mock.calls[0];
    act(() => success([notification]));
    auth.mock = true;
    rerender();
    act(() => { success([notification]); failure!(new Error('late error')); });
    expect(result.current).toMatchObject({ notifications: [], isLoading: false, error: null });
    expect(subscribeToUserNotifications).toHaveBeenCalledOnce();
  });

  it('preserves notification actions for a real authenticated user', async () => {
    const { result } = renderHook(useNotifications, { wrapper });
    await result.current.markAsRead('notification');
    await result.current.markAllAsRead();
    await result.current.remove('notification');
    await result.current.sendBellNotification('project', 'Project', 'task', 'Task', 'message', ['recipient', 'user-a', 'recipient']);
    expect(markNotificationAsRead).toHaveBeenCalledExactlyOnceWith('notification');
    expect(markAllNotificationsAsRead).toHaveBeenCalledExactlyOnceWith('user-a');
    expect(deleteNotification).toHaveBeenCalledExactlyOnceWith('notification');
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createNotification).mock.calls.map(([data]) => data.userId)).toEqual(['recipient', 'user-a']);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_bell', message: 'message', senderId: 'user-a', isRead: false }));
  });
});
