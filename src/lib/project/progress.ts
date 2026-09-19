import { startOfDay } from 'date-fns';
import type { Task } from '@/types';

export interface ProjectTaskProgress {
  total: number;
  completed: number;
  remaining: number;
  overdue: number;
}

export type ProjectProgressState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; progress: ProjectTaskProgress };

export function buildProjectProgress(projectIds: readonly string[], tasks: readonly Task[], now: Date): Map<string, ProjectTaskProgress> {
  const summaries = new Map(projectIds.map(id => [id, { total: 0, completed: 0, remaining: 0, overdue: 0 }]));
  const today = startOfDay(now).getTime();

  for (const task of tasks) {
    const summary = summaries.get(task.projectId);
    if (!summary || task.isArchived || task.isAbandoned) continue;
    summary.total += 1;
    if (task.isCompleted) {
      summary.completed += 1;
    } else {
      summary.remaining += 1;
      if (task.dueDate && task.dueDate.getTime() < today) summary.overdue += 1;
    }
  }
  return summaries;
}
