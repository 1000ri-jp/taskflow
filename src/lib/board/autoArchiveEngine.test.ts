import { describe, expect, it } from 'vitest';
import { ARCHIVE_DAY_MS } from './autoArchivePreview';
import { archiveDate, planAutoArchive, type AutoArchiveTask } from './autoArchiveEngine';

const now = new Date('2026-09-13T03:00:00.000Z');
const completed = new Date(now.getTime() - 30 * ARCHIVE_DAY_MS);
const task = (id: string, extra: Partial<AutoArchiveTask> = {}): AutoArchiveTask => ({ id, projectId: 'p', title: id, isCompleted: true, completedAt: completed, ...extra });
const plan = (tasks: readonly AutoArchiveTask[], days = 30) => planAutoArchive(tasks, 'p', days, now);
const ids = (tasks: readonly AutoArchiveTask[]) => plan(tasks).candidates.map(item => item.task.id);

describe('safe auto archive plan', () => {
  it('uses the inclusive completion-time boundary, retaining future and just-too-recent completions', () => {
    const result = plan([task('exact'), task('early', { completedAt: new Date(completed.getTime() + 1) }), task('future', { completedAt: new Date(now.getTime() + 1) })]);
    expect(result.candidates.map(item => item.task.id)).toEqual(['exact']);
    expect(result.waitingCount).toBe(2);
    expect(result.candidates[0].elapsedDays).toBe(30);
  });
  it('separates missing dates and restored completions from incomplete, abandoned, archived and foreign tasks', () => {
    const result = plan([task('none', { completedAt: null }), task('invalid', { completedAt: 'invalid' }), task('restored', { autoArchiveCompletedAt: completed.toISOString() }), task('open', { isCompleted: false }), task('abandoned', { isAbandoned: true }), task('archived', { isArchived: true }), task('foreign', { projectId: 'other' })]);
    expect(result).toMatchObject({ candidates: [], missingDateCount: 2, restoredCount: 1, protectedCount: 0, waitingCount: 0 });
  });
  it('allows a new completion after restoration without reusing the old archive exemption', () => {
    expect(ids([task('again', { autoArchiveCompletedAt: new Date(completed.getTime() - 1) })])).toEqual(['again']);
  });
  it('archives a fully eligible family together but retains both sides of a family with an active task', () => {
    const parent = task('parent'); const child = task('child', { parentTaskId: 'parent' });
    expect(ids([parent, child])).toEqual(['child', 'parent']);
    expect(plan([parent, { ...child, isCompleted: false }]).protectedCount).toBe(1);
    expect(ids([{ ...parent, isCompleted: false }, child])).toEqual([]);
    expect(ids([parent, child, task('grandchild', { parentTaskId: 'child', isCompleted: false })])).toEqual([]);
  });
  it('propagates protection to dependencies and required children until the retained work is self-contained', () => {
    const tasks = [task('a', { dependsOnTaskIds: ['b'] }), task('b', { completionPolicy: { required: [{ taskId: 'c' }] } }), task('c'), task('open', { isCompleted: false, dependsOnTaskIds: ['a'] }), task('unrelated')];
    const result = plan(tasks);
    expect(result.candidates.map(item => item.task.id)).toEqual(['unrelated']);
    expect(result.protectedCount).toBe(3);
    expect(ids(tasks.filter(item => item.id !== 'open'))).toEqual(['a', 'b', 'c', 'unrelated']);
  });
  it('lets archived and abandoned references stop protecting work, but restored parents still protect children', () => {
    expect(ids([task('a'), task('old', { isArchived: true, dependsOnTaskIds: ['a'] }), task('cancelled', { isAbandoned: true, dependsOnTaskIds: ['a'] })])).toEqual(['a']);
    const result = plan([task('parent', { autoArchiveCompletedAt: completed }), task('child', { parentTaskId: 'parent' })]);
    expect(result).toMatchObject({ candidates: [], restoredCount: 1, protectedCount: 1 });
  });
  it('leaves source records unchanged and accepts persisted Date, timestamp, and ISO completion dates', () => {
    const tasks = Object.freeze([Object.freeze(task('b', { completedAt: { toDate: () => completed } })), Object.freeze(task('a', { completedAt: completed.toISOString() }))]);
    expect(ids(tasks)).toEqual(['a', 'b']);
    expect(tasks.map(item => item.id)).toEqual(['b', 'a']);
    expect(tasks.every(item => item.isArchived === undefined)).toBe(true);
    const date = archiveDate(completed)!; date.setFullYear(2000); expect(completed.getFullYear()).toBe(2026);
    expect(archiveDate({ toDate: () => { throw new Error(); } })).toBeNull();
  });
  it('does not invent relationships from corrupt persisted fields or execute an invalid period', () => {
    expect(() => plan([task('bad', { dependsOnTaskIds: 'wrong' as never })])).toThrow('親子・前提条件');
    expect(() => plan([task('bad', { completionPolicy: { required: [null as never] } })])).toThrow('親子・前提条件');
    for (const days of [null, 0, -1, 1.5, 3651]) expect(planAutoArchive([task('a')], 'p', days, now).candidates).toEqual([]);
    expect(planAutoArchive([task('a')], 'p', 30, new Date('invalid')).candidates).toEqual([]);
  });
});
