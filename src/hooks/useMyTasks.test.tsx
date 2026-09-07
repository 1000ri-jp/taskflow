import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMyTasks } from './useMyTasks';
import { subscribeToProjectTasks } from '@/lib/firebase/firestore';
import type { Task } from '@/types';

const state = vi.hoisted(() => ({ user: { id: 'user' } as { id: string } | null, projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], isLoading: false, error: null as Error | null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => state }));
vi.mock('./useProjects', () => ({ useProjects: () => state }));
vi.mock('@/lib/firebase/firestore', () => ({ subscribeToProjectTasks: vi.fn() }));
const task = { id: 'task', projectId: 'stale-project-id', assigneeIds: ['user'], isCompleted: false, dueDate: null } as Task;
describe('useMyTasks read-only source', () => {
  beforeEach(() => { vi.resetAllMocks(); state.user = { id: 'user' }; state.projects = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]; state.isLoading = false; state.error = null; vi.mocked(subscribeToProjectTasks).mockReturnValue(vi.fn()); });
  afterEach(cleanup);
  it.each(['reviewer-a', 'reviewer-b'])('shows a shared child to %s without requiring them to own the parent', (userId) => {
    state.user = { id: userId };
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    const parent = { ...task, id: 'parent', title: '梱包', assigneeIds: ['sender'] };
    const child = { ...task, id: 'child', title: '強度を確認', parentTaskId: 'parent', taskKind: 'review_request' as const, sourceCommentId:'comment', assigneeIds:['reviewer-a','reviewer-b'] };
    act(() => { a[1]([parent,child]); b[1]([]); });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({id:'child',parentTitle:'梱包',projectId:'a',assigneeIds:['reviewer-a','reviewer-b']});
    act(() => a[1]([parent,{...child,isCompleted:true}]));
    expect(result.current.tasks).toHaveLength(0);
    act(() => a[1]([parent,{...child,isArchived:true}]));
    expect(result.current.tasks).toHaveLength(0);
  });
  it('waits for each project once and uses the subscribed collection as project identity', () => {
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { a[1]([task]); a[1]([task]); });
    expect(result.current.isLoading).toBe(true);
    act(() => b[1]([]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.allProjectTasks[0]).toMatchObject({ projectId: 'a', projectName: 'A' });
  });
  it('surfaces subscription errors and does not claim loading forever', () => {
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { a[1]([task]); b[2]!(new Error('permission denied')); });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('permission denied');
    expect(result.current.tasks).toHaveLength(1);
  });
  it('drops inaccessible scopes and ignores responses after unsubscription', () => {
    const { result, rerender } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { a[1]([task]); b[1]([]); });
    state.projects = [{ id: 'b', name: 'B' }];
    rerender();
    expect(result.current.allProjectTasks).toEqual([]);
    act(() => a[1]([task]));
    expect(result.current.allProjectTasks).toEqual([]);
    state.user = null;
    rerender();
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
