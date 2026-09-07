import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { ARCHIVE_DAY_MS, previewAutoArchive, validArchiveDays } from './autoArchivePreview';

const now = new Date('2026-09-03T12:00:00Z');
const task = (id: string, age: number, extra: Partial<Task> = {}) => ({ id, projectId: 'p', isCompleted: true, isArchived: false, completedAt: new Date(now.getTime() - age * ARCHIVE_DAY_MS), ...extra }) as Task;
describe('auto archive preview', () => {
  it('uses completedAt with an inclusive 24-hour boundary, not dueDate or updatedAt', () => {
    const result = previewAutoArchive([task('exact', 7), task('early', 7 - 1 / ARCHIVE_DAY_MS), task('future', -1), task('old', 30, { updatedAt: now })], 'p', 7, now);
    expect(result.candidates.map(item => item.task.id)).toEqual(['old', 'exact']);
    expect(result.candidates[1].eligibleAt).toEqual(now);
    expect(result.waitingCount).toBe(2);
  });
  it('excludes incomplete, already archived, foreign-project and missing-date tasks', () => {
    const result = previewAutoArchive([task('incomplete', 30, { isCompleted: false }), task('archived', 30, { isArchived: true }), task('foreign', 30, { projectId: 'other' }), task('missing', 30, { completedAt: null }), task('invalid', 30, { completedAt: new Date('invalid') })], 'p', 7, now);
    expect(result.candidates).toEqual([]);
    expect(result.missingDateCount).toBe(2);
  });
  it('supports 30 days and custom days without mutating tasks', () => {
    const tasks = Object.freeze([Object.freeze(task('b', 30)), Object.freeze(task('a', 30)), Object.freeze(task('recent', 2))]);
    expect(previewAutoArchive(tasks, 'p', 30, now).candidates.map(item => item.task.id)).toEqual(['a', 'b']);
    expect(previewAutoArchive(tasks, 'p', 2, now).candidates).toHaveLength(3);
    expect(tasks.map(item => item.id)).toEqual(['b', 'a', 'recent']);
    expect(tasks.every(item => !item.isArchived)).toBe(true);
  });
  it('fails closed for invalid periods or reference dates', () => {
    for (const value of [0, -1, 1.5, 3651, NaN, Infinity, '7', null]) expect(validArchiveDays(value)).toBe(false);
    for (const value of [1, 7, 30, 3650]) expect(validArchiveDays(value)).toBe(true);
    expect(previewAutoArchive([task('old', 30)], 'p', 0, now).candidates).toEqual([]);
    expect(previewAutoArchive([task('old', 30)], 'p', 7, new Date('invalid')).candidates).toEqual([]);
  });
});
