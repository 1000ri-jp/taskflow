import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalSearch } from './useGlobalSearch';
import type { Project, Task } from '@/types';

const state = vi.hoisted(() => ({ projects: [] as Project[], isLoading: false, error: null as Error | null, fetch: vi.fn() }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => state }));
vi.mock('@/lib/firebase/firestore', () => ({ getProjectTasks: (...args: unknown[]) => state.fetch(...args) }));
const project = (id: string) => ({ id, name: id, description: '', icon: '📁', color: '' }) as Project;
const task = (id: string, title: string, projectId = 'p1') => ({ id, title, description: '', projectId, isCompleted: false }) as Task;
const settle = () => act(async () => { await Promise.resolve(); });
beforeEach(() => { state.projects = [project('p1')]; state.isLoading = false; state.error = null; state.fetch.mockReset(); });

describe('global search results', () => {
  it('keeps matching tasks when a second query uses the task cache', async () => {
    state.fetch.mockResolvedValue([task('t1', 'チェックリストの作成')]);
    const { result } = renderHook(() => useGlobalSearch());
    await settle();
    act(() => result.current.setQuery('存在しない'));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce()); await settle();
    act(() => result.current.setQuery('チェックリスト'));
    await settle();
    expect(result.current.taskResults.map(t => t.id)).toEqual(['t1']);
    expect(state.fetch).toHaveBeenCalledOnce();
  });
});

describe('global search failures and request scope', () => {
  it('shows a partial fetch error, preserves successes, and retries only failures', async () => {
    state.projects = [project('p1'), project('p2')];
    state.fetch.mockImplementation((id: string) => id === 'p1' ? Promise.resolve([task('t1', '案内')]) : Promise.reject(new Error('offline')));
    const { result } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('案内')); await settle();
    expect(result.current.taskResults.map(t => t.id)).toEqual(['t1']);
    expect(result.current.error).toContain('1件のプロジェクト');
    state.fetch.mockResolvedValue([task('t2', '案内の確認', 'p2')]);
    act(() => result.current.retry?.()); await settle();
    expect(result.current.error).toBeNull();
    expect(result.current.taskResults.map(t => t.id)).toEqual(['t1','t2']);
    expect(state.fetch.mock.calls.map(c => c[0])).toEqual(['p1','p2','p2']);
  });

  it('does not restore results after the query is closed during a request', async () => {
    let resolve!: (tasks: Task[]) => void;
    state.fetch.mockReturnValue(new Promise<Task[]>(done => { resolve = done; }));
    const { result } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('案内')); await settle();
    act(() => result.current.setQuery('')); await settle();
    await act(async () => { resolve([task('t1','案内')]); });
    expect(result.current.results).toEqual([]); expect(result.current.isSearching).toBe(false);
  });

  it('keeps the current query results when an older request resolves later', async () => {
    let resolveOld!: (tasks: Task[]) => void;
    state.fetch.mockReturnValueOnce(new Promise<Task[]>(done => { resolveOld = done; })).mockResolvedValue([task('new','新しい仕事')]);
    const { result } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('古い')); await settle();
    act(() => result.current.setQuery('新しい')); await settle();
    await act(async () => { resolveOld([task('old','古い仕事')]); });
    expect(result.current.taskResults.map(t => t.id)).toEqual(['new']);
  });

  it('does not reuse another project/account snapshot or include archived tasks', async () => {
    state.fetch.mockResolvedValue([task('old','案内')]);
    const { result, rerender } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('案内')); await settle();
    state.projects = [project('p2')]; state.fetch.mockResolvedValue([{...task('archived','案内','p2'),isArchived:true}, task('new','案内','p2')]);
    rerender(); await settle();
    expect(result.current.taskResults.map(t => t.id)).toEqual(['new']);
    expect(result.current.taskResults[0].projectId).toBe('p2');
  });

  it('handles legacy missing descriptions without losing matching results', async () => {
    state.projects = [{...project('p1'), description: undefined} as unknown as Project];
    state.fetch.mockResolvedValue([{...task('t1','案内'),description:undefined}]);
    const { result } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('案内')); await settle();
    expect(result.current.taskResults[0].id).toBe('t1'); expect(result.current.error).toBeNull();
  });

  it('keeps project loading and project failures distinct from empty results', async () => {
    state.isLoading = true;
    const { result, rerender } = renderHook(() => useGlobalSearch()); await settle();
    act(() => result.current.setQuery('案内')); await settle();
    expect(result.current.isSearching).toBe(true); expect(state.fetch).not.toHaveBeenCalled();
    state.isLoading=false;state.error=new Error('no connection');rerender(); await settle();
    expect(result.current.isSearching).toBe(false);expect(result.current.error).toContain('検索できませんでした');
  });
});
