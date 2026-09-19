import { describe, expect, it } from 'vitest';
import { assertTaskDates, hasTaskDateChange, TASK_DATE_ORDER_ERROR } from './dateValidation';
describe('task date validation', () => {
  it('rejects inverted dates but allows the same calendar day regardless of timestamp time', () => {
    expect(() => assertTaskDates({ startDate: '2026-09-20', dueDate: '2026-09-16' })).toThrow(TASK_DATE_ORDER_ERROR);
    expect(() => assertTaskDates({ startDate: new Date('2026-09-16T23:00:00+09:00'), dueDate: '2026-09-16T00:00:00+09:00' })).not.toThrow();
    expect(() => assertTaskDates({ startDate: { toDate: () => new Date('2026-09-16T15:00:00Z') }, dueDate: '2026-09-16T14:59:59Z' })).toThrow(TASK_DATE_ORDER_ERROR);
  });
  it('allows clearing either date, rejects invalid values, and checks only actual date changes', () => {
    expect(() => assertTaskDates({ startDate: null, dueDate: '2026-09-16' })).not.toThrow();
    expect(() => assertTaskDates({ startDate: '2026-09-20', dueDate: null })).not.toThrow();
    expect(() => assertTaskDates({ startDate: new Date('invalid') })).toThrow('有効な日付');
    expect(hasTaskDateChange({ title: '編集', startDate: undefined })).toBe(false);
    expect(hasTaskDateChange({ dueDate: null })).toBe(true);
  });
});
