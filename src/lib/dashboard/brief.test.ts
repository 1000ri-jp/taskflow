import { describe, expect, it } from 'vitest';
import type { Notification } from '@/types';
import {
  buildTaskFlowBrief,
  buildTaskFlowUpcoming,
  type DashboardTask,
} from './brief';

const now = new Date(2026, 8, 2, 12, 0, 0);

function createTask(overrides: Partial<DashboardTask> = {}): DashboardTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    projectName: 'Luna*Lis',
    listId: 'list-1',
    title: '確認する',
    description: '',
    order: 0,
    assigneeIds: ['user-1'],
    labelIds: [],
    tagIds: [],
    dependsOnTaskIds: [],
    priority: null,
    startDate: null,
    dueDate: null,
    durationDays: null,
    isDueDateFixed: false,
    isCompleted: false,
    completedAt: null,
    isAbandoned: false,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    createdBy: 'user-1',
    createdAt: new Date(2026, 7, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
}

function createNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notification-1',
    userId: 'user-1',
    type: 'comment_added',
    title: 'コメントが追加されました',
    message: '確認してください',
    projectId: 'project-1',
    projectName: 'Luna*Lis',
    taskId: 'task-1',
    taskName: '確認する',
    senderId: 'user-2',
    senderName: 'Kaori',
    isRead: false,
    createdAt: new Date(2026, 8, 2, 9),
    data: {},
    ...overrides,
  };
}

