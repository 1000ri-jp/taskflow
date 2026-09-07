import { describe, expect, it } from 'vitest';
import type { DashboardTask } from './brief';
import { recommendMonthlyTargets } from './target-recommendations';

const now = new Date(2026, 8, 3, 12);
const makeTask = (id: string, changes: Partial<DashboardTask> = {}): DashboardTask => ({
  id, title: id, projectId: 'p', projectName: 'プロジェクト', dueDate: null, startDate: null, priority: null,
  isCompleted: false, isAbandoned: false, isArchived: false, dependsOnTaskIds: [], ...changes,
} as DashboardTask);
describe('recommendMonthlyTargets', () => {
  it('returns at most three current project tasks, without changing input data', () => {
    const tasks = ['d', 'b', 'a', 'c'].map((id) => makeTask(id));
    const before = structuredClone(tasks);
    const result = recommendMonthlyTargets(tasks, 'p', now);
    expect(result.map(({ task }) => task.id)).toEqual(['a', 'b', 'c']);
    expect(tasks).toEqual(before);
    expect(result[0].reason).toBe('未完了タスクから候補を抽出');
  });
  it('excludes completed, abandoned, archived, other-project and next-month-start tasks', () => {
    const tasks = [makeTask('active'), makeTask('done', { isCompleted: true }), makeTask('abandoned', { isAbandoned: true }), makeTask('archived', { isArchived: true }), makeTask('foreign', { projectId: 'other' }), makeTask('next-month', { startDate: new Date(2026, 9, 1) })];
    expect(recommendMonthlyTargets(tasks, 'p', now).map(({ task }) => task.id)).toEqual(['active']);
    expect(recommendMonthlyTargets(tasks, 'unknown', now)).toEqual([]);
  });
  it('prioritizes today, near deadlines and overdue work, and provides factual reasons', () => {
    const tasks = [makeTask('later', { dueDate: new Date(2026, 9, 5) }), makeTask('monthly', { dueDate: new Date(2026, 8, 20) }), makeTask('overdue', { dueDate: new Date(2026, 7, 31) }), makeTask('soon', { dueDate: new Date(2026, 8, 5) }), makeTask('today', { dueDate: new Date(2026, 8, 3, 23) })];
    const result = recommendMonthlyTargets(tasks, 'p', now);
    expect(result.map(({ task }) => task.id)).toEqual(['today', 'soon', 'overdue']);
    expect(result.map(({ reason }) => reason)).toEqual(['本日期限', '2日後が期限', '期限を3日超過']);
  });
  it('considers priority and start dates without claiming work has actually started', () => {
    const tasks = [makeTask('normal'), makeTask('high', { priority: 'high' }), makeTask('started', { startDate: new Date(2026, 8, 1) }), makeTask('future', { startDate: new Date(2026, 8, 20) })];
    const result = recommendMonthlyTargets(tasks, 'p', now);
    expect(result.map(({ task }) => task.id)).toEqual(['high', 'started', 'normal']);
    expect(result[0].reason).toBe('優先度が高い');
    expect(result[1].reason).toBe('開始日を迎えています');
  });
  it('prefers prerequisites over blocked work, and never resolves a dependency from another project', () => {
    const tasks = [makeTask('prerequisite'), makeTask('blocked', { dependsOnTaskIds: ['prerequisite'], dueDate: new Date(2026, 8, 3) }), makeTask('missing', { dependsOnTaskIds: ['secret'] }), makeTask('secret', { projectId: 'foreign', isCompleted: true })];
    const result = recommendMonthlyTargets(tasks, 'p', now);
    expect(result[0].task.id).toBe('prerequisite');
    expect(result[0].reason).toBe('1件の前提タスク');
    expect(result.find(({ task }) => task.id === 'missing')?.isBlocked).toBe(true);
    expect(result.find(({ task }) => task.id === 'blocked')?.reason).toContain('前提タスクの完了待ち');
    tasks[0] = { ...tasks[0], isCompleted: true };
    expect(recommendMonthlyTargets(tasks, 'p', now)[0]).toMatchObject({ task: { id: 'blocked' }, isBlocked: false });
  });
  it('does not let an old blocked task displace ready work and treats abandoned dependencies as unresolved', () => {
    const tasks = [makeTask('blocked', { priority: 'high', dueDate: new Date(2026, 0, 1), dependsOnTaskIds: ['cancelled'] }), makeTask('cancelled', { isCompleted: true, isAbandoned: true }), ...['a', 'b', 'c'].map((id) => makeTask(id))];
    expect(recommendMonthlyTargets(tasks, 'p', now).map(({ task }) => task.id)).toEqual(['a', 'b', 'c']);
  });
  it('handles undated and invalid dates without fabricating dates or tasks to fill slots', () => {
    const result = recommendMonthlyTargets([makeTask('invalid', { dueDate: new Date('bad'), startDate: new Date('bad') })], 'p', now);
    expect(result).toHaveLength(1);
    expect(result[0].reason).not.toContain('NaN');
    expect(recommendMonthlyTargets([], 'p', now)).toEqual([]);
  });
  it('uses the current month across year boundaries', () => {
    const task = makeTask('january', { startDate: new Date(2027, 0, 1), dueDate: new Date(2027, 0, 15) });
    expect(recommendMonthlyTargets([task], 'p', new Date(2026, 11, 31))).toEqual([]);
    expect(recommendMonthlyTargets([task], 'p', new Date(2027, 0, 1))).toHaveLength(1);
  });
});
