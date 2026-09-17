import type { Task } from '@/types';

export const RECURRENCE_UNITS = { day: '日', week: '週', month: 'か月', year: '年' } as const;
export interface TaskRecurrence {
  seriesId: string;
  occurrence: number;
  unit: keyof typeof RECURRENCE_UNITS;
  interval: number;
  anchorDate: string;
  endDate: string | null;
  listId: string;
}
export type RecurrenceSettings = Omit<TaskRecurrence, 'occurrence'>;
export const civilDate = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() as Date : null;
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(date) : null;
};
export const validCivilDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' && date <= '9998-12-31' && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function validRecurrence(value: unknown): value is TaskRecurrence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rule = value as TaskRecurrence;
  return validId(rule.seriesId) && validId(rule.listId) && Object.hasOwn(RECURRENCE_UNITS, rule.unit)
    && Number.isInteger(rule.interval) && rule.interval >= 1 && rule.interval <= 365
    && Number.isInteger(rule.occurrence) && rule.occurrence >= 0 && rule.occurrence < 100000
    && validCivilDate(rule.anchorDate) && (rule.endDate === null || validCivilDate(rule.endDate) && rule.endDate >= rule.anchorDate);
}
/** Civil dates in Japan, retaining the original day through short months/leap years. */
export function occurrenceDate(rule: TaskRecurrence, occurrence: number): string {
  const [year, month, day] = rule.anchorDate.split('-').map(Number);
  const step = rule.interval * occurrence;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (rule.unit === 'day' || rule.unit === 'week') date.setUTCDate(day + step * (rule.unit === 'week' ? 7 : 1));
  else {
    const months = month - 1 + step * (rule.unit === 'year' ? 12 : 1);
    const y = year + Math.floor(months / 12), m = months % 12;
    date.setUTCFullYear(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
  }
  if (date.getUTCFullYear() > 9998) throw new Error('繰り返しの日付が範囲を超えています。');
  return date.toISOString().slice(0,10);
}
export function nextRecurrence(rule: TaskRecurrence) {
  if (!validRecurrence(rule)) throw new Error('繰り返し設定を確認してください。');
  const dueDate = occurrenceDate(rule, rule.occurrence + 1);
  return rule.endDate && dueDate > rule.endDate ? null : { id: `repeat-${rule.seriesId}-${rule.occurrence + 1}`, dueDate };
}
export function repeatTask(source: Task, now: Date): { id: string; task: Omit<Task,'id'>; shiftDays: number } | null {
  const rule = source.recurrence;
  if (!rule || source.taskKind === 'review_request' || source.isArchived || source.isAbandoned) return null;
  const next = nextRecurrence(rule); if (!next) return null;
  const sourceDate = civilDate(source.dueDate) ?? occurrenceDate(rule, rule.occurrence);
  const shiftDays = Math.round((Date.parse(next.dueDate) - Date.parse(sourceDate)) / 86400000);
  const start = civilDate(source.startDate);
  const shiftedStart = start ? shiftCivilDate(start, shiftDays) : null;
  const task: Omit<Task,'id'> = {
    projectId: source.projectId, listId: rule.listId, title: source.title, description: source.description ?? '', order: source.order ?? 0,
    assigneeIds: source.assigneeIds ?? [], labelIds: source.labelIds ?? [], tagIds: source.tagIds ?? [], priority: source.priority ?? null,
    startDate: shiftedStart ? new Date(`${shiftedStart}T00:00:00+09:00`) : null, dueDate: new Date(`${next.dueDate}T00:00:00+09:00`),
    durationDays: source.durationDays ?? null, isDueDateFixed: source.isDueDateFixed ?? true,
    dependsOnTaskIds: [], workProgress:'not_started', isCompleted:false, completedAt:null, isArchived:false, archivedAt:null, archivedBy:null, isAbandoned:false,
    createdBy:source.createdBy, createdAt:now, updatedAt:now, recurrence: { ...rule, occurrence:rule.occurrence + 1 },
    ...(source.parentTaskId ? { parentTaskId:source.parentTaskId } : {}),
    ...(source.completionCriteria ? { completionCriteria:source.completionCriteria } : {}),
    ...(source.primaryAssigneeId ? { primaryAssigneeId:source.primaryAssigneeId } : {}),
  };
  return { id:next.id, task, shiftDays };
}
export function shiftCivilDate(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0,10); }
export function repeatChecklist(data: Record<string, unknown>, taskId: string, days: number, now: Date) {
  return { taskId, title: typeof data.title === 'string' ? data.title : 'チェックリスト', order: typeof data.order === 'number' ? data.order : 0, createdAt: now,
    items: Array.isArray(data.items) ? data.items.map(item => ({ ...item, isChecked:false, ...(validCivilDate(item.dueDate) ? { dueDate:shiftCivilDate(item.dueDate, days) } : {}) })) : [] };
}
