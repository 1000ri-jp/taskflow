import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { BoardView } from './BoardView';
import { viewList, viewTask } from '@/test/taskViewFixtures';
import { BOARD_SORT_OPTIONS } from '@/lib/board/sort';
import { useBoardSortStore } from '@/stores/boardSortStore';
import { boardColumnScope, useBoardColumnStore } from '@/stores/boardColumnStore';
import type { Task } from '@/types';

const harness = vi.hoisted(() => ({
  start: (() => {}) as (event: DragStartEvent) => void,
  end: (async () => {}) as (event: DragEndEvent) => Promise<void>,
  over: undefined as ((event: DragOverEvent) => void) | undefined,
  cancel: () => {},
  tasks: [] as Task[],
  move: vi.fn(), reorder: vi.fn(), reorderLists: vi.fn(),
}));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragStart, onDragEnd, onDragOver, onDragCancel }: {
    children: ReactNode; onDragStart: typeof harness.start; onDragEnd: typeof harness.end;
    onDragOver?: typeof harness.over; onDragCancel: typeof harness.cancel;
  }) => { harness.start = onDragStart; harness.end = onDragEnd; harness.over = onDragOver; harness.cancel = onDragCancel; return children; },
  DragOverlay: ({ children }: { children: ReactNode }) => <div data-testid="drag-preview">{children}</div>,
  PointerSensor: vi.fn(), KeyboardSensor: vi.fn(), useSensor: vi.fn(), useSensors: vi.fn(),
  pointerWithin: vi.fn(), rectIntersection: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));
vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  ...await importOriginal<typeof import('@dnd-kit/sortable')>(),
  SortableContext: ({ children }: { children: ReactNode }) => children,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'viewer' }, firebaseUser: { uid: 'viewer' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'project-1', memberIds: ['viewer'], defaultAssigneeId: 'viewer' }, isLoading: false, error: null }) }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{ id: 'viewer', displayName: '本人' }], isLoading: false, hasError: false }) }));
vi.mock('@/hooks/useBoard', async () => {
  const { viewList } = await import('@/test/taskViewFixtures');
  const lists = [viewList({ id: 'source', name: '公式サイト' }), viewList({ id: 'target', name: '天然石', order: 1 }), viewList({ id: 'empty', name: '空の列', order: 2 })];
  return { useBoard: () => ({ lists, tasks: harness.tasks, labels: [], tags: [], isLoading: false,
    getTasksByListId: (id: string) => harness.tasks.filter(task => task.listId === id),
    moveTask: harness.move, reorderTasks: harness.reorder, reorderLists: harness.reorderLists,
  }) };
});
vi.mock('./TaskChildrenSummary', () => ({ TaskChildrenSummary: () => null }));
vi.mock('./TaskCard', () => ({
  TaskCard: ({ task, disableDragging }: { task: Task; disableDragging?: boolean }) => (
    <button data-testid="drag-card" data-drag-disabled={Boolean(disableDragging)}>{task.title}</button>
  ),
}));
const start = (id = 'moving') => act(() => harness.start({ active: { id, data: { current: {} } } } as DragStartEvent));
const drop = (over: string | null, id = 'moving') => act(async () => {
  await harness.end({ active: { id, data: { current: {} } }, over: over ? { id: over } : null } as DragEndEvent);
});
const board = () => <BoardView projectId="project-1" onTaskClick={vi.fn()} />;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  useBoardSortStore.setState({ byProject: {}, persistenceFailed: false });
  useBoardColumnStore.setState({ byScope: {}, persistenceFailed: false });
  harness.move.mockResolvedValue(undefined);
  harness.tasks = [viewTask({ id: 'moving', listId: 'source', title: 'サイト構成の見直し', dueDate: new Date(2026, 7, 28) }),
    viewTask({ id: 'sibling', listId: 'source', title: 'キャラクター図の作り直し', order: 1, dueDate: new Date(2026, 8, 11) }),
    viewTask({ id: 'destination', listId: 'target', title: '天然石チャーム' })];
});

