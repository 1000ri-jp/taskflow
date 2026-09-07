import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTableView } from './TaskTableView';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskOutlineView } from './TaskOutlineView';
import { AlternateTaskViews } from './AlternateTaskViews';
import { getTaskChecklists, getUsersByIds } from '@/lib/firebase/firestore';
import { useChecklistAssigneeStore } from '@/stores/checklistAssigneeStore';
import { viewList, viewTask } from '@/test/taskViewFixtures';

vi.mock('@/lib/firebase/firestore', () => ({ getTaskChecklists: vi.fn(), getUsersByIds: vi.fn().mockResolvedValue([]) }));
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
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
    expect(rows()[1]).toHaveTextContent('Kozue');
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
  it('nests shared review tasks once under their parent, but keeps a child visible when its parent is filtered out', () => {
    const open = vi.fn();
    const parent = viewTask();
    const child = viewTask({id:'child', title:'確認依頼：梱包状態',parentTaskId:parent.id, taskKind:'review_request', assigneeIds:['u']});
    const props = {viewerId:'u',projectId:'project-1', lists:[viewList()],names:{u:'Kozue'},onTaskClick:open};
    const {rerender} = render(<TaskOutlineView {...props} tasks={[parent,child]} />);
    expect(screen.getByText('共有の確認依頼・子タスク（1件）')).toBeInTheDocument();
    expect(screen.getAllByLabelText('TaskFlow 確認依頼中')).toHaveLength(2);
    expect(screen.getAllByLabelText('TaskFlow 確認依頼中')[0]).toHaveClass('bg-yellow-200', 'text-yellow-900');
    expect(screen.getAllByText('確認依頼中')).toHaveLength(2);
    expect(screen.getAllByRole('button',{name:child.title})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:child.title}));
    expect(open).toHaveBeenCalledWith('child');
    rerender(<TaskOutlineView {...props} tasks={[child]} />);
    expect(screen.getByRole('button',{name:child.title})).toBeInTheDocument();
  });
  it('loads checklists only on expansion, shows ordered real items and local assignees read-only', async () => {
    vi.mocked(getTaskChecklists).mockResolvedValue([{ id: 'c', taskId: 'task-1', title: '持ち物', order: 0, createdAt: new Date(), items: [{ id: 'second', text: '箱', isChecked: true, order: 1 }, { id: 'first', text: 'ケーブル', isChecked: false, order: 0 }] }]);
    useChecklistAssigneeStore.getState().setAssignees(['u', 'project-1', 'task-1', 'c', 'first'], ['kozue']);
    const open = vi.fn();
    render(<QueryClientProvider client={client()}><TaskOutlineView viewerId="u" projectId="project-1" tasks={[viewTask()]} lists={[viewList()]} names={{ kozue: 'Kozue' }} onTaskClick={open} /></QueryClientProvider>);
    expect(getTaskChecklists).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '出展準備のチェックリストを展開' }));
    expect(await screen.findByText('ケーブル')).toBeInTheDocument();
    expect(getTaskChecklists).toHaveBeenCalledWith('project-1', 'task-1');
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['ケーブル担当：Kozue（このブラウザ）', '箱']);
    const assignedItem = screen.getAllByRole('listitem')[0];
    expect(within(assignedItem).getByTitle('担当：Kozue（このブラウザ）')).not.toHaveClass('truncate', 'whitespace-nowrap');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '出展準備' }));
    expect(open).toHaveBeenCalledWith('task-1');
  });
  it('distinguishes fetch errors from no checklists and supports retry', async () => {
    vi.mocked(getTaskChecklists).mockRejectedValue(new Error('denied'));
    render(<QueryClientProvider client={client()}><TaskOutlineView viewerId="u" projectId="project-1" tasks={[viewTask()]} lists={[viewList()]} names={{}} onTaskClick={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '出展準備のチェックリストを展開' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('取得できません');
    expect(screen.queryByText(/チェックリストはありません/)).not.toBeInTheDocument();
    vi.mocked(getTaskChecklists).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText(/チェックリストはありません/)).toBeInTheDocument();
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
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 3, 12)); });
  it('shows actual date markers, navigates month/week, and opens tasks without mutations', () => {
    const open = vi.fn();
    const tasks = [viewTask({ title: '出展情報', startDate: new Date(2026, 8, 3), dueDate: new Date(2026, 8, 13) }), viewTask({ id: 'none', title: '日付なし' })];
    render(<TaskCalendarView tasks={tasks} lists={[viewList()]} onTaskClick={open} />);
    expect(screen.getByRole('heading', { name: '2026年9月' })).toBeInTheDocument();
    const day = screen.getByRole('region', { name: '2026年9月3日' });
    fireEvent.click(within(day).getByRole('button', { name: /開始\s*出展情報/ }));
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
  it('moves the dragged date marker to a calendar day and keeps its date kind', () => {
    const onDateChange = vi.fn();
    const task = viewTask({ title: '日付を動かす', startDate: new Date(2026, 8, 3), dueDate: new Date(2026, 8, 13) });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={vi.fn()} onDateChange={onDateChange} />);
    const entry = within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: /開始\s*日付を動かす/ });
    fireEvent.dragStart(entry, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    const target = screen.getByRole('region', { name: '2026年9月8日' });
    fireEvent.drop(target, { dataTransfer: { getData: (type: string) => type === 'application/x-taskflow-calendar' ? JSON.stringify({ taskId: task.id, kind: '開始' }) : '' } });
    expect(onDateChange).toHaveBeenCalledWith(task, '開始', new Date(2026, 8, 8));
  });
  it('suppresses the synthetic click after dragging but keeps normal clicks', () => {
    const open = vi.fn();
    const task = viewTask({ title: 'クリック確認', dueDate: new Date(2026, 8, 3) });
    render(<TaskCalendarView tasks={[task]} lists={[viewList()]} onTaskClick={open} onDateChange={vi.fn()} />);
    const entry = within(screen.getByRole('region', { name: '2026年9月3日' })).getByRole('button', { name: /期限\s*クリック確認/ });
    fireEvent.dragStart(entry, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.click(entry);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(entry);
    expect(open).toHaveBeenCalledWith(task.id);
  });
});
