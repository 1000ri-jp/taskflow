import type { Task } from '@/types';

export class TaskParentRejected extends Error {}

/** Candidates must have an intact, non-cyclic ancestry in this project. */
export function canBeTaskParent(task: Task, parentId: string, tasksById: ReadonlyMap<string, Task>): boolean {
  const candidate = tasksById.get(parentId);
  if (!candidate || candidate.parentTaskId || candidate.isAbandoned || candidate.taskKind === 'review_request') return false;
  if ([...tasksById.values()].some(item => item.projectId === task.projectId && item.parentTaskId === task.id)) return false;
  const visited = new Set([task.id]);
  let id: string | undefined = parentId;
  while (id) {
    if (visited.has(id)) return false;
    visited.add(id);
    const parent = tasksById.get(id);
    if (!parent || parent.projectId !== task.projectId || parent.isArchived) return false;
    id = parent.parentTaskId;
  }
  return true;
}

export type ChangeTaskParent = (taskId: string, parentId: string | null) => Promise<void>;
