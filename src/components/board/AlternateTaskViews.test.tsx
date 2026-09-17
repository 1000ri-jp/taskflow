import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTableView } from './TaskTableView';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskOutlineView } from './TaskOutlineView';
import { AlternateTaskViews } from './AlternateTaskViews';
import { getTaskChecklists, getUsersByIds } from '@/lib/firebase/firestore';
import { useChecklistAssigneeStore } from '@/stores/checklistAssigneeStore';
import { MOAI_LABEL_ID } from '@/lib/task/moaiLabel';
import { viewList, viewTask } from '@/test/taskViewFixtures';

vi.mock('@/lib/firebase/firestore', () => ({ getTaskChecklists: vi.fn(), getUsersByIds: vi.fn().mockResolvedValue([]) }));
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
const calendarTransfer = () => {
  const data = new Map<string, string>();
  return { effectAllowed: 'none', dropEffect: 'none', setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '' };
};
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); useChecklistAssigneeStore.setState({ byItem: {}, hydrated: false, persistenceFailed: false }); });
afterEach(() => vi.useRealTimers());

describe('table view', () => {
  it('sorts locally, displays status independently of list, and opens the original task', () => {
    const open = vi.fn();
    const tasks = [viewTask({ id: 'late', title: '後の締切', dueDate: new Date(2026, 8, 13), isCompleted: true, assigneeIds: ['u'] }), viewTask({ id: 'early', title: '先の締切', dueDate: new Date(2026, 8, 3) })];
    render(<TaskTableView tasks={tasks} lists={[viewList()]} names={{ u: 'Kozue' }} onTaskClick={open} />);
    const rows = () => screen.getAllByRole('row').slice(1);
    expect(rows()[0]).toHaveTextContent('先の締切');
    expect(rows()[1]).toHaveTextContent('完了');
    expect(rows()[1]).toHaveTextContent('東京ゲームダンジョン');
    expect(within(rows()[1]).getByRole('group', { name: '担当者: Kozue' })).toBeVisible();
    expect(rows()[1]).not.toHaveTextContent('Kozue');
    fireEvent.click(screen.getByRole('button', { name: '期限' }));
    expect(screen.getByRole('columnheader', { name: '期限' })).toHaveAttribute('aria-sort', 'descending');
    expect(rows()[0]).toHaveTextContent('後の締切');
    fireEvent.click(screen.getByRole('button', { name: '先の締切' }));
    expect(open).toHaveBeenCalledWith('early');
    expect(tasks[0].id).toBe('late');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('shows an empty filtered state', () => {
    render(<TaskTableView tasks={[]} lists={[]} names={{}} onTaskClick={vi.fn()} />);
    expect(screen.getByText('表示条件に合うタスクはありません。')).toBeInTheDocument();
  });
});

describe('outline view', () => {
  it('keeps confirmation requests out of the subtask hierarchy', () => {
    const parent=viewTask();const review=viewTask({id:'review',parentTaskId:parent.id,taskKind:'review_request'});
    render(<TaskOutlineView projectId="project-1" viewerId="u" tasks={[parent,review]} lists={[viewList()]} names={{}} onTaskClick={vi.fn()} />);
    expect(screen.queryByText('サブタスク 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'出展準備のサブタスクを展開'})).not.toBeInTheDocument();
  });
  it('expands actual child tasks in place and opens the selected child without loading checklists', () => {
    const parent = viewTask();
    const child = viewTask({id:'child',title:'発送準備',parentTaskId:parent.id,assigneeIds:['kozue']});
    const open = vi.fn();
    render(<TaskOutlineView viewerId="u" projectId="project-1" tasks={[parent,child]} lists={[viewList()]} names={{kozue:'Kozue'}} onTaskClick={open} />);
    expect(screen.queryByRole('button',{name:'発送準備'})).not.toBeInTheDocument();
    const toggle = screen.getByRole('button',{name:'出展準備のサブタスクを展開'});
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('button',{name:'発送準備'})).toBeVisible();
    expect(screen.getByRole('group',{name:'担当者: Kozue'})).toBeVisible();
    expect(getTaskChecklists).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'発送準備'}));
    expect(open).toHaveBeenCalledWith('child');
    fireEvent.click(toggle);
    expect(screen.queryByRole('button',{name:'発送準備'})).not.toBeInTheDocument();
  });
  it('does not add a meaningless expansion control to tasks with no children', () => {
    const open=vi.fn();
    render(<TaskOutlineView viewerId="u" projectId="project-1" tasks={[viewTask()]} lists={[viewList()]} names={{}} onTaskClick={open} />);
    expect(screen.queryByRole('button',{name:/を展開/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'出展準備'}));
    expect(open).toHaveBeenCalledWith('task-1');
    expect(getTaskChecklists).not.toHaveBeenCalled();
  });
  it('resolves project members even if they only have checklist assignments', async () => {
    render(<QueryClientProvider client={client()}><AlternateTaskViews view="outline" viewerId="u" projectId="project-1" projectMemberIds={['checklist-only']} tasks={[viewTask({ assigneeIds: ['historical-member'] })]} lists={[viewList()]} onTaskClick={vi.fn()} /></QueryClientProvider>);
    await screen.findByRole('group', { name: '担当者: 名前未取得' });
    expect(getUsersByIds).toHaveBeenCalledWith(['checklist-only', 'historical-member']);
  });

  it('shows outline assignees as icons without rendering their names', async () => {
    vi.mocked(getUsersByIds).mockResolvedValueOnce([{ id: 'u', displayName: 'Kozue', photoURL: 'https://example.com/avatar.png' } as never]);
    render(<QueryClientProvider client={client()}><AlternateTaskViews view="outline" viewerId="u" projectId="project-1" projectMemberIds={['u']} tasks={[viewTask({ assigneeIds: ['u'] })]} lists={[viewList()]} onTaskClick={vi.fn()} /></QueryClientProvider>);
    const assignees = await screen.findByTestId('task-assignees-icons');
    expect(assignees).toHaveAttribute('aria-label', '担当者: Kozue');
    expect(assignees).not.toHaveTextContent('Kozue');
    expect(screen.queryByText('Kozue')).not.toBeInTheDocument();
  });
});

