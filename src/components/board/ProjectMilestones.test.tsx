import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectMilestones } from './ProjectMilestones';
import { TaskCalendarView } from './TaskCalendarView';
import { GanttChart } from '@/components/gantt/GanttChart';
import { viewList, viewTask } from '@/test/taskViewFixtures';
import type { Milestone } from '@/types';

const date = new Date(2026, 8, 10);
const milestone: Milestone = { id: 'm', projectId: 'project-1', title: '出展準備が整った', description: '持ち物と発送を確認', dueDate: date, status: 'planned', order: 0, achievedAt: null, createdBy: 'u', createdAt: date, updatedAt: date };
afterEach(() => vi.useRealTimers());
describe('milestones beside project views', () => {
  it('adds an exhibition date only on submit, keeping failed input for retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    const add = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('new-milestone');
    const select = vi.fn();
    render(<ProjectMilestones projectId="project-1" tasks={[]} milestones={[]} isLoading={false} error={false} selectedId="__new__" onSelect={select} onTaskClick={vi.fn()} onAdd={add} />);
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: '展示会 出展日' } });
    fireEvent.click(screen.getByRole('button', { name: '日付：未設定' }));
    fireEvent.click(screen.getByRole('button', { name: '2026年9月23日水曜日' }));
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('展示会 出展日');
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith('new-milestone'));
    expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ title: '展示会 出展日', description: '', kind: 'date', dueDate: new Date(2026, 8, 23) }));
  });
  it('shows conditions and unfinished linked tasks, including tasks from another list', () => {
    const onSelect = vi.fn(), onTaskClick = vi.fn();
    const tasks = [viewTask({ id: 'done', milestoneId: 'm', isCompleted: true }), viewTask({ id: 'remaining', title: '未発送', listId: 'another', milestoneId: 'm' })];
    render(<ProjectMilestones projectId="project-1" tasks={tasks} milestones={[milestone]} isLoading={false} error={false} selectedId="m" onSelect={onSelect} onTaskClick={onTaskClick} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('持ち物と発送を確認')).toBeVisible();
    expect(within(dialog).getByText('関連タスク · 完了 1/2件')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'すべての節目・編集' })).toHaveAttribute('href', '/projects/project-1/milestones');
    fireEvent.click(within(dialog).getByRole('button', { name: /未発送.*未完了/ }));
    expect(onTaskClick).toHaveBeenCalledWith('remaining');
    expect(onSelect).toHaveBeenCalledWith(null);
  });
  it('keeps undated milestones discoverable without inventing a date and distinguishes read failures', () => {
    const props = { projectId: 'p', tasks: [], milestones: [{ ...milestone, dueDate: null }], isLoading: false, error: false, selectedId: '__list__', onSelect: vi.fn(), onTaskClick: vi.fn() };
    const { rerender } = render(<ProjectMilestones {...props} />);
    expect(within(screen.getByRole('dialog')).getByText('期限未設定 · 予定')).toBeVisible();
    rerender(<ProjectMilestones {...props} milestones={[]} error />);
    expect(screen.queryByText('節目はまだありません。')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('取得できません');
  });
  it('renders dated flags in both calendar and gantt and opens the original milestone', () => {
    vi.useFakeTimers(); vi.setSystemTime(date);
    const open = vi.fn();
    const { unmount } = render(<TaskCalendarView tasks={[]} lists={[]} milestones={[milestone]} onMilestoneClick={open} onTaskClick={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('region', { name: '2026年9月10日' })).getByRole('button', { name: /出展準備が整った/ }));
    expect(open).toHaveBeenCalledWith('m');
    unmount();
    render(<GanttChart tasks={[]} lists={[]} labels={[]} milestones={[milestone]} onMilestoneClick={open} />);
    fireEvent.click(screen.getByRole('button', { name: '出展準備が整ったの節目 9/10' }));
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('groups same-day children while retaining their dates, list and parent under filtering', () => {
    vi.useFakeTimers(); vi.setSystemTime(date);
    const parent = viewTask({ id: 'parent', title: '持ち物準備', dueDate: new Date(2026, 8, 20) });
    const children = [viewTask({ id: 'a', parentTaskId: parent.id, title: '箱の確認', dueDate: date }), viewTask({ id: 'b', parentTaskId: parent.id, title: 'ラベルの確認', dueDate: date })];
    const open = vi.fn();
    render(<TaskCalendarView tasks={children} allTasks={[parent, ...children]} lists={[viewList()]} onTaskClick={open} />);
    const day = within(screen.getByRole('region', { name: '2026年9月10日' }));
    expect(day.getByTitle('東京ゲームダンジョン')).toHaveTextContent('持ち物準備');
    expect(day.queryByText('東京ゲームダンジョン')).not.toBeInTheDocument();
    expect(day.getByTitle('東京ゲームダンジョン')).toBeVisible();
    fireEvent.click(day.getByText('この日の開始・期限 2件'));
    fireEvent.click(day.getByRole('button', { name: /箱の確認/ }));
    expect(open).toHaveBeenCalledExactlyOnceWith('a');
    expect(day.getByRole('button', { name: /ラベルの確認/ })).toBeVisible();
    expect(within(screen.getByRole('region', { name: '2026年9月20日' })).queryByRole('button')).not.toBeInTheDocument();
  });
  it('uses the selected list when adding a calendar task without writing on form open', () => {
    vi.useFakeTimers(); vi.setSystemTime(date);
    const add = vi.fn();
    render(<TaskCalendarView tasks={[]} lists={[viewList(), viewList({ id: 'selected', name: '選択中のリスト' })]} selectedListId="selected" onTaskClick={vi.fn()} onAddTask={add} />);
    fireEvent.click(screen.getByRole('region', { name: '2026年9月10日' }));
    expect(screen.getByRole('combobox', { name: '追加先のリスト' })).toHaveValue('selected');
    expect(add).not.toHaveBeenCalled();
  });

});
