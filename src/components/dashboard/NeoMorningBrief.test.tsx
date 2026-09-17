import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeoMorningBrief } from './NeoMorningBrief';
import { viewTask } from '@/test/taskViewFixtures';
import type { Notification } from '@/types';

const source = vi.hoisted(() => ({ notifications: [] as Notification[], isLoading: false, error: null as Error | null }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => source }));
vi.mock('./NeoCalendar', () => ({ NeoCalendar: () => <div>今日の予定</div> }));
const props = { tasks: [{ ...viewTask({ assigneeIds: ['me'], dueDate: new Date(), dependsOnTaskIds: ['not-fetched'] }), projectName: '展示会' }], userId: 'me', isLoading: false, error: null, projectTaskStatus: new Map([['project-1', { status: 'ready' as const }]]) };
beforeEach(() => { source.notifications = []; source.isLoading = false; source.error = null; });
afterEach(() => vi.unstubAllGlobals());

describe('NeoMorningBrief source boundaries', () => {
  it('shows unresolved prerequisite evidence next to the due task, then follows shared completion', () => {
    const { rerender } = render(<NeoMorningBrief {...props} />);
    expect(screen.getByText('前提は未確認（参照先を取得できません）')).toBeVisible();
    expect(within(screen.getByRole('region', { name: '期限に影響する待ち・詰まり' })).queryByRole('link')).not.toBeInTheDocument();
    rerender(<NeoMorningBrief {...props} tasks={props.tasks.map(task => ({ ...task, isCompleted: true }))} />);
    expect(screen.queryByText('出展準備')).not.toBeInTheDocument();
  });
  it('labels overdue, due-today, and active-period rows with text and preserves stored progress and dates', () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const tasks = [
      { ...props.tasks[0], id: 'overdue', title: '期限超過作業', dueDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), parentTitle: '親作業' },
      { ...props.tasks[0], id: 'today', title: '今日まで作業', dueDate: today },
      { ...props.tasks[0], id: 'started', title: '着手中の作業', startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2), dueDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), workProgress: 'started' as const },
      { ...props.tasks[0], id: 'not-started', title: '未着手の作業', startDate: start, dueDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2), workProgress: 'not_started' as const },
    ];
    const before = structuredClone(tasks);
    render(<NeoMorningBrief {...props} tasks={tasks} />);
    const brief = within(screen.getByRole('region', { name: '今日の仕事・期限' }));
    const deadlines = within(brief.getByRole('region', { name: '期限' }));
    const overdue = deadlines.getByRole('link', { name: /期限超過作業/ });
    expect(overdue).toHaveTextContent('期限超過');
    expect(overdue).toHaveTextContent('親作業');
    expect(overdue).not.toHaveTextContent('親:');
    expect(deadlines.getByRole('link', { name: /今日まで作業/ })).toHaveTextContent('今日が期限');
    const active = within(brief.getByRole('region', { name: '作業期間中' }));
    const started = active.getByRole('link', { name: /着手中の作業/ });
    const notStarted = active.getByRole('link', { name: /未着手の作業/ });
    expect(started).toHaveTextContent('着手中');
    expect(within(started).getAllByText('着手中')).toHaveLength(1);
    expect(within(started).queryByText('着手', { exact: true })).not.toBeInTheDocument();
    expect(notStarted).toHaveTextContent('未着手');
    expect(within(notStarted).getAllByText('未着手')).toHaveLength(1);
    expect(tasks).toEqual(before);
  });
  it('labels automatic all-person checks and keeps unavailable evidence as unconfirmed in the existing task row', () => {
    source.notifications = [{ id: 'auto', userId: 'me', type: 'due_reminder', title: '全員分の完了をまだ確認できません', message: '完了が未確認です。', projectId: 'project-1', taskId: 'task-1', isRead: false, createdAt: new Date(), data: { automation: true, pending: [{ taskId: 'missing', assigneeId: 'other', check: 'unavailable' }] } }];
    const { rerender } = render(<NeoMorningBrief {...props} />);
    expect(screen.getAllByText('出展準備')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '全員分の確認状況（自動確認）' })).toHaveAttribute('href', '/projects/project-1/board?task=task-1');
    expect(screen.queryByText(/メンバーから/)).not.toBeInTheDocument(); expect(screen.queryByText(/未購入/)).not.toBeInTheDocument();
    rerender(<NeoMorningBrief {...props} tasks={props.tasks.map(task => ({ ...task, taskKind: 'review_request', createdBy: 'other' }))} />);
    expect(screen.getAllByText('出展準備')).toHaveLength(1); expect(screen.getByText('全員分の確認状況 · 自動確認')).toBeVisible();
    rerender(<NeoMorningBrief {...props} tasks={props.tasks.map(task => ({ ...task, isCompleted: true }))} />);
    expect(screen.queryByText(/全員分の確認状況/)).not.toBeInTheDocument();
  });
  it('shows assigned people and only configured priority while leaving fixed-deadline editing data untouched', async () => {
    vi.stubGlobal('Image', class extends EventTarget { src = ''; complete = true; naturalWidth = 1; });
    const task = { ...props.tasks[0], assigneeIds: ['me', 'colleague'], priority: 'high' as const, isDueDateFixed: true };
    const before = structuredClone(task);
    const { rerender } = render(<NeoMorningBrief {...props} tasks={[task]} members={[{ id: 'me', displayName: '本人', photoURL: 'https://example.test/person.png' }, { id: 'colleague', displayName: '同僚' }]} />);
    const row = screen.getByRole('link', { name: /出展準備/ });
    const assignees = within(row).getByRole('group', { name: '担当者: 本人、同僚' });
    expect(assignees).toBeVisible();
    assignees.querySelectorAll('[data-slot="avatar"]').forEach(avatar => expect(avatar).toHaveClass('h-6', 'w-6', 'border-2'));
    expect(within(row).getByLabelText('優先度: 高')).toHaveTextContent('高');
    expect(within(row).queryByText('優先度')).not.toBeInTheDocument();
    const prioritySlot = row.firstElementChild?.lastElementChild;
    expect(prioritySlot).toContainElement(within(row).getByLabelText('優先度: 高'));
    expect(prioritySlot).toHaveClass('w-6', 'shrink-0');
    await waitFor(() => expect(row.querySelector('img')).toHaveAttribute('src', 'https://example.test/person.png'));
    expect(within(row).queryByText(/固定/)).not.toBeInTheDocument();
    expect(task).toEqual(before);
    rerender(<NeoMorningBrief {...props} tasks={[{ ...task, priority: null }]} />);
    expect(within(screen.getByRole('link', { name: /出展準備/ })).queryByText('優先度')).not.toBeInTheDocument();
    expect(prioritySlot).toBeEmptyDOMElement();
    expect(prioritySlot).toHaveAttribute('aria-hidden', 'true');
    expect(row.firstElementChild?.lastElementChild).toBe(prioritySlot);
  });
  it('shows only the selected teammate’s work and explains the assignee scope', () => {
    const colleagueTask = { ...viewTask({ id: 'colleague-task', title: '同僚の仕事', assigneeIds: ['colleague'], dueDate: new Date() }), projectName: '展示会' };
    render(<NeoMorningBrief {...props} tasks={[props.tasks[0], colleagueTask]} members={[{ id: 'colleague', displayName: '同僚' }]} assigneeFilterId="colleague" assigneeFilterName="同僚" />);
    expect(screen.getByRole('link', { name: /同僚の仕事/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /出展準備/ })).not.toBeInTheDocument();
    expect(screen.getByText(/担当者「同僚」の仕事を表示/)).toBeVisible();
  });
  it('caps Neo assignees at five and keeps a list without task priority neutral before the deadline', () => {
    const members = ['me', 'a', 'b', 'c', 'd', 'e'].map(id => ({ id, displayName: `担当${id}` }));
    const task = { ...props.tasks[0], assigneeIds: members.map(person => person.id), listName: '今週の準備', listColor: '#2563eb', priority: null };
    const before = structuredClone(task);
    const { rerender } = render(<NeoMorningBrief {...props} tasks={[task]} members={members} />);
    const row = within(screen.getByRole('link', { name: /出展準備/ }));
    const assigned = row.getByRole('group', { name: `担当者: ${members.map(person => person.displayName).join('、')}` });
    expect(assigned.querySelectorAll('[data-slot="avatar"]')).toHaveLength(5);
    expect(within(assigned).getByLabelText('ほか1名')).toHaveTextContent('+1');
    expect(row.getByText('今週の準備').nextElementSibling).toHaveTextContent('期限');
    expect(row.getByText('今週の準備').parentElement).toHaveClass('gap-x-2');
    expect(row.getByText('出展準備').closest('p')).toHaveClass('gap-x-3');
    expect(row.getByText('今週の準備')).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(row.getByText('今週の準備')).not.toHaveAttribute('style');
    expect(row.getByText('出展準備').closest('p')).toContainElement(row.getByText('今週の準備'));
    expect(task).toEqual(before);
    rerender(<NeoMorningBrief {...props} tasks={[{ ...task, listName: undefined }]} members={members} />);
    expect(screen.queryByText('今週の準備')).not.toBeInTheDocument();
    expect(screen.queryByText(/リスト未取得|未分類/)).not.toBeInTheDocument();
  });
  it.each([['low', '低'], ['medium', '中'], ['high', '高']] as const)('shows the existing %s priority as a compact badge', (priority, label) => {
    render(<NeoMorningBrief {...props} tasks={[{ ...props.tasks[0], priority }]} />);
    const row = within(screen.getByRole('link', { name: /出展準備/ }));
    expect(row.getByLabelText(`優先度: ${label}`)).toHaveTextContent(label);
    expect(row.queryByText('優先度')).not.toBeInTheDocument();
  });
  it('uses the linked task assignees and priority for a standalone personal call', () => {
    source.notifications = [{ id: 'call', userId: 'me', type: 'task_bell', title: '状況の確認', message: '', projectId: 'project-1', taskId: 'task-1', senderId: 'colleague', isRead: false, createdAt: new Date(), data: {} }];
    render(<NeoMorningBrief {...props} tasks={[{ ...props.tasks[0], dueDate: null, priority: 'low', dependsOnTaskIds: [] }]} members={[{ id: 'me', displayName: '本人' }]} />);
    const call = within(screen.getByRole('region', { name: '返答・確認' }));
    expect(call.getByRole('group', { name: '担当者: 本人' })).toBeVisible();
    expect(call.getByText('低')).toBeVisible();
    expect(call.getAllByRole('link')).toHaveLength(1);
  });
  it('does not expose failed project work in all-people mode', () => {
    render(<NeoMorningBrief {...props} taskScope="all" tasks={[...props.tasks, { ...props.tasks[0], id: 'failed', projectId: 'denied', title: '取得不可の作業', assigneeIds: ['colleague'] }]}
      error={new Error('permission')} projectTaskStatus={new Map([['project-1', { status: 'ready' }], ['denied', { status: 'error', error: new Error('permission') }]])} />);
    expect(screen.getByText('出展準備')).toBeVisible();
    expect(screen.queryByText('取得不可の作業')).not.toBeInTheDocument();
  });
  it('does not show failed project snapshots or call failed notifications empty', () => {
    source.error = new Error('permission');
    render(<NeoMorningBrief {...props} error={new Error('task denied')} projectTaskStatus={new Map([['project-1', { status: 'error', error: new Error('denied') }]])} />);
    expect(screen.queryByText('出展準備')).not.toBeInTheDocument();
    expect(screen.getAllByText('取得できた範囲にはありません。未取得の仕事は未確認です。').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('呼びかけの通知を取得できません。')).toBeVisible();
  });
});


