import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TARGET_TASK_STORAGE_KEY, useTargetTaskStore } from './targetTaskStore';

describe('targetTaskStore', () => {
  beforeEach(() => {
    localStorage.removeItem(TARGET_TASK_STORAGE_KEY);
    useTargetTaskStore.setState({ selections: [], persistenceFailed: false });
  });
  afterEach(() => vi.restoreAllMocks());
  it('persists only unique task IDs by month and project, preserving other selections', () => {
    const { save, hydrate } = useTargetTaskStore.getState();
    save('2026-09', 'project-a', ['task-1', 'task-1', 'task-2']);
    save('2026-09', 'project-b', ['task-3']);
    save('2026-10', 'project-a', ['task-4']);
    const saved = JSON.parse(localStorage.getItem(TARGET_TASK_STORAGE_KEY)!);
    expect(saved).toEqual([
      { month: '2026-09', projectId: 'project-a', taskIds: ['task-1', 'task-2'] },
      { month: '2026-09', projectId: 'project-b', taskIds: ['task-3'] },
      { month: '2026-10', projectId: 'project-a', taskIds: ['task-4'] },
    ]);
    useTargetTaskStore.setState({ selections: [] });
    hydrate();
    expect(useTargetTaskStore.getState().selections).toEqual(saved);
    save('2026-09', 'project-a', []);
    hydrate();
    expect(useTargetTaskStore.getState().selections.find((entry) => entry.month === '2026-09' && entry.projectId === 'project-a')?.taskIds).toEqual([]);
    expect(useTargetTaskStore.getState().selections).toHaveLength(3);
  });
  it.each(['{}', 'null', '[null, 2, "bad"]', '[{"month":"2026-13","projectId":"a","taskIds":["t"]}]', '[{"month":"2026-09","projectId":"a","taskIds":[1]}]'])('ignores invalid saved selections: %s', (raw) => {
    localStorage.setItem(TARGET_TASK_STORAGE_KEY, raw);
    useTargetTaskStore.getState().hydrate();
    expect(useTargetTaskStore.getState().selections).toEqual([]);
  });
  it('handles corrupt storage without throwing or writing over it', () => {
    localStorage.setItem(TARGET_TASK_STORAGE_KEY, 'invalid');
    expect(() => useTargetTaskStore.getState().hydrate()).not.toThrow();
    expect(useTargetTaskStore.getState().persistenceFailed).toBe(true);
    expect(localStorage.getItem(TARGET_TASK_STORAGE_KEY)).toBe('invalid');
  });
  it('keeps in-memory selections and reports persistence failure when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useTargetTaskStore.getState().save('2026-09', 'a', ['t']);
    expect(useTargetTaskStore.getState().selections[0].taskIds).toEqual(['t']);
    expect(useTargetTaskStore.getState().persistenceFailed).toBe(true);
  });
});