describe('Kanban task dragging', () => {
  it.each(BOARD_SORT_OPTIONS)('allows cross-list drops while sorted by $value and persists only the drop', async ({ value }) => {
    render(board());
    act(() => useBoardColumnStore.getState().save(boardColumnScope('viewer', 'project-1', 'source'), { sort: value, display: {} }));
    start();
    expect(within(screen.getByTestId('drag-preview')).getByText('サイト構成の見直し')).toBeInTheDocument();
    act(() => harness.over?.({ active: { id: 'moving', data: { current: {} } }, over: { id: 'list-target' } } as DragOverEvent));
    expect(harness.move).not.toHaveBeenCalled();
    await drop('destination');
    expect(harness.move).toHaveBeenCalledExactlyOnceWith('moving', 'target', 0);
    expect(harness.reorder).not.toHaveBeenCalled();
    expect(screen.getByTestId('drag-preview')).toBeEmptyDOMElement();
  });

  it.each(['list-empty', 'empty', 'list-target', 'target'])('accepts container or header drops on %s', async (target) => {
    const ui = render(board()); start(); await drop(target);
    const listId = target.replace(/^list-/, '');
    expect(harness.move).toHaveBeenCalledExactlyOnceWith('moving', listId, listId === 'empty' ? 0 : 1);
    harness.tasks = harness.tasks.map(task => task.id === 'moving' ? { ...task, listId } : task);
    ui.rerender(board());
    const destination = screen.getAllByTestId('board-list').find(list => within(list).queryByRole('heading', { name: listId === 'empty' ? '空の列' : '天然石' }));
    expect(within(destination!).getByText('サイト構成の見直し')).toBeInTheDocument();
  });

  it.each(BOARD_SORT_OPTIONS.filter(option => option.value !== 'manual'))('preserves $value within the same list', async ({ value }) => {
    render(board());
    act(() => useBoardColumnStore.getState().save(boardColumnScope('viewer', 'project-1', 'source'), { sort: value, display: {} }));
    start(); await drop('sibling');
    expect(harness.move).not.toHaveBeenCalled(); expect(harness.reorder).not.toHaveBeenCalled();
  });

  it('still reorders within a manually sorted column', async () => {
    render(board());
    act(() => useBoardColumnStore.getState().save(boardColumnScope('viewer', 'project-1', 'source'), { sort: 'manual', display: {} }));
    start(); await drop('sibling');
    expect(harness.reorder).toHaveBeenCalledExactlyOnceWith('source', ['sibling', 'moving']);
    expect(harness.move).not.toHaveBeenCalled();
  });

  it('does not write on cancel, an outside drop, or an unknown target', async () => {
    render(board()); start(); act(() => harness.cancel());
    expect(screen.getByTestId('drag-preview')).toBeEmptyDOMElement();
    await drop('target'); start(); await drop(null); start(); await drop('unknown');
    expect(harness.move).not.toHaveBeenCalled(); expect(harness.reorder).not.toHaveBeenCalled();
  });

  it('shows failed moves and permits another attempt', async () => {
    harness.move.mockRejectedValueOnce(new Error('permission-denied'));
    render(board()); start(); await drop('target');
    expect(screen.getByRole('alert')).toHaveTextContent('タスクを移動できませんでした');
    start(); await drop('target');
    expect(harness.move).toHaveBeenCalledTimes(2); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves list dragging and cancellation cleanup', async () => {
    render(board());
    act(() => harness.start({ active: { id: 'source', data: { current: { type: 'list', list: viewList({ id: 'source', name: '公式サイト' }) } } } } as unknown as DragStartEvent));
    expect(within(screen.getByTestId('drag-preview')).getByText('公式サイト')).toBeInTheDocument();
    await act(async () => harness.end({ active: { id: 'source', data: { current: { type: 'list' } } }, over: { id: 'target' } } as unknown as DragEndEvent));
    expect(harness.reorderLists.mock.calls[0][0].map((list: {id: string}) => list.id)).toEqual(['target', 'source', 'empty']);
    expect(harness.move).not.toHaveBeenCalled();
  });
});
