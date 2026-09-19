import { TASK_STATUSES, taskStatus, type TaskStatusId } from '@/lib/task/status';
import { planWorkflow, taskVersion, type WorkflowAction } from '@/lib/task/workflow';
import type { Task } from '@/types';

const actions: Partial<Record<TaskStatusId, WorkflowAction>> = {
  not_started: 'reset', started: 'start', completed: 'complete', archived: 'archive',
};

// Preview the same rules enforced by the transaction; a drop never edits dependencies or approval conditions.
export function progressMoveAction(task: Task, target: TaskStatusId, tasks: Task[], userId: string): WorkflowAction | null {
  if (!userId) throw new Error('ログインしてから変更してください。');
  if (taskStatus(task, tasks) === target) return null;
  let action: WorkflowAction;
  if (task.isArchived) {
    const restored = taskStatus({ ...task, isArchived: false }, tasks);
    if (target !== restored) throw new Error(`この仕事は「${TASK_STATUSES.find(status => status.id === restored)!.label}」列へ戻すと復元できます。`);
    action = 'restore';
  } else {
    if (target === 'waiting') throw new Error('待機は、未完了の前提タスクがあると自動で表示されます。依存関係は詳細から設定できます。');
    action = actions[target]!;
  }
  const plan = planWorkflow(task, tasks, userId, { id: 'progress-preview', action, expectedVersion: taskVersion(task), note: '' }, new Date());
  if (taskStatus({ ...task, ...plan.patch }, tasks) !== target) throw new Error('前提の仕事が終わるまでは「待機」になります。依存関係を詳細で確認してください。');
  return action;
}
