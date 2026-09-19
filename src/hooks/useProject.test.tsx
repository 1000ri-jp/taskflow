import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProject } from './useProjects';
import { getProjectMembers, subscribeToProject } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Project, ProjectMember } from '@/types';

vi.mock('@/stores/authStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('@/lib/firebase/firestore', () => ({ getProjectMembers: vi.fn(), subscribeToProject: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const project = (id: string) => ({ id, name: id }) as Project;
const members = (id: string) => [{ id, userId: id }] as ProjectMember[];
const settle = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isE2EMockAuthEnabled).mockReturnValue(false);
  vi.mocked(getProjectMembers).mockResolvedValue([]);
  vi.mocked(subscribeToProject).mockImplementation(() => vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('useProject subscription scope', () => {
  it('clears a prior error when the current project is received again', async () => {
    const { result } = renderHook(() => useProject('a'));
    await settle();
    const [, success, failure] = vi.mocked(subscribeToProject).mock.calls[0];
    const error = new Error('temporarily unavailable');
    act(() => failure!(error));
    expect(result.current.error).toBe(error);
    expect(result.current.isLoading).toBe(false);
    act(() => success(project('a')));
    expect(result.current.project?.id).toBe('a');
    expect(result.current.error).toBeNull();
    act(() => success(null));
    expect(result.current.project).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('hides the old state immediately and ignores its late project, error, and member responses', async () => {
    const oldMembers = deferred<ProjectMember[]>();
    const nextMembers = deferred<ProjectMember[]>();
    vi.mocked(getProjectMembers).mockImplementation(id => id === 'a' ? oldMembers.promise : nextMembers.promise);
    const oldUnsubscribe = vi.fn();
    vi.mocked(subscribeToProject).mockReturnValueOnce(oldUnsubscribe).mockReturnValue(vi.fn());
    const { result, rerender } = renderHook(({ id }) => useProject(id), { initialProps: { id: 'a' } });
    await settle();
    const [, oldSuccess, oldFailure] = vi.mocked(subscribeToProject).mock.calls[0];
    act(() => { oldSuccess(project('a')); oldFailure!(new Error('old failure')); });

    rerender({ id: 'b' });
    expect(result.current.project).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(oldUnsubscribe).toHaveBeenCalledOnce();
    await settle();
    const [, nextSuccess] = vi.mocked(subscribeToProject).mock.calls[1];
    await act(async () => { nextSuccess(project('b')); nextMembers.resolve(members('b')); });
    await act(async () => {
      oldSuccess(project('a'));
      oldFailure!(new Error('late old failure'));
      oldMembers.resolve(members('a'));
    });
    expect(result.current.project?.id).toBe('b');
    expect(result.current.members).toEqual(members('b'));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores late failures and members after unmount and unsubscribes once', async () => {
    const pending = deferred<ProjectMember[]>();
    vi.mocked(getProjectMembers).mockReturnValue(pending.promise);
    const unsubscribe = vi.fn();
    vi.mocked(subscribeToProject).mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useProject('a'));
    await settle();
    const [, success, failure] = vi.mocked(subscribeToProject).mock.calls[0];
    unmount();
    await act(async () => {
      success(project('a'));
      failure!(new Error('late failure'));
      pending.reject(new Error('late members failure'));
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('does not open a subscription if unmounted before its deferred setup', async () => {
    const { unmount } = renderHook(() => useProject('a'));
    unmount();
    await settle();
    expect(subscribeToProject).not.toHaveBeenCalled();
    expect(getProjectMembers).not.toHaveBeenCalled();
  });

  it('clears the old scope when no project is selected', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useProject(id), { initialProps: { id: 'a' as string | null } });
    await settle();
    const [, success, failure] = vi.mocked(subscribeToProject).mock.calls[0];
    act(() => { success(project('a')); failure!(new Error('old failure')); });
    rerender({ id: null });
    expect(result.current.project).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    await settle();
    expect(result.current.members).toEqual([]);
    expect(subscribeToProject).toHaveBeenCalledTimes(1);
  });

  it('keeps mock mode isolated from both project and member reads', async () => {
    vi.mocked(isE2EMockAuthEnabled).mockReturnValue(true);
    const { result } = renderHook(() => useProject('a'));
    await settle();
    expect(result.current.project).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(subscribeToProject).not.toHaveBeenCalled();
    expect(getProjectMembers).not.toHaveBeenCalled();
  });
});
