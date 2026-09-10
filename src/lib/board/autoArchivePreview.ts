import type { Task } from '@/types';

export const ARCHIVE_DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_ARCHIVE_DAYS = 30;
export const validArchiveDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650;

// Read-only snapshot: never changes completion, order, or archive fields.
export function previewAutoArchive(tasks: readonly Task[], projectId: string, days: number, asOf: Date) {
  if (!validArchiveDays(days) || !Number.isFinite(asOf.getTime())) {
    return { candidates: [], waitingCount: 0, missingDateCount: 0 };
  }
  const candidates: { task: Task; completedAt: Date; eligibleAt: Date; elapsedDays: number }[] = [];
  let waitingCount = 0;
  let missingDateCount = 0;
  for (const task of tasks) {
    if (task.projectId !== projectId || !task.isCompleted || task.isArchived) continue;
    const completed = task.completedAt?.getTime();
    if (completed === undefined || !Number.isFinite(completed)) {
      missingDateCount++;
      continue;
    }
    const eligibleAt = new Date(completed + days * ARCHIVE_DAY_MS);
    if (eligibleAt.getTime() > asOf.getTime()) { waitingCount++; continue; }
    candidates.push({ task, completedAt: new Date(completed), eligibleAt, elapsedDays: Math.floor((asOf.getTime() - completed) / ARCHIVE_DAY_MS) });
  }
  candidates.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.task.id.localeCompare(b.task.id));
  return { candidates, waitingCount, missingDateCount };
}
