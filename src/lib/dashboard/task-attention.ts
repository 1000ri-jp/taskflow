import type { DashboardTask } from './brief';

const key = (projectId: string, taskId: string) => JSON.stringify([projectId, taskId]);
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
