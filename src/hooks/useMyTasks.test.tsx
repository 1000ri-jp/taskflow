import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMyTasks } from './useMyTasks';
import { subscribeToProjectLists, subscribeToProjectTasks } from '@/lib/firebase/firestore';
import { viewList } from '@/test/taskViewFixtures';
import type { Task } from '@/types';

const state = vi.hoisted(() => ({ user: { id: 'user' } as { id: string } | null, projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], isLoading: false, error: null as Error | null, mock: false }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => state }));
vi.mock('./useProjects', () => ({ useProjects: () => state }));
vi.mock('@/lib/firebase/firestore', () => ({ subscribeToProjectTasks: vi.fn(), subscribeToProjectLists: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => state.mock }));
const task = { id: 'task', projectId: 'stale-project-id', listId: 'one', assigneeIds: ['user'], isCompleted: false, dueDate: null } as Task;
describe('useMyTasks read-only source', () => {
  beforeEach(() => { vi.resetAllMocks(); state.mock = false; state.user = { id: 'user' }; state.projects = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]; state.isLoading = false; state.error = null; vi.mocked(subscribeToProjectTasks).mockReturnValue(vi.fn()); vi.mocked(subscribeToProjectLists).mockImplementation(() => vi.fn()); });
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
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'ready' });
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'loading' });
    act(() => b[1]([]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'ready' });
    expect(result.current.allProjectTasks[0]).toMatchObject({ projectId: 'a', projectName: 'A' });
  });
  it('surfaces subscription errors and does not claim loading forever', () => {
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { a[1]([task]); b[2]!(new Error('permission denied')); });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('permission denied');
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'ready' });
    expect(result.current.projectTaskStatus.get('b')).toMatchObject({ status: 'error' });
    act(() => b[1]([]));
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'ready' });
    expect(result.current.error).toBeNull();
  });
  it('drops inaccessible scopes and ignores responses after unsubscription', () => {
    const { result, rerender } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { a[1]([task]); b[1]([]); });
    state.projects = [{ id: 'b', name: 'B' }];
    rerender();
    expect(result.current.allProjectTasks).toEqual([]);
    expect(result.current.projectTaskStatus.has('a')).toBe(false);
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'loading' });
    act(() => a[1]([task]));
    expect(result.current.allProjectTasks).toEqual([]);
    state.user = null;
    rerender();
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
  it('does not subscribe to Firebase in mock mode even if a fixture supplies projects', () => {
    state.mock = true;
    renderHook(useMyTasks);
    expect(subscribeToProjectTasks).not.toHaveBeenCalled();
    expect(subscribeToProjectLists).not.toHaveBeenCalled();
  });
  it('does not report a project list failure as ready task counts', () => {
    state.error = new Error('permission denied');
    const { result } = renderHook(useMyTasks);
    expect(subscribeToProjectTasks).not.toHaveBeenCalled();
    expect(subscribeToProjectLists).not.toHaveBeenCalled();
    expect(result.current.projectTaskStatus.get('a')).toMatchObject({ status: 'error' });
  });
  it('keeps one task subscription per project when names or ordering change', () => {
    vi.mocked(subscribeToProjectTasks).mockImplementation(() => vi.fn());
    const { rerender, unmount } = renderHook(useMyTasks);
    expect(subscribeToProjectTasks).toHaveBeenCalledTimes(2);
    expect(subscribeToProjectLists).toHaveBeenCalledTimes(2);
    state.projects = [{ id: 'b', name: 'Renamed' }, { id: 'a', name: 'A' }];
    rerender();
    expect(subscribeToProjectTasks).toHaveBeenCalledTimes(2);
    expect(subscribeToProjectLists).toHaveBeenCalledTimes(2);
    unmount();
    for (const subscription of [...vi.mocked(subscribeToProjectTasks).mock.results, ...vi.mocked(subscribeToProjectLists).mock.results]) {
      expect(subscription.value).toHaveBeenCalledOnce();
    }
  });
  it('resolves current list names independently of task snapshots and follows renames and moves', () => {
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    const [listsA, listsB] = vi.mocked(subscribeToProjectLists).mock.calls;
    const rawTask = { ...task, listName: '古いリスト名', listColor: '#ffffff' };
    act(() => { a[1]([rawTask]); b[1]([]); });
    expect(result.current.tasks[0].listName).toBeUndefined();
    expect(result.current.tasks[0].listColor).toBeUndefined();
    act(() => {
      listsA[1]([viewList({ id: 'one', name: '東京ゲームダンジョン', color: '#2563eb' }), viewList({ id: 'two', name: 'ゲームショウ', color: '#16a34a' })]);
      listsB[1]([viewList({ id: 'one', name: '別プロジェクトのリスト', color: '#9333ea' })]);
    });
    expect(result.current.tasks[0]).toMatchObject({ listName: '東京ゲームダンジョン', listColor: '#2563eb' });
    act(() => listsA[1]([viewList({ id: 'one', name: '出展準備', color: '#dc2626' }), viewList({ id: 'two', name: 'ゲームショウ', color: '#16a34a' })]));
    expect(result.current.tasks[0]).toMatchObject({ listName: '出展準備', listColor: '#dc2626' });
    act(() => listsA[1]([viewList({ id: 'one', name: '出展準備', color: undefined }), viewList({ id: 'two', name: 'ゲームショウ', color: '#16a34a' })]));
    expect(result.current.tasks[0]).toMatchObject({ listName: '出展準備', listColor: undefined });
    act(() => a[1]([{ ...rawTask, listId: 'two' }]));
    expect(result.current.tasks[0]).toMatchObject({ listName: 'ゲームショウ', listColor: '#16a34a' });
    act(() => a[1]([{ ...rawTask, listId: 'unknown' }]));
    expect(result.current.tasks[0].listName).toBeUndefined();
    expect(result.current.tasks[0].listColor).toBeUndefined();
    expect(subscribeToProjectTasks).toHaveBeenCalledTimes(2);
    expect(subscribeToProjectLists).toHaveBeenCalledTimes(2);
  });
  it('keeps task data and readiness when list retrieval fails while clearing unverifiable names', () => {
    const { result } = renderHook(useMyTasks);
    const [a, b] = vi.mocked(subscribeToProjectTasks).mock.calls;
    const [listsA] = vi.mocked(subscribeToProjectLists).mock.calls;
    act(() => { a[1]([task]); b[1]([]); listsA[1]([viewList({ id: 'one', name: '出展準備', color: '#2563eb' })]); });
    expect(result.current.tasks[0]).toMatchObject({ listName: '出展準備', listColor: '#2563eb' });
    act(() => listsA[2]!(new Error('list permission denied')));
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.allProjectTasks[0]).toMatchObject({ id: 'task', projectId: 'a', listName: undefined, listColor: undefined });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'ready' });
  });
  it('discards list names from an old scope and ignores its late success and error callbacks', () => {
    const { result, rerender } = renderHook(useMyTasks);
    const [oldA, oldB] = vi.mocked(subscribeToProjectTasks).mock.calls;
    const [oldListsA, oldListsB] = vi.mocked(subscribeToProjectLists).mock.calls;
    const oldListSubscriptions = vi.mocked(subscribeToProjectLists).mock.results.map(entry => entry.value);
    act(() => { oldA[1]([task]); oldB[1]([]); oldListsA[1]([viewList({ id: 'one', name: '旧スコープ' })]); });
    state.projects = [{ id: 'b', name: 'B' }];
    rerender();
    expect(result.current.allProjectTasks).toEqual([]);
    for (const unsubscribe of oldListSubscriptions) expect(unsubscribe).toHaveBeenCalledOnce();
    const newB = vi.mocked(subscribeToProjectTasks).mock.calls[2];
    const newListsB = vi.mocked(subscribeToProjectLists).mock.calls[2];
    act(() => newB[1]([task]));
    expect(result.current.tasks[0].listName).toBeUndefined();
    expect(result.current.tasks[0].listColor).toBeUndefined();
    act(() => newListsB[1]([viewList({ id: 'one', name: '現在のリスト', color: '#16a34a' })]));
    act(() => {
      oldListsA[1]([viewList({ id: 'one', name: '古い通知A' })]);
      oldListsB[1]([viewList({ id: 'one', name: '古い通知B' })]);
      oldListsB[2]!(new Error('old subscription error'));
    });
    expect(result.current.allProjectTasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({ projectId: 'b', listName: '現在のリスト', listColor: '#16a34a' });
    state.user = null;
    rerender();
    act(() => newListsB[1]([viewList({ id: 'one', name: 'ログアウト後の通知' })]));
    expect(result.current.allProjectTasks).toEqual([]);
  });
  it.each(['error', 'loading'] as const)('waits for fresh snapshots after a project-list %s clears for the same scope', (reason) => {
    const { result, rerender } = renderHook(useMyTasks);
    const [oldA, oldB] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => { oldA[1]([task]); oldB[1]([]); });
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'ready' });
    if (reason === 'error') state.error = new Error('connection lost');
    else state.isLoading = true;
    rerender();
    expect(result.current.allProjectTasks).toEqual([]);

    state.error = null;
    state.isLoading = false;
    rerender();
    expect(subscribeToProjectTasks).toHaveBeenCalledTimes(4);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'loading' });
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'loading' });
    act(() => { oldA[1]([task]); oldB[1]([]); });
    expect(result.current.allProjectTasks).toEqual([]);
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'loading' });

    const [, , newA, newB] = vi.mocked(subscribeToProjectTasks).mock.calls;
    act(() => newA[1]([]));
    expect(result.current.projectTaskStatus.get('a')).toEqual({ status: 'ready' });
    expect(result.current.projectTaskStatus.get('b')).toEqual({ status: 'loading' });
    expect(result.current.isLoading).toBe(true);
    act(() => newB[1]([]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.allProjectTasks).toEqual([]);
  });
});
