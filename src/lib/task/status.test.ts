import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { taskBlockers, taskStatus } from './status';
import { planWorkflow, taskVersion, type WorkflowAction } from './workflow';
import type { Task } from '@/types';

const now = new Date('2026-09-13T03:00:00Z');
const apply = (task: Task, action: WorkflowAction, tasks: Task[] = [task]) => ({ ...task, ...planWorkflow(task, tasks, 'u', { id: 'change', action, expectedVersion: taskVersion(task) }, now).patch });
describe('task progress', () => {
  it('keeps legacy tasks unstarted regardless of their scheduled dates', () => {
    expect(taskStatus(viewTask({ startDate: new Date(2020, 0, 1) }), [])).toBe('not_started');
  });
  it('waits on unfinished or unavailable prerequisites and restores the underlying progress when resolved', () => {
    const dependency = viewTask({ id: 'dependency' });
    for (const workProgress of ['not_started', 'started'] as const) {
      const task = viewTask({ workProgress, dependsOnTaskIds: [dependency.id] });
      expect(taskStatus(task, [dependency])).toBe('waiting');
      expect(taskStatus(task, [{ ...dependency, isCompleted: true }])).toBe(workProgress);
      for (const tasks of [[], [{ ...dependency, isCompleted: true, isArchived: true }], [{ ...dependency, isCompleted: true, isAbandoned: true }], [{ ...dependency, projectId: 'other', isCompleted: true }]]) {
        expect(taskStatus(task, tasks)).toBe('waiting');
        expect(() => apply(task, 'start', tasks)).toThrow('前提');
        expect(() => apply(task, 'complete', tasks)).toThrow('前提');
      }
    }
    expect(taskBlockers(viewTask({ dependsOnTaskIds: ['missing', 'missing'] }), [])).toHaveLength(1);
  });
  it('changes progress, clears obsolete completion dates and preserves work ownership and dates', () => {
    const original = viewTask({ dueDate: new Date(2026, 8, 20), assigneeIds: ['u', 'other'] });
    const started = apply(original, 'start');
    expect(taskStatus(started, [])).toBe('started');
    const completed = apply(started, 'complete');
    expect(completed.completedAt).toEqual(now);
    expect(apply(completed, 'start')).toMatchObject({ isCompleted: false, completedAt: null, workProgress: 'started' });
    const reset = apply(completed, 'reset');
    expect(reset).toMatchObject({ isCompleted: false, completedAt: null, workProgress: 'not_started', assigneeIds: original.assigneeIds, dueDate: original.dueDate });
  });
  it('archives and restores both completed and active work without losing its prior state', () => {
    for (const isCompleted of [false, true]) {
      const task = viewTask({ workProgress: 'started', isCompleted, completedAt: isCompleted ? now : null });
      const archived = apply(task, 'archive');
      expect(taskStatus(archived, [])).toBe('archived');
      expect(archived).toMatchObject({ archivedBy: 'u', archivedAt: now, isCompleted });
      expect(() => apply(archived, 'start')).toThrow('アーカイブ');
      expect(() => apply(archived, 'archive')).toThrow('状態が変わ');
      const restored = apply(archived, 'restore');
      expect(restored).toMatchObject({ isArchived: false, archivedAt: null, archivedBy: null, completedAt: task.completedAt });
      expect(taskStatus(restored, [])).toBe(isCompleted ? 'completed' : 'started');
    }
  });
  it('does not bypass review decisions or clear an existing reasoned hold', () => {
    const review = viewTask({ taskKind: 'review_request' });
    for (const action of ['start', 'reset', 'complete'] as const) expect(() => apply(review, action)).toThrow('確認依頼');
    const workState = { status: 'hold' as const, reason: '予算確認', resumeCondition: '承認後', reviewAt: null };
    const held = viewTask({ workState });
    expect(() => apply(held, 'start')).toThrow('保留');
    expect(apply(held, 'reset').workState).toEqual(workState);
  });
});
