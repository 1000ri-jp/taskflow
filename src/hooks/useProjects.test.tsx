import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { reorderUserProjects, subscribeToUserProjects } from '@/lib/firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Project } from '@/types';
import { useProjects } from './useProjects';
vi.mock('@/lib/firebase/firestore', () => ({ subscribeToUserProjects: vi.fn(), reorderUserProjects: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const login = (uid: string) => useAuthStore.setState({ firebaseUser: { uid } as FirebaseUser });
const projects = ['a', 'b'].map(id => ({ id })) as Project[];
const settle = () => act(async () => { await Promise.resolve(); });
beforeEach(() => { vi.resetAllMocks(); login('alice'); vi.mocked(subscribeToUserProjects).mockReturnValue(vi.fn()); vi.mocked(reorderUserProjects).mockResolvedValue(undefined); });
it('passes the signed-in user when reordering and rejects stale or incomplete lists', async () => {
  const { result } = renderHook(useProjects); await settle();
  await expect(result.current.reorder(['a', 'b'])).rejects.toThrow('取得後');
  act(() => vi.mocked(subscribeToUserProjects).mock.calls[0][1](projects));
  await act(() => result.current.reorder(['b', 'a']));
  expect(reorderUserProjects).toHaveBeenCalledExactlyOnceWith('alice', ['b', 'a']);
  await expect(result.current.reorder(['b'])).rejects.toThrow('一覧が変わりました');
});
it('hides the previous account immediately and ignores late list responses', async () => {
  const { result } = renderHook(useProjects); await settle();
  const [, oldResult, oldError] = vi.mocked(subscribeToUserProjects).mock.calls[0];
  act(() => oldResult(projects)); expect(result.current.projects).toEqual(projects);
  act(() => login('bob')); expect(result.current.projects).toEqual([]); await settle();
  act(() => { oldResult(projects); oldError!(new Error('old user')); });
  expect(result.current.projects).toEqual([]); expect(result.current.error).toBeNull();
  act(() => vi.mocked(subscribeToUserProjects).mock.calls[1][1]([...projects].reverse()));
  await act(() => result.current.reorder(['a', 'b']));
  expect(reorderUserProjects).toHaveBeenLastCalledWith('bob', ['a', 'b']);
});
it('reports a failed save and keeps the last subscribed order', async () => {
  const { result } = renderHook(useProjects); await settle(); act(() => vi.mocked(subscribeToUserProjects).mock.calls[0][1](projects));
  vi.mocked(reorderUserProjects).mockRejectedValue(new Error('offline'));
  await act(async () => { await expect(result.current.reorder(['b', 'a'])).rejects.toThrow('offline'); });
  expect(result.current.projects).toEqual(projects); expect(result.current.error?.message).toBe('offline');
});
