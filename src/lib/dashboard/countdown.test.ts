import { describe, expect, it } from 'vitest';
import { countdownDay, describeCountdown, isCountdownTarget, type CountdownTask } from './countdown';

const task: CountdownTask = { title: '展示会', projectName: 'イベント', dueDate: '2026-09-05T00:00:00+09:00', isCompleted: false, isAbandoned: false };
describe('countdown', () => {
  it('counts Japanese calendar days, including midnight and overdue dates', () => {
    expect(countdownDay(new Date('2026-09-03T15:00:00Z'))).toBe('2026-09-04');
    expect(describeCountdown(task, new Date('2026-09-03T23:59:59+09:00')).label).toBe('あと2日');
    expect(describeCountdown(task, new Date('2026-09-04T00:00:00+09:00')).label).toBe('あと1日');
    expect(describeCountdown(task, new Date('2026-09-05T23:59:59+09:00')).label).toBe('今日が期限');
    expect(describeCountdown(task, new Date('2026-09-06T00:00:00+09:00'))).toEqual({ label: '期限超過 1日', tone: 'red' });
  });
  it('handles year boundaries, completion, cancellation and missing or invalid deadlines', () => {
    expect(describeCountdown({ ...task, dueDate: '2027-01-01T00:00:00+09:00' }, new Date('2026-12-31T12:00:00+09:00')).label).toBe('あと1日');
    expect(describeCountdown({ ...task, isCompleted: true }).label).toBe('完了');
    expect(describeCountdown({ ...task, isAbandoned: true }).label).toBe('中止');
    expect(describeCountdown({ ...task, dueDate: null }).label).toBe('期限未設定');
    expect(describeCountdown({ ...task, dueDate: 'invalid' }).label).toBe('期限未設定');
  });
  it('validates exactly a pair of document IDs', () => {
    expect(isCountdownTarget({ projectId: 'p1', taskId: 't1' })).toBe(true);
    for (const value of [null, [], {}, { projectId: 'p1' }, { projectId: 'p1', taskId: '../x' }, { projectId: 'p1', taskId: '..' }, { projectId: '', taskId: 't' }, { projectId: 'p', taskId: 't', dueDate: '2026' }]) expect(isCountdownTarget(value)).toBe(false);
  });
});
