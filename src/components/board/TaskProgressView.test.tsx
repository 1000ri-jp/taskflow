import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskProgressView } from './TaskProgressView';
import { TooltipProvider } from '@/components/ui/tooltip';
import { viewList, viewTask } from '@/test/taskViewFixtures';
import { sendWorkflow } from '@/lib/task/workflowClient';
import type { Task } from '@/types';

const dnd = vi.hoisted(() => ({ start: vi.fn<(event: DragStartEvent) => void>(), end: vi.fn<(event: DragEndEvent) => Promise<void>>(), cancel: () => {} }));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }: { children: ReactNode; onDragStart: typeof dnd.start; onDragEnd: typeof dnd.end; onDragCancel: typeof dnd.cancel }) => { dnd.start = onDragStart; dnd.end = onDragEnd; dnd.cancel = onDragCancel; return children; },
  DragOverlay: () => null, PointerSensor: vi.fn(), KeyboardSensor: vi.fn(), useSensor: vi.fn(), useSensors: vi.fn(), pointerWithin: vi.fn(), rectIntersection: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  verticalListSortingStrategy: vi.fn(), sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({ attributes: { role: 'button', tabIndex: 0 }, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false }),
}));
vi.mock('@/lib/task/workflowClient', () => ({ sendWorkflow: vi.fn() }));
vi.mock('@/lib/firebase/firestore', () => ({ getUsersByIds: vi.fn().mockResolvedValue([]), getTaskAttachments: vi.fn().mockResolvedValue([]) }));
vi.mock('@/hooks/useTaskCommentPresence', () => ({ useTaskCommentPresence: () => ({ anchor: { current: null }, presence: { status: 'ready', hasComments: false, checkedAt: 0 } }) }));
vi.mock('@/contexts/NotificationContext', () => ({ useTaskCommentUnread: () => ({ hasUnread: false, isLoading: false, error: null }) }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const props = { projectId: 'project-1', viewerId: 'u', lists: [viewList()], names: {}, onTaskClick: vi.fn(), canEdit: true };
const view = (tasks: Task[], extra: Partial<Parameters<typeof TaskProgressView>[0]> = {}) => <QueryClientProvider client={client}><TooltipProvider><TaskProgressView {...props} tasks={tasks} allTasks={tasks} {...extra} /></TooltipProvider></QueryClientProvider>;
const start = (id: string) => act(() => dnd.start({ active: { id } } as DragStartEvent));
const drop = (id: string, over: string | null) => act(async () => { await dnd.end({ active: { id }, over: over ? { id: over } : null } as DragEndEvent); });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.mocked(sendWorkflow).mockResolvedValue(null); });

