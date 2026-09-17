import { validTaskDate } from '@/lib/board/taskViews';
import type { Task } from '@/types';

/** Move one subtask to the target's position without changing task data. */
export function moveTaskSubtask(ids: readonly string[], itemId: string, targetId: string): string[] {
  const next = [...ids];
  const from = next.indexOf(itemId);
  const to = next.indexOf(targetId);
  if (from < 0 || to < 0 || new Set(next).size !== next.length) {
    throw new Error('サブタスクが変更されています。タスクを開き直してから並べ替えてください。');
  }
  if (from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Direct, visible subtasks in saved parent order; legacy/unlisted entries use deadline order. */
export function getTaskSubtasks(task: Task, tasks: Task[]): Task[] {
  const dueTime = (item: Task) => validTaskDate(item.dueDate) ? item.dueDate.getTime() : Infinity;
  const orderedIds = new Map((task.subtaskOrderIds ?? []).map((id, index) => [id, index]));
  return tasks.filter(item => item.projectId === task.projectId && item.parentTaskId === task.id && item.taskKind !== 'review_request' && !item.isArchived)
    .sort((a, b) => {
      const aOrder = orderedIds.get(a.id);
      const bOrder = orderedIds.get(b.id);
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1;
        if (bOrder === undefined) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      return dueTime(a) - dueTime(b) || a.order - b.order || a.id.localeCompare(b.id);
    });
}
