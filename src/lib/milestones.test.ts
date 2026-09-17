import { milestonePresentation } from './milestones';
import { describe, expect, it } from 'vitest';
import type { Milestone, Task } from '@/types';
import { calculateMilestoneProgress, calculateMilestoneProgressList } from './milestones';

const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({ id: 'm1', projectId: 'p1', title: '公開', description: '', status: 'in_progress', dueDate: new Date(2026, 8, 10), order: 0, achievedAt: null, createdBy: 'u1', createdAt: new Date(2026, 7, 1), updatedAt: new Date(2026, 7, 1), ...overrides });
const task = (overrides: Partial<Task> = {}): Task => ({ id: 't1', projectId: 'p1', listId: 'l1', title: '準備', description: '', order: 0, assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'u1', createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1), ...overrides });

describe('milestone progress', () => {
  it('counts only linked non-archived tasks and supports fixed now', () => {
    const result = calculateMilestoneProgress(milestone(), [task({ milestoneId: 'm1', isCompleted: true }), task({ id: 't2', milestoneId: 'm1' }), task({ id: 't3', milestoneId: 'm1', isArchived: true }), task({ id: 't4' })], new Date(2026, 8, 3, 12));
    expect(result).toMatchObject({ linkedTaskCount: 2, completedTaskCount: 1, progressPercent: 50, isConfigured: true, dueState: 'due_soon', daysUntilDue: 7 });
  });
  it('distinguishes unset, overdue, and on-track deadlines', () => {
    expect(calculateMilestoneProgress(milestone({ dueDate: null }), [], new Date(2026, 8, 3)).dueState).toBe('unset');
    expect(calculateMilestoneProgress(milestone({ dueDate: new Date(2026, 8, 2) }), [], new Date(2026, 8, 3)).dueState).toBe('overdue');
    expect(calculateMilestoneProgress(milestone({ dueDate: new Date(2026, 8, 20) }), [], new Date(2026, 8, 3)).dueState).toBe('on_track');
  });
  it('marks a milestone with no linked tasks as unconfigured and maps lists', () => {
    const result = calculateMilestoneProgressList([milestone(), milestone({ id: 'm2', dueDate: null })], [], new Date(2026, 8, 3));
    expect(result.map((item) => [item.milestoneId, item.isConfigured])).toEqual([['m1', false], ['m2', false]]);
  });
});


describe('date and achievement milestones', () => {
  const date = new Date('2026-09-23');
  const m = { id:'event', projectId:'p', kind:'date', dueDate:date, status:'planned' } as Milestone;
  it('never treats arrival or elapsed dates as preparation achieved', () => {
    expect(milestonePresentation(m, [], date)).toMatchObject({ label:'当日', achieved:false });
    expect(milestonePresentation({...m,status:'achieved'}, [], new Date('2026-09-24'))).toMatchObject({ label:'日付経過', achieved:false });
  });
  it('requires every named task and a condition, distinguishing unavailable conditions', () => {
    const achievement = {...m,kind:'achievement' as const,achievementCondition:'入稿',requiredTaskIds:['print']};
    expect(milestonePresentation(achievement, [])).toMatchObject({unknown:true,achieved:false});
    const task={id:'print',projectId:'p',isCompleted:true} as Task;
    expect(milestonePresentation(achievement,[task])).toMatchObject({achieved:true});
    expect(milestonePresentation(achievement,[{...task,isAbandoned:true}])).toMatchObject({achieved:false});
    expect(milestonePresentation(achievement,[{...task,isArchived:true}])).toMatchObject({unknown:true,achieved:false});
    expect(milestonePresentation(achievement,[{...task,projectId:'q'}])).toMatchObject({unknown:true,achieved:false});
    expect(milestonePresentation({...achievement,requiredTaskIds:[]},[])).toMatchObject({achieved:false});
    expect(milestonePresentation({...achievement,status:'cancelled'},[task])).toMatchObject({label:'中止',achieved:false});
  });
});
