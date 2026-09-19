import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { Notification } from '@/types';
import type { ProjectTaskStatus } from '@/hooks/useMyTasks';
import { NeoReviewRequests } from './NeoReviewRequests';

const source = vi.hoisted(() => ({ notifications: [] as Notification[], markAsRead: vi.fn(), markAllAsRead: vi.fn(), remove: vi.fn(), sendBellNotification: vi.fn() }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => source }));
const task = (id: string, changes: Partial<DashboardTask> = {}) => ({ id, projectId: 'p', projectName: '準備', title: `確認依頼${id}`,
  taskKind: 'review_request', createdBy: 'requester', assigneeIds: ['me'], isCompleted: false, isArchived: false, isAbandoned: false,
  dueDate: new Date(2026, 8, 13), createdAt: new Date(2026, 8, 1), ...changes } as DashboardTask);
const status = (entries: [string, ProjectTaskStatus][]) => new Map(entries);
const props = { userId: 'me', tasks: [task('a')], isLoading: false, error: null,
  projectTaskStatus: status([['p', { status: 'ready' }]]) };
const readNotification = { id: 'n', userId: 'me', projectId: 'p', taskId: 'a', type: 'review_requested',
  senderId: 'requester', senderName: '田中', isRead: true } as Notification;

beforeEach(() => {
  vi.clearAllMocks(); source.notifications = [readNotification];
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 12, 12));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('NeoReviewRequests', () => {
  it('shows shared waiting conditions even after the review date has passed', () => {
    render(<NeoReviewRequests {...props} tasks={[task('a', { workState: { status: 'wait', reason: '素材の到着待ち', resumeCondition: '到着した見本の色を確認する', reviewAt: '2026-09-10' } })]} />);
    expect(screen.getByText(/待ち：素材の到着待ち/)).toHaveTextContent('再開の条件：到着した見本の色を確認する');
    expect(screen.getByText(/待ち：素材の到着待ち/)).toHaveTextContent('2026/9/10に再確認');
  });
  it('shows the unresolved task even after its notification is read and opens only the task detail', () => {
    const tasks = Object.freeze([Object.freeze(task('a'))]);
    render(<NeoReviewRequests {...props} tasks={tasks} />);
    expect(screen.getByRole('heading', { name: '依頼内容' })).toBeVisible();
    expect(screen.getByRole('img', { name: '依頼者: 田中' })).toBeVisible();
    expect(screen.queryByText('田中さんから')).not.toBeInTheDocument();
    expect(screen.getByText('期限 9/13')).toBeVisible();
    const link = screen.getByRole('link', { name: /確認依頼a/ });
    expect(link).toHaveAttribute('href', '/projects/p/board?task=a');
    expect(within(link).getByRole('img', { name: '準備' })).toBeVisible();
    expect(within(link).getByText('確認依頼a').closest('p')).toContainElement(within(link).getByText('期限 9/13'));
    expect(within(link).getByText('確認依頼a').closest('p')).not.toContainElement(within(link).getByRole('img', { name: '依頼者: 田中' }));
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    expect(source.markAsRead).not.toHaveBeenCalled(); expect(source.markAllAsRead).not.toHaveBeenCalled();
    expect(source.remove).not.toHaveBeenCalled(); expect(source.sendBellNotification).not.toHaveBeenCalled();
    expect(tasks[0].isCompleted).toBe(false);
  });
  it('shows three initially, expands locally, and resets the display count when the user changes', () => {
    const tasks = Array.from({ length: 5 }, (_, index) => task(String(index), { assigneeIds: ['me', 'next'] }));
    const { rerender } = render(<NeoReviewRequests {...props} tasks={tasks} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'ほかの依頼を見る（残り2件）' }));
    expect(screen.getAllByRole('link')).toHaveLength(5);
    rerender(<NeoReviewRequests {...props} tasks={tasks} userId="next" />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(source.markAsRead).not.toHaveBeenCalled();
  });
  it('moves between unresolved requests without changing them and can show the whole round', () => {
    const tasks = [
      task('normal', { dueDate: null }),
      task('today', { dueDate: new Date(2026, 8, 12) }),
      task('soon', { dueDate: new Date(2026, 8, 14) }),
      task('later', { dueDate: new Date(2026, 8, 20) }),
    ];
    render(<NeoReviewRequests {...props} tasks={tasks} />);
    const navigation = screen.getByLabelText('確認案件の移動');
    expect(navigation).toHaveTextContent('1 / 4件');
    expect(navigation).toHaveTextContent('今日が回答期限');
    expect(screen.getByRole('link', { name: /確認依頼today/ })).toBeVisible();
    fireEvent.click(within(navigation).getByRole('button', { name: '次の件' }));
    expect(navigation).toHaveTextContent('2 / 4件');
    fireEvent.click(within(navigation).getByRole('button', { name: '前へ' }));
    expect(navigation).toHaveTextContent('1 / 4件');
    fireEvent.click(within(navigation).getByRole('button', { name: 'ほかの件を見る（一覧）' }));
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(source.markAsRead).not.toHaveBeenCalled();
    expect(tasks.every(item => !item.isCompleted && !item.isArchived)).toBe(true);
  });
  it('keeps empty, loading, partial failure and complete failure distinct, without showing stale project data', () => {
    const { rerender } = render(<NeoReviewRequests {...props} tasks={[]} />);
    expect(screen.getByText('いまはありません。')).toBeVisible();
    rerender(<NeoReviewRequests {...props} isLoading projectTaskStatus={status([['p', { status: 'loading' }]])} />);
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('いまはありません。')).not.toBeInTheDocument();
    const failed = { status: 'error', error: new Error('unavailable') } as const;
    rerender(<NeoReviewRequests {...props} tasks={[task('a'), task('secret', { projectId: 'failed' })]} error={failed.error}
      projectTaskStatus={status([['p', { status: 'ready' }], ['failed', failed]])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('一部の依頼内容');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('確認依頼secret')).not.toBeInTheDocument();
    rerender(<NeoReviewRequests {...props} error={failed.error} projectTaskStatus={status([['p', failed]])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('依頼内容を取得できません。');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('いまはありません。')).not.toBeInTheDocument();
  });
  it('uses the task source for completion and ignores ordinary comments and missing request tasks', () => {
    source.notifications = [readNotification, { ...readNotification, taskId: 'missing' }, { ...readNotification, taskId: 'memo', type: 'comment_added', isRead: false }];
    const { rerender } = render(<NeoReviewRequests {...props} tasks={[task('a'), task('memo', { taskKind: undefined })]} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    rerender(<NeoReviewRequests {...props} tasks={[task('a', { isCompleted: true })]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('いまはありません。')).toBeVisible();
    rerender(<NeoReviewRequests {...props} tasks={[task('a', { assigneeIds: ['someone'] })]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('keeps unknown requesters neutral for self-registered and legacy tasks without permanent registration text', () => {
    source.notifications = [];
    render(<NeoReviewRequests {...props} members={[{ id: 'me', displayName: '本人' }]} tasks={[
      task('self', { createdBy: 'me', priority: 'high' }), task('legacy', { createdBy: '' }),
    ]} />);
    const own = screen.getByRole('link', { name: /確認依頼self/ });
    expect(within(own).queryByText('自分で登録した確認依頼')).not.toBeInTheDocument();
    expect(within(own).getByRole('img', { name: '依頼者を確認' })).toHaveTextContent('?');
    expect(within(own).getByRole('group', { name: '担当者: 本人' })).toBeVisible();
    expect(within(own).getByLabelText('優先度: 高')).toHaveTextContent('高');
    expect(within(own).queryByText('優先度')).not.toBeInTheDocument();
    expect(own.firstElementChild?.lastElementChild).toContainElement(within(own).getByLabelText('優先度: 高'));
    const legacy = screen.getByRole('link', { name: /確認依頼legacy/ });
    expect(within(legacy).getByRole('img', { name: '依頼者を確認' })).toHaveTextContent('?');
    expect(within(legacy).queryByText('優先度')).not.toBeInTheDocument();
  });
  it('shows confirmed self sender before the assignee without permanent registration text', () => {
    source.notifications = [{ ...readNotification, senderId: 'me', senderName: 'こずえ' }];
    render(<NeoReviewRequests {...props} members={[{ id: 'me', displayName: 'こずえ' }]} tasks={[task('a', { createdBy: 'me' })]} />);
    expect(screen.getByRole('img', { name: '依頼者: 自分' })).toBeVisible();
    expect(screen.getByRole('group', { name: '担当者: こずえ' })).toBeVisible();
    expect(screen.queryByText('自分で登録した確認依頼')).not.toBeInTheDocument();
    expect(screen.queryByText('こずえさんから')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /確認依頼a/ })).toHaveAttribute('href', '/projects/p/board?task=a');
  });
  it('shows the actual sender avatar, then three assignees and the remaining names without changing the assigned people', async () => {
    vi.useRealTimers();
    vi.stubGlobal('Image', class extends EventTarget { src = ''; complete = true; naturalWidth = 1; });
    const assignees = ['me', 'a', 'b', 'c', 'd', 'e'].map(id => ({ id, displayName: `担当${id}`, photoURL: `https://example.test/${id}.png` }));
    render(<NeoReviewRequests {...props} members={[{ id: 'requester', displayName: '田中', photoURL: 'https://example.test/sender.png' }, ...assignees]}
      tasks={[task('a', { createdBy: 'someone-else', assigneeIds: assignees.map(person => person.id), listName: '今日の準備', listColor: '#2563eb', priority: 'high' })]} />);
    const row = within(screen.getByRole('link', { name: /確認依頼a/ }));
    const requester = row.getByRole('img', { name: '依頼者: 田中' });
    const assigned = row.getByRole('group', { name: `担当者: ${assignees.map(person => person.displayName).join('、')}` });
    await waitFor(() => expect(requester.querySelector('img')).toHaveAttribute('src', 'https://example.test/sender.png'));
    expect(requester.nextElementSibling).toHaveClass('lucide-arrow-right');
    expect(requester.nextElementSibling?.nextElementSibling).toBe(assigned);
    expect(assigned.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
    expect(within(assigned).getByLabelText('ほか3名')).toHaveTextContent('+3');
    expect(within(assigned).getByLabelText('ほか3名')).toHaveAttribute('title', 'ほか3名: 担当c、担当d、担当e');
    for (const person of assignees.slice(0, 3)) expect(within(assigned).getByLabelText(person.displayName)).toHaveAttribute('title', person.displayName);
    expect(requester).toHaveAttribute('title', '依頼者: 田中');
    expect(row.getByText('今日の準備').nextElementSibling).toHaveTextContent('期限 9/13');
    expect(row.getByText('今日の準備')).not.toHaveAttribute('style');
    expect(row.getByText('今日の準備')).toHaveClass('border-rose-200', 'bg-rose-50', 'text-rose-700');
    expect(row.getByText('確認依頼a').closest('p')).toContainElement(row.getByText('今日の準備'));
  });
  it('labels sample data and unavailable requester names without inventing names', () => {
    source.notifications = [{ ...readNotification, userId: 'someone' }];
    render(<NeoReviewRequests {...props} isSample members={[{ id: 'requester', displayName: '登録者', photoURL: 'https://example.test/registrant.png' }]} tasks={[task('a', { dueDate: null })]} />);
    const section = screen.getByRole('region', { name: '依頼内容' });
    expect(within(section).getByText('架空データ')).toBeVisible();
    const requester = within(section).getByRole('img', { name: '依頼者を確認' });
    expect(requester).toHaveAttribute('title', '依頼者を確認');
    expect(requester).toHaveTextContent('?');
    expect(requester.querySelector('img')).toBeNull();
    expect(within(section).queryByRole('img', { name: '依頼者: 登録者' })).not.toBeInTheDocument();
    expect(within(section).getByText('期限なし')).toBeVisible();
    expect(screen.queryByText('田中さんから')).not.toBeInTheDocument();
  });

  it('shows the saved request content while keeping the task and notification unchanged', () => {
    const request = Object.freeze(task('a', { title: '確認依頼：古い見出し', description: '参加登録をお願いします。\n申込内容は添付をご確認ください。' }));
    render(<NeoReviewRequests {...props} tasks={[request]} />);
    expect(screen.getByRole('link', { name: /参加登録をお願いします。 申込内容は添付をご確認ください。/ })).toHaveAttribute('href', '/projects/p/board?task=a');
    expect(screen.queryByText('確認依頼：古い見出し')).not.toBeInTheDocument();
    expect(request.title).toBe('確認依頼：古い見出し');
    expect(request.description).toContain('\n');
    expect(source.markAsRead).not.toHaveBeenCalled();
  });
});