describe('buildTaskFlowBrief', () => {
  it('surfaces shared review requests as important and links to the child task', () => {
    const result = buildTaskFlowBrief([], [], [createNotification({type:'review_requested', taskId:'review-id', data:{commentId:'original',sourceTaskId:'parent'}})], now);
    expect(result.rows[0].total).toBe(0);
    expect(result.rows[2].total).toBe(1);
    expect(result.rows[2].items[0]).toMatchObject({source:'CK',urgent:true,href:'/projects/project-1/board?task=review-id'});
  });
  it('collects unread task notifications, due tasks, and stopped tasks', () => {
    const dueToday = createTask({
      id: 'due-today',
      title: '今日の納品確認',
      dueDate: new Date(2026, 8, 2, 18),
    });
    const overdue = createTask({
      id: 'overdue',
      title: '期限超過タスク',
      dueDate: new Date(2026, 8, 1, 18),
      priority: 'high',
    });
    const future = createTask({
      id: 'future',
      title: '明日のタスク',
      dueDate: new Date(2026, 8, 3, 18),
      updatedAt: new Date(2026, 8, 2),
    });
    const stopped = createTask({
      id: 'stopped',
      title: '止まっているタスク',
      assigneeIds: [],
      updatedAt: new Date(2026, 7, 28),
    });

    const result = buildTaskFlowBrief(
      [future, dueToday, overdue],
      [future, dueToday, overdue, stopped],
      [createNotification(), createNotification({ id: 'read', isRead: true })],
      now
    );

    expect(result.rows[0].total).toBe(1);
    expect(result.rows[0].items[0]).toMatchObject({
      title: '確認する',
      meta: 'Kaori・3時間前',
      href: '/projects/project-1/board?task=task-1',
    });
    expect(result.rows[3].items.map((item) => item.title)).toEqual([
      '期限超過タスク',
      '今日の納品確認',
    ]);
    expect(result.rows[3].items[0].urgent).toBe(true);
    expect(result.rows[4].items[0]).toMatchObject({
      title: '止まっているタスク',
      action: '担当を決める',
    });
  });

  it('limits today tasks to the current user assignment while keeping other rows project-wide', () => {
    const mine = createTask({ id: 'mine', title: '自分の今日のタスク', dueDate: new Date(2026, 8, 2, 18) });
    const someoneElses = createTask({ id: 'someone-elses', title: '他の人の今日のタスク', dueDate: new Date(2026, 8, 2, 18), assigneeIds: ['user-2'] });
    const unassigned = createTask({ id: 'unassigned', title: '未担当の今日のタスク', dueDate: new Date(2026, 8, 2, 18), assigneeIds: [] });

    const result = buildTaskFlowBrief([mine], [mine, someoneElses, unassigned], [], now);
    const todayRow = result.rows.find((row) => row.label === '今日やる')!;

    expect(todayRow.total).toBe(1);
    expect(todayRow.items.map((item) => item.title)).toEqual(['自分の今日のタスク']);
  });

  it('keeps an assigned review request with a due date only in confirmation waiting', () => {
    const reviewTask = createTask({
      id: 'due-review',
      title: '今日が期限の確認依頼',
      taskKind: 'review_request',
      dueDate: new Date(2026, 8, 2, 18),
    });

    const result = buildTaskFlowBrief([reviewTask], [reviewTask], [], now);
    const row = (label: string) => result.rows.find((item) => item.label === label)!;

    expect(row('今日やる').total).toBe(0);
    expect(row('今日やる').items[0].title).toBe('今日までのTaskFlowタスクはありません');
    expect(row('確認待ち').items.map((item) => item.title)).toEqual(['今日が期限の確認依頼']);
  });

  it('shows only review requests assigned to the current user in confirmation waiting', () => {
    const mine = createTask({ id: 'my-review', title: '自分宛の確認依頼', taskKind: 'review_request' });
    const someoneElses = createTask({
      id: 'someone-elses-review',
      title: '他の人宛の確認依頼',
      taskKind: 'review_request',
      assigneeIds: ['user-2'],
    });

    const result = buildTaskFlowBrief([mine], [mine, someoneElses], [], now);
    const reviewRow = result.rows.find((row) => row.label === '確認待ち')!;

    expect(reviewRow.total).toBe(1);
    expect(reviewRow.items.map((item) => item.title)).toEqual(['自分宛の確認依頼']);
  });

  it('shows explicit empty and unconnected states', () => {
    const result = buildTaskFlowBrief([], [], [], now);

    expect(result.rows[0].items[0].title).toBe('未読の重要コメントはありません');
    expect(result.rows[1].items[0].title).toBe('Googleカレンダーは未接続');
    expect(result.rows[3].items[0].title).toBe('今日までのTaskFlowタスクはありません');
    expect(result.rows[4].items[0].title).toBe('確認が必要な停止タスクはありません');
    expect(result.rows[5].items[0].title).toBe('整理が必要なタスクはありません');
  });

  it('separates inactivity, missing information, and confirmation waiting', () => {
    const freshUnassigned = createTask({
      id: 'fresh-unassigned',
      title: '今日更新した未整理タスク',
      assigneeIds: [],
      updatedAt: new Date(2026, 8, 2, 18),
    });
    const staleUnassigned = createTask({
      id: 'stale-unassigned',
      title: '3日前から止まったタスク',
      assigneeIds: [],
      updatedAt: new Date(2026, 7, 30, 12),
    });
    const dueUnassigned = createTask({
      id: 'due-unassigned',
      title: '今日が期限の未担当タスク',
      assigneeIds: [],
      dueDate: new Date(2026, 8, 2, 18),
      updatedAt: new Date(2026, 7, 20),
    });
    const reviewParent = createTask({
      id: 'review-parent',
      title: '確認を待つ親タスク',
      updatedAt: new Date(2026, 7, 20),
    });
    const reviewTask = createTask({
      id: 'review-child',
      title: '確認依頼：親タスク',
      parentTaskId: reviewParent.id,
      taskKind: 'review_request',
      updatedAt: new Date(2026, 7, 20),
    });

    const result = buildTaskFlowBrief([reviewTask], [freshUnassigned, staleUnassigned, dueUnassigned, reviewParent, reviewTask], [], now);
    const row = (label: string) => result.rows.find((item) => item.label === label)!;

    expect(row('今日やる').total).toBe(0);
    expect(row('今日やる').items[0].title).toBe('今日までのTaskFlowタスクはありません');
    expect(row('3日動いていない').items.map((item) => item.title)).toEqual(['3日前から止まったタスク']);
    expect(row('3日動いていない').items[0].badges).toEqual(['担当未定', '期限未設定']);
    expect(row('3日動いていない').items.map((item) => item.title)).not.toContain('確認を待つ親タスク');
    expect(row('確認待ち').items.map((item) => item.title)).toEqual(['確認依頼：親タスク']);
    expect(row('要整理').items.map((item) => item.title)).toEqual(['今日更新した未整理タスク']);
    expect(row('要整理').items[0].badges).toEqual(['担当未定', '期限未設定']);
  });

  it('keeps every item available for expanding a brief row', () => {
    const dueTasks = ['A', 'B', 'C', 'D'].map((title, index) =>
      createTask({
        id: `due-${index}`,
        title,
        dueDate: new Date(2026, 8, 2, 18),
      })
    );

    const result = buildTaskFlowBrief(dueTasks, dueTasks, [], now);

    expect(result.rows[3].total).toBe(4);
    expect(result.rows[3].items.map((item) => item.title)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('buildTaskFlowUpcoming', () => {
  it('includes fourth and fifth day tasks only in the five-day range', () => {
    const tasks = [4, 5, 6].map((offset) => createTask({ id: `day-${offset}`, dueDate: new Date(2026, 8, 2 + offset) }));
    tasks.push(createTask({ id: 'archived', dueDate: new Date(2026, 8, 7), isArchived: true }));
    const days = buildTaskFlowUpcoming(tasks, now, 5);
    expect(days.map((day) => day.label)).toEqual(['明日', '2日後', '3日後', '4日後', '5日後']);
    expect(days.map((day) => day.tasks.map((task) => task.id))).toEqual([[], [], [], ['day-4'], ['day-5']]);
    expect(buildTaskFlowUpcoming(tasks, now, 3).flatMap((day) => day.tasks)).toEqual([]);
  });
  it('groups visible active tasks due tomorrow through three days from now', () => {
    const tomorrowLow = createTask({
      id: 'tomorrow-low',
      title: '明日の通常タスク',
      dueDate: new Date(2026, 8, 3, 18),
      priority: 'low',
    });
    const tomorrowHigh = createTask({
      id: 'tomorrow-high',
      title: '明日の優先タスク',
      projectId: 'project-2',
      projectName: '会社プロジェクト',
      dueDate: new Date(2026, 8, 3),
      priority: 'high',
    });
    const dayAfterTomorrow = createTask({
      id: 'day-after-tomorrow',
      title: '明後日のタスク',
      dueDate: new Date(2026, 8, 4),
      assigneeIds: [],
    });
    const completed = createTask({
      id: 'completed',
      dueDate: new Date(2026, 8, 5),
      isCompleted: true,
    });
    const abandoned = createTask({
      id: 'abandoned',
      dueDate: new Date(2026, 8, 5),
      isAbandoned: true,
    });
    const outsideRange = createTask({
      id: 'outside-range',
      dueDate: new Date(2026, 8, 6),
    });

    const result = buildTaskFlowUpcoming(
      [
        tomorrowLow,
        tomorrowHigh,
        dayAfterTomorrow,
        completed,
        abandoned,
        outsideRange,
      ],
      now
    );

    expect(result.map((day) => day.label)).toEqual(['明日', '2日後', '3日後']);
    expect(result[0].tasks.map((task) => task.id)).toEqual([
      'tomorrow-high',
      'tomorrow-low',
    ]);
    expect(result[0].tasks[0]).toMatchObject({
      projectName: '会社プロジェクト',
      href: '/projects/project-2/board?task=tomorrow-high',
    });
    expect(result[1].tasks.map((task) => task.id)).toEqual(['day-after-tomorrow']);
    expect(result[2].tasks).toEqual([]);
  });
});
