import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardSortStore } from '@/stores/boardSortStore';
import { BoardList } from './BoardList';
import type { List, Task } from '@/types';

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => (
    <div data-testid="sortable-tasks" data-task-ids={items.join(',')}>{children}</div>
  ),
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: () => undefined,
    isOver: false,
  }),
}));

vi.mock('./TaskCard', () => ({
  TaskCard: ({
    task,
    listName,
    listColor,
    onClick,
    onMove,
    disableDragging,
  }: {
    task: Task;
    listName: string;
    listColor: string;
    onClick: () => void;
    onMove: (listId: string) => void;
    disableDragging?: boolean;
  }) => (
    <div data-testid="mock-task-card" data-list-name={listName} data-list-color={listColor} data-drag-disabled={disableDragging}>
      <button onClick={onClick}>{task.title}</button>
      <button onClick={() => onMove('list-2')}>別の看板へ移動</button>
    </div>
  ),
}));

const list: List = {
  id: 'list-1',
  projectId: 'project-1',
  name: '依頼事項',
  color: '#8b5cf6',
  order: 0,
  autoCompleteOnEnter: false,
  autoUncompleteOnExit: false,
  autoSetStartDateOnEnter: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const task: Task = {
  id: 'task-1',
  projectId: 'project-1',
  listId: 'list-1',
  title: '既存タスク',
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('BoardList', () => {
  beforeEach(() => useBoardSortStore.setState({byProject:{},persistenceFailed:false}));
  function taskList(tasks: Task[], onTaskClick = vi.fn(), onTaskMove = vi.fn()) {
    return (
      <BoardList
        projectId="project-1"
        list={list}
        tasks={tasks}
        allTasks={tasks}
        labels={[]}
        tags={[]}
        onAddTask={vi.fn()}
        onEditList={vi.fn()}
        onDeleteList={vi.fn()}
        onTaskClick={onTaskClick}
        allLists={[list]}
        onTaskMove={onTaskMove}
      />
    );
  }

  const cardTitles = () => screen.queryAllByTestId('mock-task-card')
    .map((card) => card.querySelector('button')?.textContent);

  it('uses project date sorting without changing shared order and disables card dragging', () => {
    useBoardSortStore.setState({byProject:{'project-1':'due-asc'}});
    const tasks=[{...task,id:'late',title:'遅い',dueDate:new Date(2026,8,20)},{...task,id:'early',title:'早い',dueDate:new Date(2026,8,3)}];
    const original=structuredClone(tasks); const move=vi.fn();
    render(taskList(tasks,vi.fn(),move));
    expect(cardTitles()).toEqual(['早い','遅い']);
    expect(screen.getAllByTestId('mock-task-card').every(card=>card.dataset.dragDisabled==='true')).toBe(true);
    expect(tasks).toEqual(original); expect(move).not.toHaveBeenCalled();
  });

  it('displays completed tasks last while preserving each group and the original task data', () => {
    const tasks = [
      { ...task, id: 'done-1', title: '完了1', order: 0, isCompleted: true },
      { ...task, id: 'todo-1', title: '未完了1', order: 1 },
      { ...task, id: 'done-2', title: '完了2', order: 2, isCompleted: true },
      { ...task, id: 'todo-2', title: '未完了2', order: 3 },
    ];
    const original = structuredClone(tasks);
    tasks.forEach(Object.freeze);
    Object.freeze(tasks);
    const onTaskClick = vi.fn();
    const onTaskMove = vi.fn();
    render(taskList(tasks, onTaskClick, onTaskMove));

    expect(cardTitles()).toEqual(['未完了1', '未完了2', '完了1', '完了2']);
    expect(screen.getByTestId('sortable-tasks')).toHaveAttribute('data-task-ids', 'todo-1,todo-2,done-1,done-2');
    expect(tasks).toEqual(original);
    expect(onTaskMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '完了1' }));
    expect(onTaskClick).toHaveBeenCalledWith('done-1');
  });

  it('regroups received completion changes and restores saved order when completion is removed', () => {
    const first = { ...task, id: 'first', title: '最初のタスク' };
    const second = { ...task, id: 'second', title: '次のタスク', order: 1 };
    const { rerender } = render(taskList([first, second]));
    rerender(taskList([{ ...first, isCompleted: true }, second]));
    expect(cardTitles()).toEqual(['次のタスク', '最初のタスク']);
    rerender(taskList([first, second]));
    expect(cardTitles()).toEqual(['最初のタスク', '次のタスク']);
  });

  it.each([false, true])('keeps same-status task order (completed: %s)', (isCompleted) => {
    render(taskList([
      { ...task, id: 'a', title: '先', isCompleted },
      { ...task, id: 'b', title: '後', isCompleted },
    ]));
    expect(cardTitles()).toEqual(['先', '後']);
  });

  it('keeps empty or fully filtered lists usable', () => {
    render(taskList([]));
    expect(cardTitles()).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'タスクを追加' })).toHaveLength(2);
  });

  it('passes the list status presentation to each task card', () => {
    render(
      <BoardList
        projectId="project-1"
        list={list}
        tasks={[task]}
        allTasks={[task]}
        labels={[]}
        tags={[]}
        onAddTask={vi.fn()}
        onEditList={vi.fn()}
        onDeleteList={vi.fn()}
        onTaskClick={vi.fn()}
        allLists={[list]}
        onTaskMove={vi.fn()}
      />
    );

    expect(screen.getByTestId('mock-task-card')).toHaveAttribute('data-list-name', '依頼事項');
    expect(screen.getByTestId('mock-task-card')).toHaveAttribute('data-list-color', '#8b5cf6');
  });

  it('keeps the task composer at the bottom when launched from the bottom add button', () => {
    const onAddTask = vi.fn();

    render(
      <BoardList
        projectId="project-1"
        list={list}
        tasks={[task]}
        allTasks={[task]}
        labels={[]}
        tags={[]}
        onAddTask={onAddTask}
        onEditList={vi.fn()}
        onDeleteList={vi.fn()}
        onTaskClick={vi.fn()}
        allLists={[list]}
        onTaskMove={vi.fn()}
      />
    );

    expect(screen.getAllByRole('button', { name: 'タスクを追加' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'タスクを追加' })[1]);

    expect(screen.getByPlaceholderText('タスク名を入力...')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'タスクを追加' })).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText('タスク名を入力...'), {
      target: { value: '末尾で追加するタスク' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(onAddTask).toHaveBeenCalledWith('末尾で追加するタスク', 'bottom');
    expect(screen.getAllByRole('button', { name: 'タスクを追加' })).toHaveLength(2);
  });

  it('reports top position when launched from the top add button', () => {
    const onAddTask = vi.fn();

    render(
      <BoardList
        projectId="project-1"
        list={list}
        tasks={[task]}
        allTasks={[task]}
        labels={[]}
        tags={[]}
        onAddTask={onAddTask}
        onEditList={vi.fn()}
        onDeleteList={vi.fn()}
        onTaskClick={vi.fn()}
        allLists={[list]}
        onTaskMove={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'タスクを追加' })[0]);

    fireEvent.change(screen.getByPlaceholderText('タスク名を入力...'), {
      target: { value: '先頭で追加するタスク' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(onAddTask).toHaveBeenCalledWith('先頭で追加するタスク', 'top');
  });

  it('keeps normal task clicks and routes context-menu moves with the task id', () => {
    const onTaskClick = vi.fn();
    const onTaskMove = vi.fn();

    render(
      <BoardList
        projectId="project-1"
        list={list}
        tasks={[task]}
        allTasks={[task]}
        labels={[]}
        tags={[]}
        onAddTask={vi.fn()}
        onEditList={vi.fn()}
        onDeleteList={vi.fn()}
        onTaskClick={onTaskClick}
        allLists={[list]}
        onTaskMove={onTaskMove}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '既存タスク' }));
    fireEvent.click(screen.getByRole('button', { name: '別の看板へ移動' }));

    expect(onTaskClick).toHaveBeenCalledWith('task-1');
    expect(onTaskMove).toHaveBeenCalledWith('task-1', 'list-2');
  });
});
