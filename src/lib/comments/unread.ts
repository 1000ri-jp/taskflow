import type { Notification } from '@/types';

/** A review notification points to a child task, but its comment lives on the source task. */
export function isUnreadTaskComment(notification: Notification, projectId: string, taskId: string): boolean {
  if (notification.isRead || notification.projectId !== projectId) return false;
  if (!['comment_added', 'mentioned', 'review_requested'].includes(notification.type)) return false;
  const sourceTaskId = notification.data?.sourceTaskId;
  if (typeof sourceTaskId === 'string' && sourceTaskId) return sourceTaskId === taskId;
  // Older comment/mention notifications only contain taskId. A review task alone
  // does not establish the location of its source comment.
  return notification.type !== 'review_requested' && notification.taskId === taskId;
}
