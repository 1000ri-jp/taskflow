import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentedTasksPopover } from './CommentedTasksPopover';
import { getTaskComments } from '@/lib/firebase/firestore';
import type { Comment, List, Task } from '@/types';

vi.mock('@/lib/firebase/firestore', () => ({
  getTaskComments: vi.fn(),
}));

const taskBase: Task = {
  id: 'task-1',
  projectId: 'project-1',
  listId: 'list-1',
  title: 'コメントを確認するタスク',
  description: '',
  order: 0,
  assigneeIds: [],
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
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

const comment: Comment = {
  id: 'comment-1',
  taskId: 'task-1',
  content: '最新コメントの内容',
  authorId: 'user-2',
  mentions: [],
  createdAt: new Date('2026-09-02T10:00:00.000Z'),
  updatedAt: new Date('2026-09-02T10:00:00.000Z'),
};

const list: List = {
  id: 'list-1', projectId: 'project-1', name: '生成AIなんでも展示会', color: '#14b8a6', order: 0,
  autoCompleteOnEnter: false, autoUncompleteOnExit: false, autoSetStartDateOnEnter: false,
  createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('CommentedTasksPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskComments).mockResolvedValue([comment]);
  });

  it('loads comments only when opened and opens the selected task', async () => {
    const onTaskClick = vi.fn();

    render(
      <CommentedTasksPopover
        projectId="project-1"
        tasks={[taskBase]}
        lists={[list]}
        onTaskClick={onTaskClick}
      />
    );

    expect(getTaskComments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'コメントあり' }));

    expect(await screen.findByText('最新コメントの内容')).toBeInTheDocument();
    expect(screen.getByText('列：生成AIなんでも展示会')).toBeInTheDocument();
    expect(getTaskComments).toHaveBeenCalledWith('project-1', 'task-1');

    fireEvent.click(screen.getByRole('button', { name: /コメントを確認するタスク/ }));
    expect(onTaskClick).toHaveBeenCalledWith('task-1');
  });

  it('distinguishes identically named tasks in different columns and keeps task navigation', async () => {
    const onTaskClick = vi.fn();
    render(<CommentedTasksPopover projectId="project-1"
      tasks={[taskBase, { ...taskBase, id: 'task-2', listId: 'list-2' }]}
      lists={[list, { ...list, id: 'list-2', name: '東京ゲームダンジョン' }]}
      onTaskClick={onTaskClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントあり' }));
    expect(await screen.findByText('列：東京ゲームダンジョン')).toBeInTheDocument();
    expect(screen.getByText('列：生成AIなんでも展示会')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /列：東京ゲームダンジョン/ }));
    expect(onTaskClick).toHaveBeenCalledWith('task-2');
  });

  it('reflects current task membership and renamed columns without fetching again', async () => {
    const onTaskClick = vi.fn();
    const { rerender } = render(<CommentedTasksPopover projectId="project-1" tasks={[taskBase]} lists={[list]} onTaskClick={onTaskClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントあり' }));
    await screen.findByText('列：生成AIなんでも展示会');
    rerender(<CommentedTasksPopover projectId="project-1" tasks={[{ ...taskBase, listId: 'list-2' }]}
      lists={[list, { ...list, id: 'list-2', name: '移動先の列' }]} onTaskClick={onTaskClick} />);
    expect(screen.getByText('列：移動先の列')).toBeInTheDocument();
    rerender(<CommentedTasksPopover projectId="project-1" tasks={[{ ...taskBase, listId: 'list-2' }]}
      lists={[{ ...list, id: 'list-2', name: '名前を変えた列' }]} onTaskClick={onTaskClick} />);
    expect(screen.getByText('列：名前を変えた列')).toBeInTheDocument();
    expect(getTaskComments).toHaveBeenCalledTimes(1);
  });

  it('keeps the task accessible if its column cannot be resolved', async () => {
    render(<CommentedTasksPopover projectId="project-1" tasks={[taskBase]} lists={[]} onTaskClick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントあり' }));
    expect(await screen.findByText('列：列名不明')).toBeInTheDocument();
    expect(screen.getByText(taskBase.title)).toBeInTheDocument();
  });
});
