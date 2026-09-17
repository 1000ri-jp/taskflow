import { expect, it } from 'vitest';
import { progressMoveAction } from './progressMoves';
import { planWorkflow, taskVersion } from '@/lib/task/workflow';
import { taskStatus, type TaskStatusId } from '@/lib/task/status';
import { viewTask } from '@/test/taskViewFixtures';

it.each([['started', 'start'], ['completed', 'complete'], ['archived', 'archive']] as const)('moves to %s through the existing %s workflow without changing shared facts', (target, action) => {
  const task = viewTask({ assigneeIds: ['worker'], dueDate: new Date(2026, 8, 23) });
  const before = structuredClone(task);
  expect(progressMoveAction(task, target, [task], 'worker')).toBe(action);
  const result = planWorkflow(task, [task], 'worker', { id: 'drop', action, expectedVersion: taskVersion(task), note: '' }, new Date());
  expect(taskStatus({ ...task, ...result.patch }, [task])).toBe(target);
  expect(result.patch).not.toHaveProperty('listId');
  expect(result.patch).not.toHaveProperty('assigneeIds');
  expect(result.patch).not.toHaveProperty('dueDate');
  expect(task).toEqual(before);
});
it('reopens completed work, restores its previous status, and ignores same-column drops', () => {
  const done = viewTask({ isCompleted: true });
  expect(progressMoveAction(done, 'not_started', [done], 'u')).toBe('reset');
  expect(progressMoveAction(done, 'started', [done], 'u')).toBe('start');
  expect(progressMoveAction(done, 'completed', [done], 'u')).toBeNull();
  const archived = { ...done, isArchived: true };
  expect(progressMoveAction(archived, 'completed', [archived], 'u')).toBe('restore');
  expect(() => progressMoveAction(archived, 'started', [archived], 'u')).toThrow('完了');
});
it('does not invent or bypass dependency waits', () => {
  const dep = viewTask({ id: 'dep' });
  const task = viewTask({ workProgress: 'started', dependsOnTaskIds: ['dep'] });
  for (const status of ['not_started', 'started', 'completed'] as TaskStatusId[]) expect(() => progressMoveAction(task, status, [dep, task], 'u')).toThrow();
  expect(progressMoveAction(task, 'waiting', [dep, task], 'u')).toBeNull();
  expect(progressMoveAction(task, 'archived', [dep, task], 'u')).toBe('archive');
  expect(() => progressMoveAction(dep, 'waiting', [dep, task], 'u')).toThrow('依存関係');
  expect(() => progressMoveAction(task, 'completed', [task], 'u')).toThrow();
});
it('does not turn a review response or an unfinished child into an ordinary completion', () => {
  const review = viewTask({ taskKind: 'review_request' });
  expect(() => progressMoveAction(review, 'completed', [review], 'u')).toThrow();
  const task = viewTask({ completionPolicy: { kind: 'all_required_children', condition: '全員分', required: [{ taskId: 'child', assigneeId: 'u' }], grantedBy: 'u', grantedAt: new Date().toISOString() } });
  const child = viewTask({ id: 'child', parentTaskId: task.id });
  expect(() => progressMoveAction(task, 'completed', [task, child], 'u')).toThrow();
});
