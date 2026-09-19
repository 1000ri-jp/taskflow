import { describe, expect, it } from 'vitest';
import type { DashboardTask } from './brief';
import type { Notification } from '@/types';
import { reviewRequestContent, reviewRequester, reviewRequesterName, selectNeoReviewRequests } from './review-requests';

const task = (id: string, changes: Partial<DashboardTask> = {}) => ({ id, projectId: 'p', projectName: '準備', title: `確認依頼${id}`,
  taskKind: 'review_request', createdBy: 'requester', assigneeIds: ['me'], isCompleted: false, isArchived: false, isAbandoned: false,
  dueDate: null, createdAt: new Date(2026, 8, 1), ...changes } as DashboardTask);
const notification = (changes: Partial<Notification> = {}) => ({ id: 'n', userId: 'me', projectId: 'p', taskId: 'a', type: 'review_requested',
  senderId: 'requester', senderName: '田中', isRead: false, ...changes } as Notification);

describe('Neo review request selection', () => {
  it('uses request text, falls back for older tasks, and abbreviates long requests without assigning a category', () => {
    expect(reviewRequestContent(task('a', { description: ' 購入内容を確認してください\n まだ申込は不要です。 ' }))).toBe('購入内容を確認してください まだ申込は不要です。');
    expect(reviewRequestContent(task('a', { title: '確認依頼： 当日持ちものリスト', description: ' ' }))).toBe('当日持ちものリスト');
    expect(reviewRequestContent(task('a', { title: '購入依頼：備品', description: '' }))).toBe('購入依頼：備品');
    expect(reviewRequestContent(task('a', { description: 'あ'.repeat(121) }))).toBe(`${'あ'.repeat(120)}…`);
    expect(reviewRequestContent(task('a', { description: `${'あ'.repeat(119)}😀続き` }))).toBe(`${'あ'.repeat(119)}😀…`);
    expect(reviewRequestContent(task('a', { title: '確認依頼：', description: '' }))).toBe('依頼内容を確認');
  });
  it('selects unresolved assigned review tasks independently of who registered them', () => {
    const tasks = [task('a'), task('memo', { taskKind: undefined }), task('self', { createdBy: 'me' }),
      task('other', { assigneeIds: ['other'] }), task('done', { isCompleted: true }), task('abandoned', { isAbandoned: true }),
      task('archived', { isArchived: true }), task('unknown', { createdBy: '' })];
    expect(selectNeoReviewRequests(tasks, 'me').map(task => task.id)).toEqual(['a', 'self', 'unknown']);
    expect(selectNeoReviewRequests(tasks, null)).toEqual([]);
    expect(selectNeoReviewRequests(tasks, 'other').map(task => task.id)).toEqual(['other']);
  });
  it('sorts deadlines first, deduplicates by project and task, and never mutates the source', () => {
    const tasks = Object.freeze([task('none'), task('later', { dueDate: new Date(2026, 8, 20) }),
      task('early', { dueDate: new Date(2026, 8, 2) }), task('invalid', { dueDate: new Date('invalid'), createdAt: new Date(2026, 8, 3) }),
      task('none', { projectId: 'other-project' }), task('early', { dueDate: new Date(2026, 8, 2) })]);
    const before = tasks.slice();
    expect(selectNeoReviewRequests(tasks, 'me').map(task => `${task.projectId}/${task.id}`)).toEqual(['p/early', 'p/later', 'p/invalid', 'other-project/none', 'p/none']);
    expect(tasks).toEqual(before);
  });
  it('uses the matching sender rather than the registrant, and keeps unknown identities neutral', () => {
    const selfRegistered = task('a', { createdBy: 'me' });
    expect(reviewRequester(selfRegistered, 'me', [notification({ senderId: 'external' })])).toEqual({ id: 'external', name: '田中', isSelf: false });
    expect(reviewRequester(selfRegistered, 'me', [])).toEqual({ name: null, isSelf: true });
    expect(reviewRequester(selfRegistered, 'me', [notification({ senderId: undefined, senderName: undefined })])).toEqual({ name: null, isSelf: true });
    expect(reviewRequester(task('a', { createdBy: '' }), 'me', [])).toEqual({ name: null, isSelf: false });
    expect(reviewRequester(task('a'), 'me', [], [{ id: 'requester', displayName: '登録者' }])).toEqual({ name: null, isSelf: false });
    expect(reviewRequesterName(task('a'), 'me', [notification({ senderName: undefined })], [{ id: 'requester', displayName: '田中' }])).toBe('田中');
    expect(reviewRequesterName(task('a'), null, [notification()], [{ id: 'requester', displayName: '田中' }])).toBeNull();
  });
  it('returns an avatar identity only from a matching review sender, never from the registrant', () => {
    expect(reviewRequester(task('a'), 'me', [notification()])).toEqual({ id: 'requester', name: '田中', isSelf: false });
    expect(reviewRequester(task('a', { createdBy: 'me' }), 'me', [notification({ senderId: 'me', senderName: '本人' })])).toEqual({ id: 'me', name: '本人', isSelf: true });
    expect(reviewRequester(task('a'), 'me', [notification({ senderId: undefined })])).toEqual({ name: '田中', isSelf: false });
    for (const changes of [{ userId: 'other' }, { projectId: 'other' }, { taskId: 'other' }, { type: 'comment_added' as const }]) {
      expect(reviewRequester(task('a'), 'me', [notification(changes)], [{ id: 'requester', displayName: '登録者' }])).toEqual({ name: null, isSelf: false });
    }
  });
  it('uses read or unread matching review notifications only for the requester name', () => {
    expect(reviewRequesterName(task('a'), 'me', [notification()])).toBe('田中');
    expect(reviewRequesterName(task('a'), 'me', [notification({ isRead: true })])).toBe('田中');
    for (const changes of [{ userId: 'other' }, { projectId: 'other' }, { taskId: 'other' }, { type: 'comment_added' as const }, { senderName: ' ' }]) {
      expect(reviewRequesterName(task('a'), 'me', [notification(changes)])).toBeNull();
    }
  });
});