it('uses shared parent cards in all five columns and follows dependency completion', async () => {
  const tasks = [viewTask({ id: 'new', title: '原稿確認' }), viewTask({ id: 'started', title: '制作', workProgress: 'started' }),
    viewTask({ id: 'waiting', title: '印刷', workProgress: 'started', dependsOnTaskIds: ['new'] }),
    viewTask({ id: 'done', title: '完了した作業', isCompleted: true }), viewTask({ id: 'archived', title: '過去の仕事', isArchived: true, isCompleted: true })];
  const ui = render(view(tasks)); await act(async () => {});
  for (const [column, title] of [['未着手', '原稿確認'], ['着手', '制作'], ['待機', '印刷'], ['完了', '完了した作業'], ['アーカイブ', '過去の仕事']]) {
    expect(within(screen.getByRole('region', { name: column })).getByRole('button', { name: `${title}の詳細を開く` })).toHaveAttribute('data-testid', 'task-card');
  }
  expect(screen.getAllByTestId('task-card')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: '印刷の詳細を開く' }));
  expect(props.onTaskClick).toHaveBeenCalledExactlyOnceWith('waiting');
  ui.rerender(view(tasks.map(task => task.id === 'new' ? { ...task, isCompleted: true } : task)));
  expect(within(screen.getByRole('region', { name: '待機' })).getByText('タスクなし')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '着手' })).getByRole('button', { name: '印刷の詳細を開く' })).toBeInTheDocument();
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('writes exactly once on a cross-column drop and suppresses the resulting click', async () => {
  render(view([viewTask()])); await act(async () => {});
  start('task-1'); expect(sendWorkflow).not.toHaveBeenCalled();
  await drop('task-1', 'progress:started');
  expect(sendWorkflow).toHaveBeenCalledExactlyOnceWith('project-1', 'task-1', expect.objectContaining({ action: 'start' }));
  fireEvent.click(screen.getByRole('button', { name: '出展準備の詳細を開く' }));
  expect(props.onTaskClick).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole('button', { name: '出展準備の詳細を開く' }));
  fireEvent.click(screen.getByRole('button', { name: '出展準備の詳細を開く' }));
  expect(props.onTaskClick).toHaveBeenCalledOnce();
});
it('saves nothing for cancellation, outside drops, same status or read-only access', async () => {
  const task = viewTask(); const ui = render(view([task])); await act(async () => {});
  start(task.id); act(() => dnd.cancel()); await drop(task.id, 'progress:started');
  start(task.id); await drop(task.id, null);
  start(task.id); await drop(task.id, 'progress:not_started');
  ui.rerender(view([task], { canEdit: false })); await act(async () => {});
  start(task.id); await drop(task.id, 'progress:completed');
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('checks concurrent task changes and rejects invalid waiting moves without writing', async () => {
  const task = viewTask(); const ui = render(view([task])); await act(async () => {});
  start(task.id); ui.rerender(view([{ ...task, updatedAt: new Date() }])); await drop(task.id, 'progress:started');
  expect(screen.getByRole('alert')).toHaveTextContent('更新されました');
  start(task.id); await drop(task.id, 'progress:waiting');
  expect(screen.getByRole('alert')).toHaveTextContent('依存関係');
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('keeps an in-flight operation mounted when a live snapshot moves its card to another column', async () => {
  let resolve!: () => void;
  vi.mocked(sendWorkflow).mockImplementationOnce(() => new Promise(done => { resolve = () => done(null); }));
  const task = viewTask(); const ui = render(view([task])); await act(async () => {});
  start(task.id);
  let operation!: Promise<void>;
  act(() => { operation = dnd.end({ active: { id: task.id }, over: { id: 'progress:started' } } as DragEndEvent); });
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledOnce());
  ui.rerender(view([{ ...task, workProgress: 'started', updatedAt: new Date() }]));
  await act(async () => { resolve(); await operation; });
  expect(sessionStorage.length).toBe(0);
  expect(screen.queryByText(/同じ操作を再試行/)).not.toBeInTheDocument();
  start(task.id); await drop(task.id, 'progress:completed');
  expect(sendWorkflow).toHaveBeenCalledTimes(2);
  expect(vi.mocked(sendWorkflow).mock.calls[1][2].action).toBe('complete');
});
it('retains the idempotency key on uncertain failure and retries the original action', async () => {
  vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('通信が切れました'));
  render(view([viewTask()])); await act(async () => {});
  start('task-1'); await drop('task-1', 'progress:started');
  const original = vi.mocked(sendWorkflow).mock.calls[0];
  expect(screen.getByRole('alert')).toHaveTextContent('通信');
  start('task-1'); await drop('task-1', 'progress:completed');
  expect(sendWorkflow).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /同じ操作を再試行/ }));
  await waitFor(() => expect(sendWorkflow).toHaveBeenLastCalledWith(...original));
  await waitFor(() => expect(sessionStorage.length).toBe(0));
});
it('keeps per-column presentation scoped to the viewer and separate from shared tasks', async () => {
  const tasks = [viewTask({ id: 'late', title: '後の期限', dueDate: new Date(2026, 8, 25) }), viewTask({ id: 'early', title: '先の期限', dueDate: new Date(2026, 8, 15) })];
  render(view(tasks)); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '未着手列の設定' }));
  fireEvent.change(screen.getByRole('combobox', { name: '未着手の並び順' }), { target: { value: 'due-asc' } });
  expect(screen.getByRole('checkbox', { name: 'リスト名' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'リスト名' }));
  expect(screen.getByRole('checkbox', { name: 'リスト名' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'リスト名' }));
  const cards = within(screen.getByRole('region', { name: '未着手' })).getAllByTestId('task-card');
  expect(cards[0]).toHaveTextContent('先の期限');
  expect(cards[0]).toHaveTextContent('東京ゲームダンジョン');
  const key = 'taskflow.progressColumn.v1:' + JSON.stringify(['u', 'project-1', 'not_started']);
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ sort: 'due-asc', display: { showListName: true } });
  expect(sendWorkflow).not.toHaveBeenCalled();
});

