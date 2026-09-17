import { reviewOutcome } from '@/lib/task/workflow';
import type { DashboardTask } from './brief';
import type { Notification } from '@/types';

const dateValue = (date: Date | null | undefined, fallback: number) => date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : fallback;

/** Show the saved request text without guessing a category or changing the shared task. */
export function reviewRequestContent(task: DashboardTask): string {
  const content = task.review?.request?.trim() || task.description?.trim() || task.title.replace(/^確認依頼\s*[:：]\s*/, '').trim();
  const summary = content.replace(/\s+/g, ' ');
  const characters = Array.from(summary);
  return characters.length > 120 ? `${characters.slice(0, 120).join('')}…` : summary || '依頼内容を確認';
}

/** Review tasks are the source of resolution; notification read state is unrelated. */
export function selectNeoReviewRequests(tasks: readonly DashboardTask[], userId: string | null): DashboardTask[] {
  if (!userId) return [];
  const selected = tasks.filter(task => task.taskKind === 'review_request'
    && task.assigneeIds.includes(userId) && reviewOutcome(task) !== 'changes_requested' && !task.review?.responses[userId]
    && !task.isCompleted && !task.isAbandoned && !task.isArchived);
  const unique = [...new Map(selected.map(task => [JSON.stringify([task.projectId, task.id]), task])).values()];
  return unique.sort((a, b) => dateValue(a.dueDate, Infinity) - dateValue(b.dueDate, Infinity)
    || dateValue(b.createdAt, 0) - dateValue(a.createdAt, 0)
    || a.projectId.localeCompare(b.projectId) || a.id.localeCompare(b.id));
}

export interface ReviewRequester { id?: string; name: string | null; isSelf: boolean }

/** Sender identity comes from the matching review notification, not the task's registrant. */
export function reviewRequester(task: DashboardTask, userId: string | null, notifications: readonly Notification[], members: readonly { id: string; displayName: string }[] = []): ReviewRequester {
  if (!userId) return { name: null, isSelf: false };
  const notification = notifications.find(item => item.type === 'review_requested' && item.userId === userId
    && item.projectId === task.projectId && item.taskId === task.id);
  if (notification && (notification.senderId || notification.senderName?.trim())) {
    const name = notification.senderName?.trim() || members.find(member => member.id === notification.senderId)?.displayName.trim() || null;
    return { ...(notification.senderId ? { id: notification.senderId } : {}), name, isSelf: notification.senderId === userId };
  }
  return { name: null, isSelf: task.createdBy === userId };
}

export function reviewRequesterName(task: DashboardTask, userId: string | null, notifications: readonly Notification[], members: readonly { id: string; displayName: string }[] = []): string | null {
  return reviewRequester(task, userId, notifications, members).name;
}
