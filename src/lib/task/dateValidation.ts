/** Task date fields represent calendar days in TaskFlow's Japan timezone. */
type TaskDateValue = Date | string | { toDate(): Date } | null | undefined;
export interface TaskDateFields { startDate?: TaskDateValue; dueDate?: TaskDateValue }
export const TASK_DATE_ORDER_ERROR = '開始日は期限以前の日付にしてください。';
export class TaskDateValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskDateValidationError'; }
}
function calendarDay(value: TaskDateValue): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : value.toDate();
  if (!Number.isFinite(date.getTime())) throw new TaskDateValidationError('有効な日付を設定してください。');
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function taskDateError(fields: TaskDateFields): string | null {
  try {
    const start = calendarDay(fields.startDate), due = calendarDay(fields.dueDate);
    return start && due && start > due ? TASK_DATE_ORDER_ERROR : null;
  } catch (error) { return error instanceof Error ? error.message : '有効な日付を設定してください。'; }
}
export function assertTaskDates(fields: TaskDateFields): void {
  const error = taskDateError(fields);
  if (error) throw new TaskDateValidationError(error);
}
export function hasTaskDateChange(patch: object): boolean {
  return Object.entries(patch).some(([key, value]) => ['startDate', 'dueDate'].includes(key) && value !== undefined);
}
