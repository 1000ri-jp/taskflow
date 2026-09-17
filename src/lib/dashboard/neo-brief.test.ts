import { describe, expect, it } from 'vitest';
import { buildNeoBrief, neoDependencyEvidence } from './neo-brief';
import { viewTask } from '@/test/taskViewFixtures';
import type { DashboardTask } from './brief';
import type { Notification } from '@/types';

const now = new Date(2026, 8, 12, 9);
const task = (changes: Partial<DashboardTask> = {}): DashboardTask => ({ ...viewTask({ assigneeIds: ['me'] }), projectName: '展示会', ...changes });
const notice = (changes: Partial<Notification> = {}): Notification => ({ id: 'call', userId: 'me', type: 'task_bell', title: '確認してください', message: '購入状況を教えてください', projectId: 'project-1', taskId: 'task-1', senderId: 'other', isRead: false, createdAt: now, data: {}, ...changes });

describe('Neo morning brief', () => {
  it('keeps shared held work out of today without losing its deadline or review condition', () => {
    const held = task({ id: 'held', dueDate: now, workState: { status: 'hold', reason: '仕様の決定待ち', resumeCondition: '仕様が決まる', reviewAt: '2026-09-01' } });
    const result = buildNeoBrief([held], [], 'me', now);
    expect(result.deadlines).toEqual([]);
    expect(result.workPeriod).toEqual([]);
    expect(result.paused).toEqual([held]);
    expect(result.paused[0].dueDate).toEqual(now);
  });
  it('splits overdue, due-today, and active-period work while excluding future starts and completed items without changing task data', () => {
    const work = [
      task({ id: 'review', taskKind: 'review_request', createdBy: 'other', dueDate: now }),
      task({ id: 'overdue', dueDate: new Date(2026, 8, 10), priority: 'high' }),
      task({ id: 'due-today', dueDate: new Date(2026, 8, 12, 23, 59), priority: 'medium' }),
      task({ id: 'started', dueDate: new Date(2026, 8, 14), startDate: new Date(2026, 8, 11), workProgress: 'started' }),
      task({ id: 'not-started', dueDate: new Date(2026, 8, 15), startDate: new Date(2026, 8, 12), workProgress: 'not_started' }),
      task({ id: 'future-start-overdue', dueDate: new Date(2026, 8, 11), startDate: new Date(2026, 8, 13) }),
      task({ id: 'future-start', dueDate: new Date(2026, 8, 15), startDate: new Date(2026, 8, 13) }),
      task({ id: 'completed', dueDate: now, isCompleted: true }),
    ];
    const before = structuredClone(work);
    const data = buildNeoBrief(work, [], 'me', now);
    expect(data.reviews.map(task => task.id)).toEqual(['review']);
    expect(data.deadlines.map(task => task.id)).toEqual(['overdue', 'due-today']);
    expect(data.workPeriod.map(task => task.id)).toEqual(['started', 'not-started']);
    expect(data.waiting).toEqual([]);
    expect(work).toEqual(before);
  });
  it('sorts deadline buckets overdue then today and sorts each group by priority before nearest due date', () => {
    const items = [
      task({ id: 'today-medium', dueDate: new Date(2026, 8, 12, 20), priority: 'medium' }),
      task({ id: 'overdue-low', dueDate: new Date(2026, 8, 11), priority: 'low' }),
      task({ id: 'overdue-near-high', dueDate: new Date(2026, 8, 11), priority: 'high' }),
      task({ id: 'overdue-far-high', dueDate: new Date(2026, 8, 9), priority: 'high' }),
      task({ id: 'today-high', dueDate: new Date(2026, 8, 12, 10), priority: 'high' }),
      task({ id: 'overdue-medium', dueDate: new Date(2026, 8, 10), priority: 'medium' }),
    ];
    expect(buildNeoBrief(items, [], 'me', now).deadlines.map(item => item.id)).toEqual([
      'overdue-near-high', 'overdue-far-high', 'overdue-medium', 'overdue-low', 'today-high', 'today-medium',
    ]);
  });
  it('sorts work-period tasks by priority and then nearest deadline', () => {
    const items = [
      task({ id: 'medium', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 14), priority: 'medium' }),
      task({ id: 'high-far', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 16), priority: 'high' }),
      task({ id: 'high-near', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 13), priority: 'high' }),
      task({ id: 'low', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 13), priority: 'low' }),
    ];
    expect(buildNeoBrief(items, [], 'me', now).workPeriod.map(item => item.id)).toEqual(['high-near', 'high-far', 'medium', 'low']);
  });
  it('expands ordinary work to everyone without expanding personal review requests or notifications', () => {
    const tasks = [task({ id: 'mine', dueDate: now }), task({ id: 'team', assigneeIds: ['other'], dueDate: now }),
      task({ id: 'unassigned', assigneeIds: [], dueDate: now }),
      task({ id: 'my-review', taskKind: 'review_request', createdBy: 'me', dueDate: now }),
      task({ id: 'their-review', taskKind: 'review_request', assigneeIds: ['other'], dueDate: now }),
      task({ id: 'their-wait', assigneeIds: ['other'], dueDate: new Date(2026, 8, 13), dependsOnTaskIds: ['missing'] })];
    const before = structuredClone(tasks);
    expect(buildNeoBrief(tasks, [], 'me', now).deadlines.map(task => task.id)).toEqual(['mine']);
    const all = buildNeoBrief(tasks, [notice({ userId: 'other', taskId: 'team' })], 'me', now, 'all');
    expect(all.deadlines.map(task => task.id)).toEqual(['mine', 'team', 'unassigned']);
    expect(all.waiting.map(task => task.id)).toEqual(['their-wait']);
    expect(all.reviews.map(task => task.id)).toEqual(['my-review']);
    expect(all.calls).toEqual([]); expect(all.taskCalls).toEqual([]);
    expect(buildNeoBrief(tasks, [], null, now, 'all').deadlines).toEqual([]);
    expect(tasks).toEqual(before);
  });
  it('filters the briefing to one named assignee or everyone without changing the default self scope', () => {
    const tasks = [task({ id: 'mine', dueDate: now }), task({ id: 'team', assigneeIds: ['colleague'], dueDate: now }), task({ id: 'shared', assigneeIds: ['me', 'colleague'], dueDate: now })];
    expect(buildNeoBrief(tasks, [], 'me', now).deadlines.map(item => item.id)).toEqual(['mine', 'shared']);
    expect(buildNeoBrief(tasks, [], 'me', now, 'mine', 'colleague').deadlines.map(item => item.id)).toEqual(['team', 'shared']);
    expect(buildNeoBrief(tasks, [], 'me', now, 'mine', null).deadlines.map(item => item.id)).toEqual(['mine', 'team', 'shared']);
  });
  it('does not interpret inactivity, ordinary unread comments or mentions as an obligation', () => {
    const data = buildNeoBrief([task()], [notice({ type: 'comment_added' }), notice({ id: 'mention', type: 'mentioned' })], 'me', now);
    expect(data.deadlines).toEqual([]); expect(data.workPeriod).toEqual([]); expect(data.waiting).toEqual([]); expect(data.calls).toEqual([]);
  });
  it('distinguishes incomplete, cancelled and missing dependencies from completed ones', () => {
    const target = task({ id: 'waiting', dueDate: new Date(2026, 8, 13), dependsOnTaskIds: ['pending', 'cancelled', 'missing', 'done'] });
    const tasks = [target, task({ id: 'pending' }), task({ id: 'cancelled', isAbandoned: true }), task({ id: 'done', isCompleted: true })];
    expect(buildNeoBrief(tasks, [], 'me', now).waiting.map(task => task.id)).toEqual(['waiting']);
    expect(neoDependencyEvidence(target, tasks).map(item => item.state)).toEqual(['waiting', 'cancelled', 'unknown']);
    expect(neoDependencyEvidence(target, tasks.map(task => ({ ...task, isCompleted: true, isAbandoned: false }))).map(item => item.state)).toEqual(['unknown']);
  });
  it('keeps a near due blocked task in today only; a distant low-priority wait stays out', () => {
    const data = buildNeoBrief([task({ dueDate: now, dependsOnTaskIds: ['missing'] }), task({ id: 'later', dueDate: new Date(2026, 9, 1), dependsOnTaskIds: ['missing'] })], [], 'me', now);
    expect(data.deadlines).toHaveLength(1); expect(data.waiting).toEqual([]);
  });
  it('deduplicates direct calls and attaches them to already visible work', () => {
    const calls = [notice(), notice({ id: 'older', createdAt: new Date(2026, 8, 11) }), notice({ id: 'own', senderId: 'me' }), notice({ id: 'foreign', userId: 'someone' })];
    expect(buildNeoBrief([task()], calls, 'me', now).calls.map(call => call.id)).toEqual(['call']);
    const data = buildNeoBrief([task({ dueDate: now })], calls, 'me', now);
    expect(data.calls).toEqual([]); expect(data.taskCalls.map(call => call.id)).toEqual(['call']);
  });
  it('includes only own automation deadline notices and attaches them once to already displayed work', () => {
    const automated = notice({ id: 'auto', type: 'due_reminder', senderId: undefined, data: { automation: true, pending: [{ assigneeId: 'other', check: 'unavailable' }] }, message: '完了は未確認です。' });
    const notices = [automated, notice({ id: 'ordinary', type: 'due_reminder' }), { ...automated, id: 'someone', userId: 'someone' }];
    expect(buildNeoBrief([task()], notices, 'me', now).calls.map(call => call.id)).toEqual(['auto']);
    const due = buildNeoBrief([task({ dueDate: now })], notices, 'me', now);
    expect(due.calls).toEqual([]); expect(due.taskCalls.map(call => call.id)).toEqual(['auto']);
    const review = buildNeoBrief([task({ taskKind: 'review_request', createdBy: 'other' })], notices, 'me', now);
    expect(review.calls).toEqual([]); expect(review.taskCalls).toHaveLength(1);
    const completed = buildNeoBrief([task({ isCompleted: true })], notices, 'me', now);
    expect(completed.calls).toEqual([]); expect(completed.taskCalls).toEqual([]);
    expect(buildNeoBrief([], notices, 'me', now).calls).toEqual([]);
  });
  it('removes completed, cancelled and reassigned work immediately and scopes colliding IDs by project', () => {
    const tasks = [task({ dueDate: now, isCompleted: true }), task({ id: 'cancelled', dueDate: now, isAbandoned: true }), task({ id: 'reassigned', dueDate: now, assigneeIds: ['other'] }), task({ projectId: 'other-project', dueDate: now })];
    const data = buildNeoBrief(tasks, [notice()], 'me', now);
    expect(data.deadlines.map(task => task.projectId)).toEqual(['other-project']); expect(data.calls).toEqual([]);
    expect(buildNeoBrief(tasks, [notice()], null, now).deadlines).toEqual([]);
  });
});
