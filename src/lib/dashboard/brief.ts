import {
  addDays,
  differenceInCalendarDays,
  differenceInHours,
  endOfDay,
  isSameDay,
  startOfDay,
} from 'date-fns';
import type { Notification, Priority, Task } from '@/types';
import { notificationTaskHref } from '@/lib/task/commentSubmission';
import type { UpcomingRange } from './upcoming-range';
import type { BriefTaskScope } from '@/stores/briefDisplayStore';

export type DashboardBriefSource = 'MAIL' | 'CAL' | 'ToDo' | 'TF' | 'CK';
export type DashboardBriefTone = 'red' | 'blue' | 'green' | 'amber';

export interface DashboardTask extends Task {
  projectName: string;
  projectColor?: string;
  projectIcon?: string;
  projectIconUrl?: string;
}

export interface DashboardBriefItem {
  source: DashboardBriefSource;
  projectId?: string;
  sourceCommentId?: string;
  title: string;
  meta?: string;
  badges?: string[];
  action?: string;
  href?: string;
  urgent?: boolean;
  projectColor?: string;
  projectIcon?: string;
  projectIconUrl?: string;
  priority?: Priority | null;
}

export interface DashboardBriefRow {
  label: string;
  tone: DashboardBriefTone;
  items: DashboardBriefItem[];
  total: number;
}

export interface DashboardBriefData {
  rows: DashboardBriefRow[];
  generatedAt: Date;
}

export interface DashboardUpcomingTask {
  id: string;
  title: string;
  projectName: string;
  href: string;
  dueDate: Date;
  projectIcon?: string;
  projectIconUrl?: string;
  projectColor?: string;
  priority?: Priority | null;
}

