import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCountdownMilestones } from './useCountdownMilestones';
import { subscribeToProjectMilestones } from '@/lib/firebase/firestore';
import type { Milestone } from '@/types';

const auth = vi.hoisted(() => ({ firebaseUser: { uid: 'a' } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) }));
vi.mock('@/lib/firebase/firestore', () => ({ subscribeToProjectMilestones: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const callbacks = new Map<string, (items: Milestone[]) => void>();
const errors = new Map<string, (error: Error) => void>();
const stop = vi.fn();
const milestone = { id: 'm', projectId: 'p', title: '展示会', status: 'planned', dueDate: new Date('2026-09-24') } as Milestone;
beforeEach(() => {
  vi.clearAllMocks(); callbacks.clear(); errors.clear(); auth.firebaseUser = { uid: 'a' };
  vi.mocked(subscribeToProjectMilestones).mockImplementation((id, receive, error) => { callbacks.set(id, receive); errors.set(id, error!); return stop; });
});
afterEach(cleanup);
it('subscribes to projects without tasks, updates dates, and isolates failed projects', () => {
  const { result } = renderHook(() => useCountdownMilestones([{ id: 'p', name: 'イベント' }, { id: 'q', name: '別件' }]));
  expect(result.current.isLoading).toBe(true);
  act(() => { callbacks.get('p')!([milestone]); errors.get('q')!(new Error('permission denied')); });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.milestones).toEqual([{ ...milestone, projectName: 'イベント' }]);
  expect(result.current.error).toBeInstanceOf(Error);
  act(() => callbacks.get('p')!([{ ...milestone, dueDate: new Date('2026-09-25') }]));
  expect(result.current.milestones[0].dueDate).toEqual(new Date('2026-09-25'));
});
it('drops removed projects and late callbacks across account changes', () => {
  const { result, rerender } = renderHook(({ projects }) => useCountdownMilestones(projects), { initialProps: { projects: [{ id: 'p', name: 'イベント' }] } });
  const oldCallback = callbacks.get('p')!;
  act(() => oldCallback([milestone]));
  auth.firebaseUser = { uid: 'b' };
  rerender({ projects: [{ id: 'p', name: 'イベント' }] });
  expect(result.current.milestones).toEqual([]);
  act(() => oldCallback([milestone]));
  expect(result.current.milestones).toEqual([]);
  act(() => callbacks.get('p')!([milestone]));
  rerender({ projects: [] });
  expect(result.current.milestones).toEqual([]);
  expect(result.current.isLoading).toBe(false);
  expect(stop).toHaveBeenCalledTimes(2);
});
