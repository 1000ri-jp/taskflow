import { civilDate } from '@/lib/task/recurrence';
import type { DashboardTask } from './brief';

const key = (projectId: string, taskId: string) => JSON.stringify([projectId, taskId]);
export const TASK_CHECK_DECISION_EVENT = 'taskflow-task-check-decision';
export const TASK_CHECK_READ_UNTIL = Number.MAX_SAFE_INTEGER;
export const taskCheckStorageKey = (userId: string) => `taskflow.companion.task-checks.v2:${userId}`;
export type TaskCheckDecisions = Record<string, number>;

export function taskCheckKey(parent: DashboardTask, children: DashboardTask[]) {
  return JSON.stringify([parent.projectId, parent.id, civilDate(parent.completedAt), children.map(child => [child.id, child.title, child.workProgress, child.workState, civilDate(child.dueDate), [...child.assigneeIds].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export function readTaskCheckDecisions(userId: string): TaskCheckDecisions {
  try {
    const value = JSON.parse(localStorage.getItem(taskCheckStorageKey(userId)) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, until]) => typeof until === 'number' && Number.isFinite(until))) as TaskCheckDecisions;
  } catch {
    return {};
  }
}

export function saveTaskCheckDecision(userId: string, decisionKey: string, until: number): TaskCheckDecisions {
  const next = { ...readTaskCheckDecisions(userId), [decisionKey]: until };
  try { localStorage.setItem(taskCheckStorageKey(userId), JSON.stringify(next)); } catch { /* Keep this visit usable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TASK_CHECK_DECISION_EVENT, { detail: { userId } }));
  return next;
}

/** Only known contradictions; missing parents or unread projects are not evidence. */
export function completedParentIssues<T extends DashboardTask>(tasks: readonly T[]) {
  const parents = new Map(tasks.filter(task => task.isCompleted && !task.isArchived && !task.isAbandoned)
    .map(task => [key(task.projectId, task.id), task]));
  const groups = new Map<string, { parent: T; children: T[] }>();
  for (const child of tasks) {
    if (!child.parentTaskId || child.isCompleted || child.isArchived || child.isAbandoned || child.taskKind === 'review_request') continue;
    const parentKey = key(child.projectId, child.parentTaskId), parent = parents.get(parentKey);
    if (!parent || parent.id === child.id) continue;
    const group = groups.get(parentKey) ?? { parent, children: [] };
    group.children.push(child); groups.set(parentKey, group);
  }
  return [...groups.values()].sort((a, b) => b.parent.updatedAt.getTime() - a.parent.updatedAt.getTime());
}
