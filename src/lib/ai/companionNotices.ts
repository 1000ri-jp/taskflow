import type { Notification } from '@/types';
export const isUrgentNotice = (notice: Notification) => notice.type === 'review_requested' && notice.data?.requiresResponse === true && notice.data?.urgency === 'urgent';
export const isPriorityNotice = (notice: Notification) => notice.data?.requiresResponse === true;
export const urgentNoticeKey = (notice: Notification) => `urgent:${notice.id}:${notice.createdAt.toISOString()}`;
export function unreadCompanionNotices(notices: Notification[], uid: string) {
  return notices.filter(n => n.userId === uid && !n.isRead && n.senderId !== uid).sort((a,b) =>
    Number(isUrgentNotice(b))-Number(isUrgentNotice(a)) || Number(isPriorityNotice(b))-Number(isPriorityNotice(a)) || b.createdAt.getTime()-a.createdAt.getTime());
}