describe('calendar view', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 3, 12)); });
  it('resolves calendar assignees once, keeps completed avatars compact, and retains context on hover', async () => {
    vi.mocked(getUsersByIds).mockResolvedValueOnce(['a', 'b', 'c'].map(id => ({ id, displayName: `担当${id}` } as never)));
    const task = viewTask({ title: '確認完了', assigneeIds: ['a', 'b', 'c'], startDate: new Date(2026, 8, 3), dueDate: new Date(2026, 8, 13), isCompleted: true, parentTaskId: 'parent' });
    const open = vi.fn();
    const props = { view: 'calendar' as const, viewerId: 'a', projectId: 'project-1', projectMemberIds: ['a'], tasks: [task], allTasks: [viewTask({ id: 'parent', title: '出展の準備' }), task], lists: [viewList()], onTaskClick: open };
    const { rerender } = render(<AlternateTaskViews {...props} />);
    await screen.findAllByRole('group', { name: '担当者: 担当a、担当b、担当c' });
    const entry = within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: '開始 完了 確認完了' });
    expect(within(entry).getByText('確認完了')).toHaveClass('line-through');
    expect(entry.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
    expect(within(entry).queryByText('+1')).not.toBeInTheDocument();
    expect(entry).not.toHaveTextContent('東京ゲームダンジョン');
    expect(within(entry).getAllByText('出展の準備')).toHaveLength(1);
    expect(entry).toHaveTextContent('出展の準備 · 開始 · 完了');
    fireEvent.focus(entry);
    const preview = await screen.findByRole('tooltip');
    expect(preview).toHaveTextContent('東京ゲームダンジョン');
    expect(preview).toHaveTextContent('親タスク出展の準備');
    expect(preview).toHaveTextContent('担当a・担当b・担当c');
    expect(preview).toHaveTextContent('2026/9/3');
    expect(preview).toHaveTextContent('2026/9/13');
    fireEvent.click(entry);
    expect(open).toHaveBeenCalledWith(task.id);
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    rerender(<AlternateTaskViews {...props} tasks={[{ ...task }]} />);
    expect(getUsersByIds).toHaveBeenCalledExactlyOnceWith(['a', 'b', 'c']);
  });

  it('keeps dated tasks accessible when assignee reads fail and allows retry', async () => {
    vi.mocked(getUsersByIds).mockRejectedValueOnce(new Error('denied'));
    render(<AlternateTaskViews view="calendar" viewerId="u" projectId="project-1" projectMemberIds={['u']} tasks={[viewTask({ assigneeIds: ['u'], dueDate: new Date(2026, 8, 3) })]} lists={[viewList()]} onTaskClick={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('担当者名を取得できません');
    expect(screen.getByRole('button', { name: '期限 未完了 出展準備' })).toBeVisible();
    vi.mocked(getUsersByIds).mockResolvedValueOnce([{ id: 'u', displayName: 'Kozue' } as never]);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('group', { name: '担当者: Kozue' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows actual date markers, navigates month/week, and opens tasks without mutations', () => {
    const open = vi.fn();
    const tasks = [viewTask({ title: '出展情報', startDate: new Date(2026, 8, 3), dueDate: new Date(2026, 8, 13) }), viewTask({ id: 'none', title: '日付なし' })];
    render(<TaskCalendarView tasks={tasks} lists={[viewList()]} onTaskClick={open} />);
    expect(screen.getByRole('heading', { name: '2026年9月' })).toBeInTheDocument();
    const day = screen.getByRole('region', { name: '2026年9月3日' });
    fireEvent.click(within(day).getByRole('button', { name: /開始\s*未完了\s*出展情報/ }));
    expect(open).toHaveBeenCalledWith('task-1');
    expect(within(screen.getByRole('region', { name: '2026年9月13日' })).getByText('期限')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今日' }));
    fireEvent.click(screen.getByRole('button', { name: '週' }));
    expect(screen.getByRole('heading', { name: '2026/8/31〜9/6' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の週' }));
    expect(screen.getByRole('heading', { name: '2026/9/7〜9/13' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    fireEvent.click(screen.getByRole('button', { name: /日付なし/ }));
    expect(open).toHaveBeenLastCalledWith('none');
  });
  it('labels completed and incomplete calendar tasks with text and icons while keeping both clickable', () => {
    const open = vi.fn();
    const completed = viewTask({ id: 'completed', title: '提出書類', dueDate: new Date(2026, 8, 3), isCompleted: true });
    const incomplete = viewTask({ id: 'incomplete', title: '確認資料', dueDate: new Date(2026, 8, 3) });
    render(<TaskCalendarView tasks={[completed, incomplete]} lists={[viewList()]} onTaskClick={open} />);
    const day = screen.getByRole('region', { name: '2026年9月3日' });
    const completedEntry = within(day).getByRole('button', { name: '期限 完了 提出書類' });
    const incompleteEntry = within(day).getByRole('button', { name: '期限 未完了 確認資料' });

    expect(within(completedEntry).getByText('完了')).toBeVisible();
    expect(within(completedEntry).getByText('提出書類')).toHaveClass('line-through');
    expect(within(incompleteEntry).getByText('未完了')).toBeVisible();
    expect(within(incompleteEntry).getByText('確認資料')).not.toHaveClass('line-through');

    fireEvent.click(completedEntry);
    fireEvent.click(incompleteEntry);
    expect(open).toHaveBeenNthCalledWith(1, 'completed');
    expect(open).toHaveBeenNthCalledWith(2, 'incomplete');
  });
  it('keeps crowded dates expandable instead of losing tasks', () => {
    render(<TaskCalendarView tasks={Array.from({ length: 5 }, (_, i) => viewTask({ id: `t${i}`, title: `準備${i}`, dueDate: new Date(2026, 8, 3) }))} lists={[viewList()]} onTaskClick={vi.fn()} />);
    const day = screen.getByRole('region', { name: '2026年9月3日' });
    const more = within(day).getByText('他2件');
    expect(more.closest('details')).not.toHaveAttribute('open');
    expect(within(more.closest('details')!).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(more);
    expect(more.closest('details')).toHaveAttribute('open');
    expect(within(day).getAllByRole('button')).toHaveLength(5);
  });
  it('excludes completed undated tasks while retaining the order and source tasks', () => {
    const tasks = [viewTask({ id: 'done-1', title: '完了その1', isCompleted: true }), viewTask({ id: 'open-1', title: '未完了その1' }), viewTask({ id: 'done-2', title: '完了その2', isCompleted: true }), viewTask({ id: 'open-2', title: '未完了その2' })];
    render(<TaskCalendarView tasks={tasks} lists={[viewList()]} onTaskClick={vi.fn()} />);
    const summary = screen.getByText('日付未設定（2件）');
    fireEvent.click(summary);
    expect(within(summary.closest('details')!).getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('未完了その1'), expect.stringContaining('未完了その2'),
    ]);
    expect(tasks.map(task => task.id)).toEqual(['done-1', 'open-1', 'done-2', 'open-2']);
  });
  it('assigns an undated task a deadline exactly once and suppresses drag clicks without creating a task', async () => {
    let finish!: () => void;
    const change = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const open = vi.fn(); const add = vi.fn();
    const task = viewTask({ title: '日付を決める' });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={open} onDateChange={change} onAddTask={add} />);
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    const source = screen.getByRole('button', { name: /日付を決める/ });
    const target = screen.getByRole('region', { name: '2026年9月8日' });
    const dataTransfer = calendarTransfer();
    expect(source).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
    fireEvent.click(target);
    expect(change).toHaveBeenCalledExactlyOnceWith(task, '期限', new Date(2026, 8, 8));
    expect(screen.getByRole('status')).toHaveTextContent('日付を保存中');
    expect(open).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '新しいタスクのタイトル' })).not.toBeInTheDocument();
    expect(task.dueDate).toBeNull();
    finish();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
  it('cancels an undated drag without saving and lets the next deliberate click open the original task', () => {
    const change = vi.fn(); const open = vi.fn();
    const task = viewTask({ id: 'undated-child', title: '日付なしの子', parentTaskId: 'parent' });
    render(<TaskCalendarView tasks={[task]} allTasks={[viewTask({ id: 'parent', title: '元の親' }), task]} lists={[viewList()]} onTaskClick={open} onDateChange={change} />);
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    const source = screen.getByRole('button', { name: /日付なしの子/ });
    const dataTransfer = calendarTransfer();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
    fireEvent.drop(screen.getByRole('region', { name: '2026年9月8日' }), { dataTransfer });
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerDown(source);
    fireEvent.click(source);
    expect(open).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(source).toHaveTextContent('親：元の親');
  });
  it('keeps read-only undated tasks openable without offering a drag or accepting external drops', () => {
    const open = vi.fn();
    render(<TaskCalendarView tasks={[viewTask({ title: '閲覧用' })]} lists={[viewList()]} onTaskClick={open} />);
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    const source = screen.getByRole('button', { name: /閲覧用/ });
    expect(source).toHaveAttribute('draggable', 'false');
    expect(screen.queryByText(/ドラッグすると、期限/)).not.toBeInTheDocument();
    const dataTransfer = calendarTransfer();
    fireEvent.dragStart(source, { dataTransfer });
    expect(dataTransfer.getData('application/x-taskflow-calendar')).toBe('');
    fireEvent.click(source);
    expect(open).toHaveBeenCalledExactlyOnceWith('task-1');
  });
  it.each(['removed', 'archived', 'completed', 'other-project', 'read-only'] as const)('ignores an undated drop if the current source becomes %s during the drag', changed => {
    const change = vi.fn(); const task = viewTask({ title: '途中で変わる' });
    const props = { tasks: [task], lists: [viewList()], onTaskClick: vi.fn(), onDateChange: change };
    const { rerender } = render(<TaskCalendarView {...props} />);
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    const dataTransfer = calendarTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: /途中で変わる/ }), { dataTransfer });
    rerender(<TaskCalendarView {...props} tasks={changed === 'removed' ? [] : [{ ...task, isArchived: changed === 'archived', isCompleted: changed === 'completed', projectId: changed === 'other-project' ? 'other' : task.projectId }]} onDateChange={changed === 'read-only' ? undefined : change} />);
    fireEvent.drop(screen.getByRole('region', { name: '2026年9月8日' }), { dataTransfer });
    expect(change).not.toHaveBeenCalled();
  });
  it('rejects payloads that were not dragged from the current calendar or do not match the source', () => {
    const change = vi.fn(); const task = viewTask({ title: '元タスク' });
    render(<TaskCalendarView tasks={[task, viewTask({ id: 'other', title: '別タスク' })]} lists={[viewList()]} onTaskClick={vi.fn()} onDateChange={change} />);
    fireEvent.click(screen.getByText('日付未設定（2件）'));
    const target = screen.getByRole('region', { name: '2026年9月8日' });
    const dataTransfer = calendarTransfer();
    dataTransfer.setData('application/x-taskflow-calendar', JSON.stringify({ taskId: task.id, kind: '期限' }));
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragStart(screen.getByRole('button', { name: /元タスク/ }), { dataTransfer });
    dataTransfer.setData('application/x-taskflow-calendar', JSON.stringify({ taskId: 'other', kind: '期限' }));
    fireEvent.drop(target, { dataTransfer });
    expect(change).not.toHaveBeenCalled();
  });
  it('retains the undated task and reports a failed save, then allows a fresh drag to retry', async () => {
    const change = vi.fn().mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(undefined);
    const task = viewTask({ title: '保存を再試行' });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={vi.fn()} onDateChange={change} />);
    fireEvent.click(screen.getByText('日付未設定（1件）'));
    const source = screen.getByRole('button', { name: /保存を再試行/ });
    const target = screen.getByRole('region', { name: '2026年9月8日' });
    const dataTransfer = calendarTransfer();
    fireEvent.dragStart(source, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); fireEvent.dragEnd(source, { dataTransfer });
    expect(await screen.findByRole('alert')).toHaveTextContent('日付を保存できませんでした');
    expect(source).toBeVisible();
    expect(task.dueDate).toBeNull();
    expect(within(target).queryByRole('button', { name: /保存を再試行/ })).not.toBeInTheDocument();
    fireEvent.pointerDown(source); fireEvent.dragStart(source, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(2);
  });
  it('moves the dragged date marker to a calendar day and keeps its date kind', async () => {
    const onDateChange = vi.fn();
    const task = viewTask({ title: '日付を動かす', startDate: new Date(2026, 8, 3), dueDate: new Date(2026, 8, 13) });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={vi.fn()} onDateChange={onDateChange} />);
    const entry = within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: /開始\s*未完了\s*日付を動かす/ });
    fireEvent.dragStart(entry, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    const target = screen.getByRole('region', { name: '2026年9月8日' });
    fireEvent.drop(target, { dataTransfer: { getData: (type: string) => type === 'application/x-taskflow-calendar' ? JSON.stringify({ taskId: task.id, kind: '開始' }) : '' } });
    expect(onDateChange).toHaveBeenCalledWith(task, '開始', new Date(2026, 8, 8));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
  it('suppresses the synthetic click after dragging but keeps normal clicks', () => {
    const open = vi.fn();
    const task = viewTask({ title: 'クリック確認', dueDate: new Date(2026, 8, 3) });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={open} onDateChange={vi.fn()} />);
    const entry = within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: /期限\s*未完了\s*クリック確認/ });
    fireEvent.dragStart(entry, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.click(entry);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(entry);
    expect(open).toHaveBeenCalledWith(task.id);
  });
  it('closes the dated task popup without creating a task when cancelled', () => {
    const add = vi.fn();
    render(<TaskCalendarView tasks={[]} lists={[viewList({ id: 'list-1', name: '準備' })]} onTaskClick={vi.fn()} onAddTask={add} />);
    fireEvent.click(screen.getByRole('region', { name: '2026年9月8日' }));
    const dialog = screen.getByRole('dialog', { name: '2026年9月8日にタスクを追加（期限）' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('opens a dated task form from an empty day and keeps task clicks separate', async () => {
    const open = vi.fn();
    const add = vi.fn().mockResolvedValue(undefined);
    const task = viewTask({ title: '既存タスク', dueDate: new Date(2026, 8, 3) });
    render(<TaskCalendarView tasks={[task]} lists={[viewList({ id: 'list-1', name: '準備' })]} onTaskClick={open} onAddTask={add} />);
    expect(screen.getByText(/タスク追加ポップアップが開きます。/)).toBeInTheDocument();
    const day = screen.getByRole('region', { name: '2026年9月8日' });
    fireEvent.click(day);
    const dialog = screen.getByRole('dialog', { name: '2026年9月8日にタスクを追加（期限）' });
    expect(dialog).toBeVisible();
    await userEvent.setup().type(within(dialog).getByRole('textbox', { name: '新しいタスクのタイトル' }), '追加タスク');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('list-1', '追加タスク', new Date(2026, 8, 8), []));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: /期限\s*未完了\s*既存タスク/ }));
    expect(open).toHaveBeenCalledWith(task.id);
  });
});


it('hides the Moai badge while retaining other labels and tags in calendar entries and undated tasks', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026,8,16));
  const label={id:MOAI_LABEL_ID,projectId:'project-1',name:'モアイ',color:'#64748b',createdAt:new Date()};
  const otherLabel={...label,id:'category',name:'確認待ち',color:'#0f766e'};
  const tag={...label,id:'work',name:'制作',order:0};
  const tasks=[viewTask({id:'dated',title:'日付あり',dueDate:new Date(2026,8,16),labelIds:[MOAI_LABEL_ID,'category'],tagIds:['work']}),viewTask({id:'undated',title:'日付なし',labelIds:[MOAI_LABEL_ID,'category']})];
  render(<TaskCalendarView tasks={tasks} labels={[label,otherLabel,{...label,projectId:'other',name:'別案件のラベル'}]} tags={[tag]} lists={[viewList()]} onTaskClick={vi.fn()} />);
  const event=screen.getByRole('button',{name:'期限 未完了 日付あり'});
  expect(within(event).queryByText('モアイ')).not.toBeInTheDocument();
  expect(within(event).getByText('確認待ち')).toBeVisible();
  expect(within(event).getByText('制作')).toBeVisible();
  fireEvent.click(screen.getByText('日付未設定（1件）'));
  const undated=screen.getByRole('button',{name:/日付なし/});
  expect(within(undated).queryByText('モアイ')).not.toBeInTheDocument();
  expect(within(undated).getByText('確認待ち')).toBeVisible();
  expect(screen.queryByText('別案件のラベル')).not.toBeInTheDocument();
});

vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'project-1', memberIds: ['user-1'], defaultAssigneeId: null }, isLoading: false, error: null }) }));
