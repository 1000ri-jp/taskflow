import { updateTask } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { calculateEffectiveStartDate, recalculateDates } from '@/lib/utils/task';
import { assertTaskDates } from './dateValidation';
import { mutateOrganizationMock } from './organizationMock';
import { assertOrganizationGraphSafe } from './organizationEngine';
import type { Task } from '@/types';

export type MiniTaskSchedulePatch = Partial<Pick<Task, 'startDate' | 'dueDate' | 'durationDays' | 'isDueDateFixed'>>;

const JAPAN_TIME_ZONE = 'Asia/Tokyo';

function partsInJapan(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JAPAN_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

/** Change only the Japan calendar day and retain the existing time-of-day. */
export function replaceTaskCalendarDay(selected: Date, current: Date | null): Date {
  const selectedDay = new Intl.DateTimeFormat('sv-SE', { timeZone: JAPAN_TIME_ZONE }).format(selected);
  if (!current || !Number.isFinite(current.getTime())) return new Date(`${selectedDay}T00:00:00.000+09:00`);
  const parts = partsInJapan(current);
  return new Date(`${selectedDay}T${parts.hour}:${parts.minute}:${parts.second}.${String(current.getMilliseconds()).padStart(3, '0')}+09:00`);
}

function sameVersion(actual: unknown, expected: Date): boolean {
  const date = actual instanceof Date ? actual : typeof actual === 'string' ? new Date(actual) : null;
  return Boolean(date && Number.isFinite(date.getTime()) && date.toISOString() === expected.toISOString());
}

function recordMockEdit(state: { activityLogs: Record<string, unknown>[] }, projectId: string, task: Task, patch: MiniTaskSchedulePatch, now: Date) {
  state.activityLogs.push({
    id: crypto.randomUUID(), projectId, targetType: 'task', targetId: task.id, targetName: task.title,
    action: 'update', userId: 'e2e-mock-user', userName: '隔離環境の本人', createdAt: now,
    changes: Object.entries(patch).map(([field, value]) => ({ field, oldValue: String(task[field as keyof Task] ?? ''), newValue: String(value ?? '') })),
  });
}

function cascadeMockDates(projectId: string, changedTaskId: string, taskMap: Record<string, Task>, activityLogs: Record<string, unknown>[], now: Date) {
  const changed = taskMap[changedTaskId];
  if (!changed) return;
  const dependents = Object.values(taskMap).filter(task => task.dependsOnTaskIds?.includes(changedTaskId));
  for (const dependent of dependents) {
    const effectiveStart = calculateEffectiveStartDate(dependent, Object.values(taskMap));
    if (!effectiveStart) continue;
    const result = recalculateDates(dependent, { startDate: effectiveStart });
    const patch: MiniTaskSchedulePatch = {};
    if (dependent.startDate?.getTime() !== effectiveStart.getTime()) patch.startDate = effectiveStart;
    if (dependent.dueDate?.getTime() !== result.dueDate?.getTime()) patch.dueDate = result.dueDate;
    if (result.durationDays !== dependent.durationDays) patch.durationDays = result.durationDays;
    if (!Object.keys(patch).length) continue;
    const updated = { ...dependent, ...patch, updatedAt: now };
    assertTaskDates(updated);
    taskMap[dependent.id] = updated;
    recordMockEdit({ activityLogs }, projectId, dependent, patch, now);
    cascadeMockDates(projectId, dependent.id, taskMap, activityLogs, now);
  }
}

async function updateMockTaskSchedule(projectId: string, task: Task, patch: MiniTaskSchedulePatch) {
  await mutateOrganizationMock(projectId, state => {
    const stored = state.data.tasks[task.id] as unknown as Task | undefined;
    if (!stored) throw new Error('タスクが見つかりません。開き直してください。');
    if (!sameVersion(stored.updatedAt, task.updatedAt)) throw new Error('仕事の情報が変わりました。最新の内容を確認してください。');
    const now = new Date();
    const taskMap = Object.fromEntries(Object.entries(state.data.tasks).map(([id, value]) => [id, { ...value, id, projectId } as unknown as Task]));
    const updated = { ...stored, ...patch, updatedAt: now } as unknown as Task;
    assertTaskDates(updated);
    assertOrganizationGraphSafe(Object.fromEntries(Object.keys(taskMap).map(id => [id, id === task.id ? { ...state.data.tasks[id], ...patch, updatedAt: now } : state.data.tasks[id]])));
    state.data.tasks[task.id] = { ...state.data.tasks[task.id], ...patch, updatedAt: now };
    recordMockEdit(state, projectId, task, patch, now);
    taskMap[task.id] = updated;
    cascadeMockDates(projectId, task.id, taskMap, state.activityLogs, now);
    for (const [id, value] of Object.entries(taskMap)) {
      if (id !== task.id && value.updatedAt.getTime() === now.getTime()) {
        const withoutIdentity = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && key !== 'projectId'));
        state.data.tasks[id] = { ...state.data.tasks[id], ...withoutIdentity } as never;
      }
    }
  });
}

async function cascadeServerDates(projectId: string, changedTaskId: string, allTasks: readonly Task[]) {
  const visit = async (parentId: string, currentTasks: Task[]): Promise<void> => {
    const dependents = currentTasks.filter(task => task.dependsOnTaskIds?.includes(parentId));
    for (const dependent of dependents) {
      const effectiveStart = calculateEffectiveStartDate(dependent, currentTasks);
      if (!effectiveStart) continue;
      const result = recalculateDates(dependent, { startDate: effectiveStart });
      const patch: MiniTaskSchedulePatch = {};
      if (dependent.startDate?.getTime() !== effectiveStart.getTime()) patch.startDate = effectiveStart;
      if (dependent.dueDate?.getTime() !== result.dueDate?.getTime()) patch.dueDate = result.dueDate;
      if (result.durationDays !== dependent.durationDays) patch.durationDays = result.durationDays;
      if (!Object.keys(patch).length) continue;
      await updateTask(projectId, dependent.id, patch, dependent.updatedAt);
      const next = currentTasks.map(item => item.id === dependent.id ? { ...item, ...patch, updatedAt: new Date() } : item);
      await visit(dependent.id, next);
    }
  };
  await visit(changedTaskId, [...allTasks]);
}

/**
 * The Mini uses the same Firestore transaction and the same isolated workbench
 * as the board. It does not own another task store or another permission model.
 */
export async function updateMiniTaskSchedule({ projectId, task, allTasks, patch }: { projectId: string; task: Task; allTasks: readonly Task[]; patch: MiniTaskSchedulePatch }) {
  if (isE2EMockAuthEnabled()) return updateMockTaskSchedule(projectId, task, patch);
  await updateTask(projectId, task.id, patch, task.updatedAt);
  await cascadeServerDates(projectId, task.id, allTasks);
}