it('shows descendants only inside their parent, across statuses and lists', async () => {
  const parent = viewTask({ id: 'parent', title: '販促品試作', workProgress: 'started' });
  const child = viewTask({ id: 'child', title: 'アクリルチャーム', parentTaskId: parent.id, listId: 'another-list' });
  const grandchild = viewTask({ id: 'grandchild', title: '付属品', parentTaskId: child.id });
  const completed = viewTask({ id: 'completed-child', title: 'マグカップ', parentTaskId: parent.id, isCompleted: true });
  render(view([parent, child, grandchild, completed])); await act(async () => {});
  const column = within(screen.getByRole('region', { name: '着手' }));
  expect(screen.getAllByTestId('task-card')).toHaveLength(1);
  expect(column.getByTitle('親タスクの件数。サブタスクは各カードの中に表示します')).toHaveTextContent('1件');
  expect(screen.queryByRole('button', { name: 'マグカップの詳細を開く' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '完了' })).getByText('タスクなし')).toBeInTheDocument();
  expect(column.getByRole('button', { name: '販促品試作のサブタスクを折りたたむ' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('サブタスク 3')).toBeInTheDocument();
  const childTitle = screen.getByRole('button', { name: 'アクリルチャーム' });
  const childRow = childTitle.parentElement;
  expect(childRow).toHaveAttribute('data-testid', 'task-child-row');
  expect(childRow).toHaveClass('flex', 'items-center', 'gap-x-2');
  expect(within(childRow!).getByTestId('task-child-metadata').parentElement).toBe(childRow);
  expect(screen.getByTestId('task-children-summary')).toHaveClass('py-1');
  expect(screen.getByRole('button', { name: '付属品' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('完了済み 1件'));
  fireEvent.click(screen.getByRole('button', { name: 'マグカップ' }));
  expect(props.onTaskClick).toHaveBeenCalledWith(completed.id);
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('keeps a matching child under its filtered parent without enabling parent status changes', async () => {
  const parent = viewTask({ id: 'parent', title: '親の作業', isCompleted: true });
  const child = viewTask({ id: 'child', title: '検索に一致', parentTaskId: parent.id });
  const sibling = viewTask({ id: 'sibling', title: '対象外', parentTaskId: parent.id });
  render(view([child], { allTasks: [parent, child, sibling] })); await act(async () => {});
  expect(screen.getAllByTestId('task-card')).toHaveLength(1);
  expect(screen.getByText('条件に合うサブタスクの親')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '親の作業のサブタスクを折りたたむ' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: '検索に一致' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '対象外' })).not.toBeInTheDocument();
  start(parent.id); await drop(parent.id, 'progress:started');
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('groups archived children too and keeps them accessible for opening their details', async () => {
  const parent = viewTask({ id: 'parent', title: '過去の制作', isArchived: true, isCompleted: true });
  const child = viewTask({ id: 'child', title: '過去のサブタスク', parentTaskId: parent.id, isArchived: true, isCompleted: true });
  render(view([parent, child])); await act(async () => {});
  expect(screen.getAllByTestId('task-card')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '過去の制作のサブタスクを展開' }));
  fireEvent.click(screen.getByText('アーカイブ 1件'));
  fireEvent.click(screen.getByRole('button', { name: '過去のサブタスク' }));
  expect(props.onTaskClick).toHaveBeenCalledWith(child.id);
  expect(screen.getByRole('button', { name: '過去のサブタスク' }).parentElement).toHaveTextContent('アーカイブ');
  expect(sendWorkflow).not.toHaveBeenCalled();
});
it('keeps a child accessible as a fallback when its parent cannot be found', async () => {
  render(view([viewTask({ id: 'orphan', title: '親が見つからない仕事', parentTaskId: 'missing' })]));
  await act(async () => {});
  expect(screen.getByRole('button', { name: '親が見つからない仕事の詳細を開く' })).toBeInTheDocument();
});

it('does not count archived unfinished children as pending work', async () => {
  const parent = viewTask({ id: 'parent', title: '完了した制作', isCompleted: true });
  const child = viewTask({ id: 'child', title: '取り置きの子', parentTaskId: parent.id, isArchived: true, assigneeIds: ['u'] });
  render(view([parent, child])); await act(async () => {});
  expect(screen.getByText('サブタスク 1件・未完了 0件')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '完了した制作のサブタスクを展開' }));
  expect(screen.queryByText('親は完了・サブタスクは未完了です')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('アーカイブ 1件'));
  expect(screen.getByRole('button', { name: '取り置きの子' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '取り置きの子のリストを変更' })).not.toBeInTheDocument();
});


it('keeps a saved opt-out for list names and restores the progress-view default on reset', async () => {
  const key = 'taskflow.progressColumn.v1:' + JSON.stringify(['u', 'project-1', 'not_started']);
  localStorage.setItem(key, JSON.stringify({ display: { showListName: false } }));
  render(view([viewTask()])); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '未着手列の設定' }));
  expect(screen.getByRole('checkbox', { name: 'リスト名' })).not.toBeChecked();
  expect(screen.getByTestId('task-card')).not.toHaveTextContent('東京ゲームダンジョン');
  fireEvent.click(screen.getByRole('button', { name: '標準に戻す' }));
  expect(screen.getByRole('checkbox', { name: 'リスト名' })).toBeChecked();
  expect(screen.getByTestId('task-card')).toHaveTextContent('東京ゲームダンジョン');
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ display: { showListName: true } });
  expect(sendWorkflow).not.toHaveBeenCalled();
});
