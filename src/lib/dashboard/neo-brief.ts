import { addDays, endOfDay, isAfter, isBefore, isValid, startOfDay } from 'date-fns';
import type { DashboardTask } from './brief';
import { selectNeoReviewRequests } from './review-requests';
import type { Notification } from '@/types';
import type { BriefTaskScope } from '@/stores/briefDisplayStore';

export const neoTaskKey = (task: Pick<DashboardTask, 'projectId' | 'id'>) => JSON.stringify([task.projectId, task.id]);
const active = (task: DashboardTask) => !task.isCompleted && !task.isArchived && !task.isAbandoned;
const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
export const isNeoAutomationReminder = (notification: Pick<Notification, 'type' | 'data'>) => notification.type === 'due_reminder' && notification.data?.automation === true;

function validDay(date: Date | null | undefined): Date | null {
  return date && isValid(date) ? startOfDay(date) : null;
}

function comparePriorityThenDeadline(a: DashboardTask, b: DashboardTask, latestDueFirst = false): number {
  const priority = (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3)
    - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3);
  if (priority) return priority;
  const aDue = validDay(a.dueDate)?.getTime() ?? Infinity;
  const bDue = validDay(b.dueDate)?.getTime() ?? Infinity;
  if (aDue !== bDue) {
    if (!Number.isFinite(aDue)) return 1;
    if (!Number.isFinite(bDue)) return -1;
    return latestDueFirst ? bDue - aDue : aDue - bDue;
  }
  return a.title.localeCompare(b.title, 'ja');
}

export function neoDependencyEvidence(task: DashboardTask, tasks: readonly DashboardTask[]) {
  return task.dependsOnTaskIds.flatMap(id => {
    const dependency = tasks.find(candidate => candidate.projectId === task.projectId && candidate.id === id);
    if (dependency?.isCompleted && !dependency.isAbandoned) return [];
    return [{ id, title: dependency?.title ?? '参照先を取得できません', state: !dependency || dependency.isArchived ? 'unknown' as const : dependency.isAbandoned ? 'cancelled' as const : 'waiting' as const }];
  });
}

/** Build from the same live tasks as the overview. Age and unread counts are not obligations. */
export function buildNeoBrief(tasks: readonly DashboardTask[], notifications: readonly Notification[], userId: string | null, now: Date, taskScope: BriefTaskScope = 'mine', assigneeFilterId?: string | null) {
  const scopedAssigneeId = assigneeFilterId === undefined ? taskScope === 'all' ? null : userId : assigneeFilterId;
  const scoped = userId ? tasks.filter(task => active(task) && (scopedAssigneeId === null || task.assigneeIds.includes(scopedAssigneeId))) : [];
  const today = startOfDay(now);
  const reviews = selectNeoReviewRequests(tasks, userId);
  const reviewKeys = new Set(reviews.map(neoTaskKey));
  const datedWork = scoped.filter(task => !task.workState && !reviewKeys.has(neoTaskKey(task)) && task.taskKind !== 'review_request'
    && !!validDay(task.dueDate)
    && (!validDay(task.startDate) || !isAfter(validDay(task.startDate)!, today)));
  const deadlines = datedWork.filter(task => !isAfter(validDay(task.dueDate)!, today)).sort((a, b) => {
    const aDue = validDay(a.dueDate)!;
    const bDue = validDay(b.dueDate)!;
    const overdueDiff = Number(!isBefore(aDue, today)) - Number(!isBefore(bDue, today));
    const bothOverdue = isBefore(aDue, today) && isBefore(bDue, today);
    return overdueDiff || comparePriorityThenDeadline(a, b, bothOverdue);
  });
  const workPeriod = datedWork.filter(task => isAfter(validDay(task.dueDate)!, today) && !!validDay(task.startDate))
    .sort(comparePriorityThenDeadline);
  const homeTaskKeys = new Set([...deadlines, ...workPeriod].map(neoTaskKey));
  const waiting = scoped.filter(task => !task.workState && task.taskKind !== 'review_request' && !homeTaskKeys.has(neoTaskKey(task))
    && (task.priority === 'high' || !!task.dueDate && isValid(task.dueDate) && task.dueDate <= endOfDay(addDays(now, 2)))
    && neoDependencyEvidence(task, tasks).length > 0);
  const paused = scoped.filter(task => !!task.workState && task.taskKind !== 'review_request');
  const displayedKeys = new Set([...reviewKeys, ...homeTaskKeys, ...waiting.map(neoTaskKey), ...paused.map(neoTaskKey)]);
  // Explicit calls and the existing all-child reminder are actionable. Other unread events are not reply requests.
  const calls = notifications.filter(notification => notification.userId === userId && !notification.isRead
    && (isNeoAutomationReminder(notification) || notification.type === 'task_bell' && notification.senderId !== userId && Boolean(notification.senderId)) && notification.taskId
    && tasks.some(task => task.projectId === notification.projectId && task.id === notification.taskId && active(task)))
    .sort((a, b) => Number(isNeoAutomationReminder(b)) - Number(isNeoAutomationReminder(a)) || b.createdAt.getTime() - a.createdAt.getTime());
  const uniqueCalls = [...new Map(calls.map(notification => [JSON.stringify([notification.projectId, notification.taskId]), notification] as const).reverse()).values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { reviews, deadlines, workPeriod, waiting, paused, calls: uniqueCalls.filter(notification => !displayedKeys.has(JSON.stringify([notification.projectId, notification.taskId]))),
    taskCalls: uniqueCalls.filter(notification => displayedKeys.has(JSON.stringify([notification.projectId, notification.taskId]))) };
}
