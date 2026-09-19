import type { Task } from '@/types';
export const canReceiveDefaultAssignee = (task: Pick<Task, 'assigneeIds' | 'isArchived' | 'isAbandoned' | 'isCompleted' | 'taskKind'>) =>
  !task.assigneeIds?.length && !task.isArchived && !task.isAbandoned && !task.isCompleted && task.taskKind !== 'review_request';

/** Validate the entire reviewed selection before making any writes. */
export function planAssigneeBackfill(tasks: Record<string, Record<string, unknown>>, ids: string[], assigneeId: string, currentDefault: string | null | undefined, members: string[]) {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !id || id.includes('/'))) throw new Error('対象は1〜100件で選んでください。');
  if (assigneeId !== currentDefault || !members.includes(assigneeId)) throw new Error('主担当が変更されています。表示を確認して選び直してください。');
  for (const id of ids) {
    const task = tasks[id];
    if (!task || !canReceiveDefaultAssignee(task as unknown as Task)) throw new Error('選んだタスクの担当・状態が変更されています。対象を確認し直してください。');
  }
  return ids.map(id => ({ id, assigneeIds: [assigneeId] }));
}
