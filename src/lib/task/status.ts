import { parentReviews, reviewResult } from './reviews';
import type { Task } from '@/types';

export const TASK_STATUSES = [
  { id: 'not_started', label: '未着手', color: 'text-slate-600', dot: 'bg-slate-400' },
  { id: 'started', label: '着手', color: 'text-blue-700', dot: 'bg-blue-500' },
  { id: 'waiting', label: '待機', color: 'text-amber-700', dot: 'bg-amber-500' },
  { id: 'completed', label: '完了', color: 'text-emerald-700', dot: 'bg-emerald-500' },
  { id: 'archived', label: 'アーカイブ', color: 'text-slate-500', dot: 'bg-slate-300' },
] as const;
export type TaskStatusId = typeof TASK_STATUSES[number]['id'];

/** Keep progress, dependency waits and archival separate in storage. */
export function taskBlockers(task: Task, tasks: readonly Task[]) {
  return [...new Set(task.dependsOnTaskIds ?? [])].flatMap(id => {
    const dependency = tasks.find(candidate => candidate.id === id && candidate.projectId === task.projectId);
    return dependency?.isCompleted && !dependency.isArchived && !dependency.isAbandoned ? [] : [{ id, task: dependency }];
  });
}

export function taskStatus(task: Task, tasks: readonly Task[]): TaskStatusId {
  if (task.isArchived) return 'archived';
  if (task.isCompleted) return 'completed';
  if (!task.isAbandoned && (task.workState || taskBlockers(task, tasks).length || parentReviews(task, tasks).some(t => !t.isCompleted && reviewResult(t) !== 'changes_requested'))) return 'waiting';
  return task.workProgress === 'started' ? 'started' : 'not_started';
}

export function taskStatusLabel(task: Task, tasks: readonly Task[]) {
  return TASK_STATUSES.find(status => status.id === taskStatus(task, tasks))!.label;
}
