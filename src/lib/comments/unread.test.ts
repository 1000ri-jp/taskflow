import { describe, expect, it } from 'vitest';
import type { Notification } from '@/types';
import { isUnreadTaskComment } from './unread';

const notice = { id: 'n', userId: 'u', projectId: 'p', taskId: 't', type: 'comment_added', isRead: false, data: {} } as Notification;

describe('isUnreadTaskComment', () => {
  it('matches unread comments and legacy mentions within the exact project and task', () => {
    expect(isUnreadTaskComment(notice, 'p', 't')).toBe(true);
    expect(isUnreadTaskComment({ ...notice, type: 'mentioned' }, 'p', 't')).toBe(true);
    expect(isUnreadTaskComment(notice, 'other', 't')).toBe(false);
    expect(isUnreadTaskComment(notice, 'p', 'other')).toBe(false);
    expect(isUnreadTaskComment({ ...notice, isRead: true }, 'p', 't')).toBe(false);
  });

  it('attributes a review comment to its source task rather than its generated review task', () => {
    const review: Notification = { ...notice, type: 'review_requested', taskId: 'review-child', data: { sourceTaskId: 't', commentId: 'c' } };
    expect(isUnreadTaskComment(review, 'p', 't')).toBe(true);
    expect(isUnreadTaskComment(review, 'p', 'review-child')).toBe(false);
    expect(isUnreadTaskComment({ ...review, data: {} }, 'p', 'review-child')).toBe(false);
  });

  it('does not color comment icons for unrelated task notifications', () => {
    for (const type of ['task_assigned', 'task_updated', 'due_reminder', 'task_bell'] as const) {
      expect(isUnreadTaskComment({ ...notice, type }, 'p', 't')).toBe(false);
    }
  });

  it('supports old notifications without data but never uses a conflicting taskId over the source', () => {
    expect(isUnreadTaskComment({ ...notice, data: undefined } as unknown as Notification, 'p', 't')).toBe(true);
    expect(isUnreadTaskComment({ ...notice, data: { sourceTaskId: 'other' } }, 'p', 't')).toBe(false);
  });
});
