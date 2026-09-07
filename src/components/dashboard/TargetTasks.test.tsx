import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { TARGET_TASK_STORAGE_KEY, useTargetTaskStore } from '@/stores/targetTaskStore';
import { TargetTasks } from './TargetTasks';

const task = { id: 't1', projectId: 'p1', projectName: '展示会', title: '出展の準備', dueDate: new Date(2026, 8, 23), completedAt: null, isCompleted: false, isAbandoned: false, isArchived: false } as DashboardTask;
const props = { month: '2026-09', project: { id: 'p1', name: '展示会' }, tasks: [task], isLoading: false, error: null as Error | null };
const open = () => fireEvent.click(screen.getByRole('button', { name: '展示会の的を選択' }));
describe('TargetTasks', () => {
  beforeEach(() => {
    localStorage.removeItem(TARGET_TASK_STORAGE_KEY);
    useTargetTaskStore.setState({ selections: [], persistenceFailed: false });
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 3, 12));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it('selects multiple project tasks, including completed and undated tasks, without changing them', () => {
    const tasks = [task, { ...task, id: 'done', title: '完了した準備', isCompleted: true, completedAt: new Date(2026, 8, 2), dueDate: null }, { ...task, id: 'foreign', projectId: 'p2', title: '別プロジェクト' }, { ...task, id: 'archived', isArchived: true, title: 'アーカイブ' }];
    const before = structuredClone(tasks);
    render(<TargetTasks {...props} tasks={tasks} />);
    open();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: '出展の準備' }));
    fireEvent.change(screen.getByRole('textbox', { name: '的にするタスクを検索' }), { target: { value: '完了した' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '完了した準備' }));
    expect(localStorage.getItem(TARGET_TASK_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 2 完了')).toBeVisible();
    expect(screen.getByRole('link', { name: /出展の準備/ })).toHaveAttribute('href', '/projects/p1/board?task=t1');
    expect(screen.getByText('期限 2026.9.23')).toBeVisible();
    expect(screen.getByText('期限なし')).toBeVisible();
    expect(screen.getByText('完了 9/2')).toBeVisible();
    expect(tasks).toEqual(before);
    cleanup(); useTargetTaskStore.setState({ selections: [] }); useTargetTaskStore.getState().hydrate();
    render(<TargetTasks {...props} tasks={tasks} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
  it('reflects live title, deadline, completion, reopening and cancellation changes without cached task data', () => {
    useTargetTaskStore.getState().save('2026-09', 'p1', ['t1']);
    const { rerender } = render(<TargetTasks {...props} />);
    rerender(<TargetTasks {...props} tasks={[{ ...task, title: '新しいタイトル', dueDate: new Date(2026, 8, 1) }]} />);
    expect(screen.queryByText('出展の準備')).not.toBeInTheDocument();
    expect(screen.getByText('期限 2026.9.1・期限超過')).toBeVisible();
    rerender(<TargetTasks {...props} tasks={[{ ...task, isCompleted: true, completedAt: new Date(2026, 8, 3) }]} />);
    expect(screen.getByText('1 / 1 完了')).toBeVisible();
    expect(screen.getByText('完了 9/3')).toBeVisible();
    rerender(<TargetTasks {...props} />);
    expect(screen.getByText('0 / 1 完了')).toBeVisible();
    rerender(<TargetTasks {...props} tasks={[{ ...task, isAbandoned: true }]} />);
    expect(screen.getByText('中止')).toBeVisible();
  });
  it('retains unavailable IDs without displaying archived or other-project content and can explicitly remove them', () => {
    useTargetTaskStore.getState().save('2026-09', 'p1', ['t1', 'other']);
    render(<TargetTasks {...props} tasks={[{ ...task, isArchived: true }, { ...task, id: 'other', projectId: 'p2', title: '秘密のタイトル' }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('秘密のタイトル')).not.toBeInTheDocument();
    expect(screen.getByText(/うち2件は現在表示できません/)).toBeVisible();
    open();
    fireEvent.click(screen.getByRole('button', { name: '表示できないタスクを選択から外す' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(useTargetTaskStore.getState().selections[0].taskIds).toEqual([]);
  });
  it('discards cancelled changes and prevents saving during loading or errors', () => {
    useTargetTaskStore.getState().save('2026-09', 'p1', ['t1']);
    const { rerender } = render(<TargetTasks {...props} />);
    open(); fireEvent.click(screen.getByRole('button', { name: 'すべて外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByRole('link', { name: /出展の準備/ })).toBeVisible();
    rerender(<TargetTasks {...props} tasks={[]} isLoading />); open();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    rerender(<TargetTasks {...props} tasks={[]} error={new Error('offline')} />);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('選択内容は保持');
    expect(useTargetTaskStore.getState().selections[0].taskIds).toEqual(['t1']);
  });
  it('starts a new month with no automatic selection, keeping last month intact', () => {
    useTargetTaskStore.getState().save('2026-09', 'p1', ['t1']);
    render(<TargetTasks {...props} month="2026-10" />);
    expect(screen.getByText('的は未選択')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(useTargetTaskStore.getState().selections[0].taskIds).toEqual(['t1']);
  });
});
