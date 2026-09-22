import type { Task } from '@/types';

export function isStrictDeadlineTask(task: Pick<Task, 'deadlinePolicy'>): boolean {
  return task.deadlinePolicy === 'strict';
}