export interface DashboardUpcomingDay {
  dayOffset: number;
  label: string;
  date: Date;
  tasks: DashboardUpcomingTask[];
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const REPLY_NOTIFICATION_TYPES = new Set(['comment_added', 'mentioned', 'task_bell', 'review_requested']);

function taskHref(task: Pick<Task, 'projectId' | 'id'>): string {
  return `/projects/${task.projectId}/board?task=${task.id}`;
}

function notificationHref(notification: Notification): string | undefined {
  if (!notification.projectId || !notification.taskId) return undefined;
  return notificationTaskHref(notification);
}

function relativeAge(date: Date, now: Date): string {
  const hours = Math.max(0, differenceInHours(now, date));
  if (hours < 1) return '1時間以内';
  if (hours < 24) return `${hours}時間前`;
  return `${Math.max(1, differenceInCalendarDays(startOfDay(now), startOfDay(date)))}日前`;
}

function dueMeta(task: DashboardTask, now: Date): string {
  if (!task.dueDate) return `${task.projectName}・期限未設定`;

  const today = startOfDay(now);
  const dueDay = startOfDay(task.dueDate);
  const overdueDays = differenceInCalendarDays(today, dueDay);

  if (overdueDays > 0) return `${task.projectName}・期限超過 ${overdueDays}日`;
  return `${task.projectName}・今日まで`;
}

function activityAgeLabel(task: DashboardTask, now: Date): string {
  const daysSinceUpdate = Math.max(0, differenceInCalendarDays(startOfDay(now), startOfDay(task.updatedAt)));
  return daysSinceUpdate === 0 ? '今日更新' : `最終更新から${daysSinceUpdate}日`;
}

function taskInfoBadges(task: DashboardTask): string[] {
  return [
    task.assigneeIds.length === 0 ? '担当未定' : null,
    !task.dueDate ? '期限未設定' : null,
  ].filter((badge): badge is string => badge !== null);
}

function projectDisplay(task: DashboardTask | undefined) {
  return { projectColor: task?.projectColor, projectIcon: task?.projectIcon, projectIconUrl: task?.projectIconUrl, priority: task?.priority };
}

function staleMeta(task: DashboardTask, now: Date): string {
  return `${task.projectName}・${activityAgeLabel(task, now)}`;
}

export function buildTaskFlowUpcoming(
  allProjectTasks: DashboardTask[],
  now: Date = new Date(),
  dayCount: UpcomingRange = 3
): DashboardUpcomingDay[] {
  const activeTasksWithDueDate = allProjectTasks.filter(
    (task): task is DashboardTask & { dueDate: Date } =>
      !task.isCompleted &&
      !task.isAbandoned &&
      !task.isArchived &&
      task.dueDate !== null
  );

  return Array.from({ length: dayCount }, (_, index) => index + 1).map((dayOffset) => {
    const date = startOfDay(addDays(now, dayOffset));
    const tasks = activeTasksWithDueDate
      .filter((task) => isSameDay(task.dueDate, date))
      .sort((a, b) => {
        const priorityDiff =
          (a.priority ? PRIORITY_ORDER[a.priority] : 3) -
          (b.priority ? PRIORITY_ORDER[b.priority] : 3);
        if (priorityDiff !== 0) return priorityDiff;
        return a.title.localeCompare(b.title, 'ja');
      })
      .map((task) => ({
        id: task.id,
        title: task.title,
        projectName: task.projectName,
        href: taskHref(task),
        dueDate: task.dueDate,
        projectIcon: task.projectIcon,
        projectIconUrl: task.projectIconUrl,
        projectColor: task.projectColor,
        priority: task.priority,
      }));

    return {
      dayOffset,
      label: dayOffset === 1 ? '明日' : `${dayOffset}日後`,
      date,
      tasks,
    };
  });
}

export function buildTaskFlowBrief(
  assignedTasks: DashboardTask[],
  allProjectTasks: DashboardTask[],
  notifications: Notification[],
  now: Date = new Date(),
  scope: BriefTaskScope = 'mine'
): DashboardBriefData {
  const todayEnd = endOfDay(now);
  const taskPool = Array.from(new Map([...allProjectTasks, ...assignedTasks].map((task) => [task.id, task])).values());
  const scopedTaskIds = scope === 'all' ? null : new Set(assignedTasks.map((task) => task.id));
  const activeTasks = taskPool.filter((task) => !task.isCompleted && !task.isAbandoned && !task.isArchived && (!scopedTaskIds || scopedTaskIds.has(task.id)));
  const importantNotifications = notifications
    .filter((notification) => !notification.isRead && REPLY_NOTIFICATION_TYPES.has(notification.type))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const dueTasks = activeTasks
    .filter((task) => task.taskKind !== 'review_request' && task.dueDate && task.dueDate <= todayEnd)
    .sort((a, b) => {
      const dueDiff = (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER);
      if (dueDiff !== 0) return dueDiff;
      return (a.priority ? PRIORITY_ORDER[a.priority] : 3) - (b.priority ? PRIORITY_ORDER[b.priority] : 3);
    });

  const dueTaskIds = new Set(activeTasks
    .filter((task) => task.dueDate && task.dueDate <= todayEnd)
    .map((task) => task.id));
  const reviewRequestTasks = activeTasks.filter((task) => task.taskKind === 'review_request');
  const reviewWaitingTasks = reviewRequestTasks;
  const reviewWaitingIds = new Set(reviewRequestTasks.flatMap((task) => [task.id, ...(task.parentTaskId ? [task.parentTaskId] : [])]));
  const staleTasks = activeTasks
    .filter((task) => {
      if (dueTaskIds.has(task.id) || reviewWaitingIds.has(task.id)) return false;
      const daysSinceUpdate = differenceInCalendarDays(startOfDay(now), startOfDay(task.updatedAt));
      return daysSinceUpdate >= 3;
    })
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  const staleTaskIds = new Set(staleTasks.map((task) => task.id));
  const organizeTasks = activeTasks
    .filter((task) => taskInfoBadges(task).length > 0 && !dueTaskIds.has(task.id) && !staleTaskIds.has(task.id) && !reviewWaitingIds.has(task.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const notificationByTaskId = new Map(taskPool.map((task) => [task.id, task]));
  const reviewNotifications = importantNotifications.filter((notification) => notification.type === 'review_requested');
  const reviewItems: DashboardBriefItem[] = [
    ...reviewWaitingTasks.map((task) => ({
      source: 'CK' as const,
      projectId: task.projectId,
      sourceCommentId: task.sourceCommentId,
      title: task.title,
      meta: task.projectName,
      ...projectDisplay(task),
      action: '確認する',
      href: taskHref(task),
    })),
    ...reviewNotifications
      .filter((notification) => {
        const task = notification.taskId ? notificationByTaskId.get(notification.taskId) : undefined;
        return !task || (!task.isCompleted && !task.isAbandoned && !task.isArchived && task.taskKind !== 'review_request');
      })
      .map((notification) => ({
        source: 'CK' as const,
        projectId: notification.projectId,
        sourceCommentId: typeof notification.data?.commentId === 'string' ? notification.data.commentId : undefined,
        title: notification.taskName || notification.title,
        meta: `${notification.projectName || 'TaskFlow'}・${relativeAge(notification.createdAt, now)}`,
        action: notificationHref(notification) ? '確認する' : undefined,
        href: notificationHref(notification),
        urgent: true,
      })),
  ];

  const replyItems: DashboardBriefItem[] = importantNotifications
    .filter((notification) => notification.type !== 'review_requested')
    .map((notification) => ({
    source: 'TF' as const,
    ...projectDisplay(notification.taskId ? notificationByTaskId.get(notification.taskId) : undefined),
    title: notification.taskName || notification.title,
    meta: `${notification.senderName || notification.projectName || 'TaskFlow'}・${relativeAge(notification.createdAt, now)}`,
    action: notificationHref(notification) ? '返信を確認' : undefined,
    href: notificationHref(notification),
    urgent: notification.type === 'mentioned' || notification.type === 'task_bell',
  }));

  const todayItems: DashboardBriefItem[] = dueTasks.map((task) => ({
    source: 'TF',
    ...projectDisplay(task),
    title: task.title,
    meta: dueMeta(task, now),
    badges: taskInfoBadges(task),
    action: '開く',
    href: taskHref(task),
    urgent: Boolean(task.dueDate && task.dueDate < startOfDay(now)),
  }));

  const staleItems: DashboardBriefItem[] = staleTasks.map((task) => ({
    source: 'TF',
    ...projectDisplay(task),
    projectId: task.projectId,
    title: task.title,
    meta: staleMeta(task, now),
    badges: taskInfoBadges(task),
    action: task.assigneeIds.length === 0 ? '担当を決める' : '続ける／やめる',
    href: taskHref(task),
  }));

  const organizeItems: DashboardBriefItem[] = organizeTasks.map((task) => ({
    source: 'TF',
    ...projectDisplay(task),
    projectId: task.projectId,
    title: task.title,
    meta: `${task.projectName}・${activityAgeLabel(task, now)}`,
    badges: taskInfoBadges(task),
    action: '整理する',
    href: taskHref(task),
  }));

  return {
    generatedAt: now,
    rows: [
      {
        label: '返信待ち・重要',
        tone: 'red',
        total: replyItems.length,
        items: replyItems.length > 0 ? replyItems : [{ source: 'TF', title: '未読の重要コメントはありません', meta: 'TaskFlow実データ' }],
      },
      {
        label: '今日の予定',
        tone: 'blue',
        total: 0,
        items: [{ source: 'CAL', title: 'Googleカレンダーは未接続', meta: 'Phase 1で読み取り専用接続' }],
      },
      {
        label: '確認待ち',
        tone: 'red',
        total: reviewItems.length,
        items: reviewItems.length > 0 ? reviewItems : [{ source: 'CK', title: '確認待ちのタスクはありません', meta: 'TaskFlow実データ' }],
      },
      {
        label: '今日やる',
        tone: 'green',
        total: dueTasks.length,
        items: todayItems.length > 0 ? todayItems : [{ source: 'TF', title: '今日までのTaskFlowタスクはありません', meta: 'TaskFlow実データ' }],
      },
      {
        label: '3日動いていない',
        tone: 'amber',
        total: staleTasks.length,
        items: staleItems.length > 0 ? staleItems : [{ source: 'TF', title: '確認が必要な停止タスクはありません', meta: 'TaskFlow実データ' }],
      },
      {
        label: '要整理',
        tone: 'amber',
        total: organizeTasks.length,
        items: organizeItems.length > 0 ? organizeItems : [{ source: 'TF', title: '整理が必要なタスクはありません', meta: 'TaskFlow実データ' }],
      },
    ],
  };
}
