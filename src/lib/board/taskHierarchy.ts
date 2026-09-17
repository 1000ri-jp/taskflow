import type { Task } from '@/types';

export interface TaskFamily {
  task: Task;
  children: Task[];
  isContext: boolean;
}

// Resolve once per view. Missing parents remain visible as standalone tasks.
// Ordinary views exclude archives; progress can include them in the same family.
// A broken cycle gets one deterministic root, so it cannot hide a whole family.
export function taskRoots(tasks: readonly Task[], { includeArchived = false }: { includeArchived?: boolean } = {}) {
  const byId = new Map(tasks.filter(task => includeArchived || !task.isArchived).map(task => [task.id, task]));
  const roots = new Map<string, Task>();
  for (const task of byId.values()) {
    const path: string[] = [];
    let current = task;
    while (!roots.has(current.id) && !path.includes(current.id)) {
      path.push(current.id);
      const parent = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
      if (!parent || parent.projectId !== task.projectId) break;
      current = parent;
    }
    const cycleStart = path.indexOf(current.id);
    const isCycle = current.parentTaskId && path.includes(current.parentTaskId);
    const root = roots.get(current.id) ?? (isCycle
      ? byId.get([...path.slice(cycleStart)].sort()[0])!
      : current);
    for (const id of path) roots.set(id, root);
  }
  return roots;
}

export function groupTaskFamilies(visible: readonly Task[], allTasks: readonly Task[] = visible, { includeArchived = false }: { includeArchived?: boolean } = {}): TaskFamily[] {
  const roots = taskRoots(allTasks, { includeArchived });
  const visibleIds = new Set(visible.filter(task => includeArchived || !task.isArchived).map(task => task.id));
  const families = new Map<string, TaskFamily>();
  for (const task of visible) {
    if ((!includeArchived && task.isArchived) || task.taskKind === 'review_request') continue;
    const root = roots.get(task.id) ?? task;
    const family = families.get(root.id) ?? { task: root, children: [], isContext: !visibleIds.has(root.id) };
    if (task.id !== root.id && !family.children.some(child => child.id === task.id)) family.children.push(task);
    families.set(root.id, family);
  }
  return [...families.values()];
}

export function tasksInList(tasks: readonly Task[], listId: string | null) {
  if (!listId) return tasks.filter(task => !task.isArchived);
  const roots = taskRoots(tasks);
  return tasks.filter(task => !task.isArchived && (task.listId === listId || roots.get(task.id)?.listId === listId));
}

export function orderChildTasks(tasks: readonly Task[], allTasks: readonly Task[]) {
  void allTasks;
  return [...tasks].filter(t => t.taskKind !== 'review_request').sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.order - b.order || a.id.localeCompare(b.id));
}
