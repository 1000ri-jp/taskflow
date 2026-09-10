import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TARGET_GOAL_STORAGE_KEY, useTargetGoalStore } from './targetGoalStore';

describe('targetGoalStore', () => {
  beforeEach(() => {
    localStorage.removeItem(TARGET_GOAL_STORAGE_KEY);
    useTargetGoalStore.setState({ goals: [], persistenceFailed: false });
  });

  afterEach(() => {
    localStorage.removeItem(TARGET_GOAL_STORAGE_KEY);
  });

  it('stores and restores a goal with cross-project task references', () => {
    const goal = {
      id: 'goal-1',
      title: 'モニター3人',
      targetCount: 3,
      criterion: 'order_received' as const,
      units: [
        { id: 'unit-1', label: 'モニター1', projectId: 'sales', taskId: 'order-1' },
        { id: 'unit-2', label: 'モニター2', projectId: 'sales', taskId: 'order-2' },
        { id: 'unit-3', label: 'モニター3', projectId: null, taskId: null },
      ],
    };
    useTargetGoalStore.getState().save(goal);
    useTargetGoalStore.setState({ goals: [] });
    useTargetGoalStore.getState().hydrate();
    expect(useTargetGoalStore.getState().goals).toEqual([goal]);
  });

  it('ignores invalid stored goals', () => {
    localStorage.setItem(TARGET_GOAL_STORAGE_KEY, JSON.stringify([
      { id: 'goal-1', title: '不正', targetCount: 0, criterion: 'order_received', units: [] },
      { id: 'goal-2', title: '正しい', targetCount: 1, criterion: 'delivered', units: [{ id: 'unit-1', label: '1人目', projectId: null, taskId: null }] },
    ]));
    useTargetGoalStore.getState().hydrate();
    expect(useTargetGoalStore.getState().goals.map((goal) => goal.id)).toEqual(['goal-2']);
  });

  it('removes a goal and persists the remaining goals', () => {
    const goal = { id: 'goal-1', title: '削除対象', targetCount: 1, criterion: 'delivered' as const, units: [{ id: 'unit-1', label: '1人目', projectId: null, taskId: null }] };
    useTargetGoalStore.getState().save(goal);
    useTargetGoalStore.getState().remove(goal.id);
    expect(useTargetGoalStore.getState().goals).toEqual([]);
    expect(JSON.parse(localStorage.getItem(TARGET_GOAL_STORAGE_KEY)!)).toEqual([]);
  });
});
