import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { TARGET_GOAL_STORAGE_KEY, useTargetGoalStore } from '@/stores/targetGoalStore';
import { TargetGoals } from './TargetGoals';

const task = (id: string, projectId: string, projectName: string, changes: Partial<DashboardTask> = {}) => ({
  id, projectId, projectName, listId: 'list-1', title: `${projectName}のタスク${id}`, description: '', order: 0,
  assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null,
  durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null, isAbandoned: false,
  isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(),
  ...changes,
} as DashboardTask);

describe('TargetGoals', () => {
  beforeEach(() => {
    localStorage.removeItem(TARGET_GOAL_STORAGE_KEY);
    useTargetGoalStore.setState({ goals: [], persistenceFailed: false });
  });

  afterEach(() => cleanup());

  it('creates a goal, selects a task from another project, and counts its completion', () => {
    const tasks = [task('order-1', 'sales-project', 'ココナラ販売', { isCompleted: true }), task('order-2', 'sales-project', 'ココナラ販売')];
    render(<TargetGoals tasks={tasks} tasksLoading={false} tasksError={null} />);

    fireEvent.click(screen.getByRole('button', { name: '目標を追加' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: '達成条件' })).toHaveValue('order_received');
    fireEvent.change(within(dialog).getByRole('combobox', { name: '1人目の達成タスク' }), { target: { value: JSON.stringify(['sales-project', 'order-1']) } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: '2人目の達成タスク' }), { target: { value: JSON.stringify(['sales-project', 'order-2']) } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    const card = screen.getByRole('article', { name: 'ココナラモニター獲得の進捗' });
    const title = within(card).getByRole('heading', { name: 'ココナラモニター獲得' });
    expect(screen.getByRole('region', { name: '達成目標' })).toHaveClass('rounded-2xl', 'border', 'shadow-sm');
    expect(within(card).queryByText(/達成条件：/)).not.toBeInTheDocument();
    expect(card.parentElement).toHaveClass('lg:grid-cols-2');
    expect(within(card).getByText('1/3')).toBeVisible();
    const people = within(card).getByRole('list', { name: 'ココナラモニター獲得：3人中1人達成' });
    expect(people.parentElement).toBe(title.parentElement);
    expect(people).toHaveClass('flex', 'flex-wrap');
    expect(within(people).getAllByRole('listitem')).toHaveLength(3);
    expect(within(people).getByRole('link', { name: /1人目：達成、ココナラ販売のタスクorder-1/ })).toHaveAttribute('href', '/projects/sales-project/board?task=order-1');
    expect(within(people).getByRole('link', { name: /1人目：達成/ })).toHaveClass('bg-violet-600', 'text-white');
    expect(within(people).getByRole('link', { name: /2人目：未達成/ })).toHaveClass('bg-violet-50', 'text-violet-400');
    expect(within(people).getByRole('img', { name: '3人目：未達成、達成タスク未設定' })).toHaveClass('border-dashed');
    expect(within(card).queryByText('1人目')).not.toBeInTheDocument();
    expect(within(card).queryByText('達成タスク未設定')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(TARGET_GOAL_STORAGE_KEY)!)[0].units[0]).toMatchObject({ projectId: 'sales-project', taskId: 'order-1' });
  });

  it('lets the criterion change without losing linked task references', () => {
    render(<TargetGoals tasks={[task('order-1', 'sales-project', 'ココナラ販売')]} tasksLoading={false} tasksError={null} />);
    fireEvent.click(screen.getByRole('button', { name: '目標を追加' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: '1人目の達成タスク' }), { target: { value: JSON.stringify(['sales-project', 'order-1']) } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: '達成条件' }), { target: { value: 'delivered' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    fireEvent.click(screen.getByRole('button', { name: 'ココナラモニター獲得を編集' }));
    expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: '達成条件' })).toHaveValue('delivered');
    expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: '1人目の達成タスク' })).toHaveValue(JSON.stringify(['sales-project', 'order-1']));
  });
});
