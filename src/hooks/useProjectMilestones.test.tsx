import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectMilestones } from './useProjectMilestones';
import { createMilestone } from '@/lib/firebase/firestore';
import type { Milestone } from '@/types';

const state = vi.hoisted(() => ({ success: (() => {}) as (items: Milestone[]) => void, failure: () => {}, stop: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'u' } }) }));
vi.mock('@/lib/firebase/firestore', () => ({ createMilestone: vi.fn().mockResolvedValue('created'), subscribeToProjectMilestones: (_: string, success: typeof state.success, failure: typeof state.failure) => { state.success = success; state.failure = failure; return state.stop; } }));
beforeEach(() => vi.clearAllMocks());
const data = { title: '出展日', description: '', dueDate: new Date(2026, 8, 23) };
describe('milestone creation from project views', () => {
  it('waits for the current project data and creates a shared milestone with the signed-in user', async () => {
    const { result, rerender } = renderHook(({ project }) => useProjectMilestones(project), { initialProps: { project: 'p1' } });
    await expect(result.current.onAdd(data)).rejects.toThrow();
    expect(createMilestone).not.toHaveBeenCalled();
    act(() => state.success([{ order: 4 } as Milestone]));
    await expect(result.current.onAdd(data)).resolves.toBe('created');
    expect(createMilestone).toHaveBeenCalledExactlyOnceWith('p1', { ...data, status: 'planned', achievedAt: null, createdBy: 'u', order: 5 });
    rerender({ project: 'p2' });
    await expect(result.current.onAdd(data)).rejects.toThrow();
    expect(createMilestone).toHaveBeenCalledTimes(1);
    expect(state.stop).toHaveBeenCalled();
  });
  it('does not write when the subscription has failed or the date is invalid', async () => {
    const { result } = renderHook(() => useProjectMilestones('p'));
    act(() => state.failure());
    await expect(result.current.onAdd(data)).rejects.toThrow();
    act(() => state.success([]));
    await expect(result.current.onAdd({ ...data, dueDate: new Date('invalid') })).rejects.toThrow();
    expect(createMilestone).not.toHaveBeenCalled();
  });
});
