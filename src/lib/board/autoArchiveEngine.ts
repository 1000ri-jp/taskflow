import { ARCHIVE_DAY_MS, validArchiveDays } from './autoArchivePreview';

export interface AutoArchiveTask {
  id: string; projectId: string; title?: string; listId?: string;
  isCompleted?: boolean; isArchived?: boolean; isAbandoned?: boolean;
  completedAt?: unknown; autoArchiveCompletedAt?: unknown;
  parentTaskId?: string | null; dependsOnTaskIds?: string[];
  completionPolicy?: { required?: { taskId: string }[] } | null;
}

export function archiveDate(value: unknown): Date | null {
  try {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value)
      : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? new Date(date.getTime()) : null;
  } catch { return null; }
}

export function planAutoArchive(tasks: readonly AutoArchiveTask[], projectId: string, days: number | null, asOf: Date) {
  const result = { candidates: [] as { task: AutoArchiveTask; completedAt: Date; elapsedDays: number }[], waitingCount: 0, missingDateCount: 0, protectedCount: 0, restoredCount: 0 };
  if (!validArchiveDays(days) || !Number.isFinite(asOf.getTime())) return result;
  const active = tasks.filter(task => task.projectId === projectId && !task.isArchived && !task.isAbandoned);
  const needed = new Map<string, Set<string>>();
  for (const task of active) {
    if (task.dependsOnTaskIds !== undefined && (!Array.isArray(task.dependsOnTaskIds) || task.dependsOnTaskIds.some(id => typeof id !== 'string'))
      || task.parentTaskId != null && typeof task.parentTaskId !== 'string'
      || task.completionPolicy != null && (!Array.isArray(task.completionPolicy.required) || task.completionPolicy.required.some(row => !row || typeof row.taskId !== 'string'))) {
      throw new Error('タスクの親子・前提条件を確認できません。');
    }
    needed.set(task.id, new Set([...(task.dependsOnTaskIds ?? []), ...(task.parentTaskId ? [task.parentTaskId] : []), ...(task.completionPolicy?.required?.map(row => row.taskId) ?? [])]));
    if (task.isCompleted !== true) continue;
    const completedAt = archiveDate(task.completedAt);
    if (!completedAt) { result.missingDateCount++; continue; }
    if (archiveDate(task.autoArchiveCompletedAt)?.getTime() === completedAt.getTime()) { result.restoredCount++; continue; }
    const elapsed = asOf.getTime() - completedAt.getTime();
    if (elapsed < days * ARCHIVE_DAY_MS) { result.waitingCount++; continue; }
    result.candidates.push({ task, completedAt, elapsedDays: Math.floor(elapsed / ARCHIVE_DAY_MS) });
  }
  // A retained parent needs its children, and a retained child needs its parent.
  for (const task of active) if (task.parentTaskId) needed.get(task.parentTaskId)?.add(task.id);
  const eligible = new Set(result.candidates.map(item => item.task.id));
  let changed: boolean;
  do {
    changed = false;
    for (const task of active) if (!eligible.has(task.id)) {
      for (const requiredId of needed.get(task.id) ?? []) if (eligible.delete(requiredId)) changed = true;
    }
  } while (changed);
  result.protectedCount = result.candidates.length - eligible.size;
  result.candidates = result.candidates.filter(item => eligible.has(item.task.id))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.task.id.localeCompare(b.task.id));
  return result;
}