describe('NeoMorningBrief task visibility', () => {
  it.each([10, 11])('keeps all %i deadline tasks visible without a collapse control', count => {
    const tasks = Array.from({ length: count }, (_, index) => ({
      ...viewTask({ id: `today-${index + 1}`, title: `今日の仕事 ${String(index + 1).padStart(2, '0')}`, assigneeIds: ['me'], dueDate: new Date() }),
      projectName: '展示会',
    }));
    render(<NeoMorningBrief {...props} tasks={tasks} />);
    const section = within(within(screen.getByRole('region', { name: '今日の仕事・期限' })).getByRole('region', { name: '期限' }));
    expect(section.getByText(`${count}件`)).toBeVisible();
    for (const task of tasks) expect(section.getByText(task.title)).toBeVisible();
    expect(section.queryByText(/ほか.*件を見る/)).not.toBeInTheDocument();
    if (count === 11) expect(section.getByRole('link', { name: /今日の仕事 11/ })).toHaveAttribute('href', '/projects/project-1/board?task=today-11');
    expect(section.getByRole('list')).toHaveClass('pb-4');
  });
  it('keeps all deadline blockers visible with the same section end spacing', () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      ...viewTask({ id: `waiting-${index + 1}`, title: `待ちの仕事 ${index + 1}`, assigneeIds: ['me'], priority: 'high', dependsOnTaskIds: ['not-fetched'] }),
      projectName: '展示会',
    }));
    render(<NeoMorningBrief {...props} tasks={tasks} />);
    const section = within(screen.getByRole('region', { name: '期限に影響する待ち・詰まり' }));
    for (const task of tasks) expect(section.getByText(task.title)).toBeVisible();
    expect(section.queryByText(/ほか.*件を見る/)).not.toBeInTheDocument();
    expect(section.getByRole('list')).toHaveClass('pb-4');
  });
});
