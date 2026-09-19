'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BoardList } from './BoardList';
import { boardColumnScope, useBoardColumnStore } from '@/stores/boardColumnStore';
import { TaskCard } from './TaskCard';
import { useBoard } from '@/hooks/useBoard';
import { useAuthStore } from '@/stores/authStore';
import type { Task, List } from '@/types';
import { LIST_COLORS } from '@/types';
import { cn } from '@/lib/utils';
import { boardDragCollision } from '@/lib/board/dragCollision';
import { taskMatchesBoardFilters, type BoardFilters } from '@/lib/board/filters';
import { groupTaskFamilies, tasksInList } from '@/lib/board/taskHierarchy';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { useProject } from '@/hooks/useProjects';
import { TaskChildrenSummary } from './TaskChildrenSummary';
import { BOARD_SORT_STORAGE_KEY, useBoardSortStore } from '@/stores/boardSortStore';

interface BoardViewProps {
  projectId: string;
  onTaskClick: (taskId: string) => void;
  filters?: BoardFilters;
  listId?: string | null;
}

export function BoardView({ projectId, onTaskClick, filters, listId = null }: BoardViewProps) {
  const sortMode = useBoardSortStore(state => state.byProject[projectId] ?? 'due-asc');
  const hydrateSort = useBoardSortStore(state => state.hydrate);
  useEffect(() => {
    hydrateSort();
    const sync = (event: StorageEvent) => { if (event.key === BOARD_SORT_STORAGE_KEY || event.key === null) hydrateSort(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [hydrateSort]);
  const { firebaseUser, user } = useAuthStore();
  const { project } = useProject(projectId);
  const columns = useBoardColumnStore(state => state.byScope);
  const {
    lists,
    tasks,
    labels,
    tags,
    isLoading,
    error,
    getTasksByListId,
    addList,
    editList,
    removeList,
    reorderLists,
    addTask,
    moveTask,
    reorderTasks,
  } = useBoard(projectId);

  // Filter tasks based on filter criteria
  const filterTask = useCallback((task: Task): boolean => {
    if (!filters) return true;
    return taskMatchesBoardFilters(task, filters);
  }, [filters]);

  const families = useMemo(() => groupTaskFamilies(tasksInList(tasks, listId).filter(filterTask), tasks), [tasks, listId, filterTask]);
  const childrenByParent = useMemo(() => new Map(families.map(family => [family.task.id, family.children])), [families]);
  const contextIds = useMemo(() => new Set(families.filter(family => family.isContext).map(family => family.task.id)), [families]);
  const projectMemberIds = project?.memberIds ?? [];
  const childMembers = useMeetingMembers([{ memberIds: [...projectMemberIds, ...families.flatMap(family => family.children.flatMap(child => child.assigneeIds))] }], !!project || families.some(family => family.children.length > 0));
  const childMemberDetails = Object.fromEntries(childMembers.users.map(member => [member.id, member]));
  const childNames = Object.fromEntries(childMembers.users.map(member => [member.id, member.displayName]));
  const getFilteredTasksByListId = (id: string) => families.filter(family => family.task.listId === id).map(family => family.task);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [activeList, setActiveList] = useState<List | null>(null);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState<string>(LIST_COLORS[0].value);

  // Local list order for optimistic updates
  const [localLists, setLocalLists] = useState<List[]>([]);
  const isDraggingList = useRef(false);

  // Sync local lists with Firestore lists (but not during drag)
  useEffect(() => {
    if (!isDraggingList.current) {
      setLocalLists(lists);
    }
  }, [lists]);

  // Use local lists for rendering (optimistic updates)
  const displayLists = localLists.length > 0 ? localLists : lists;
  const activeTaskList = activeTask
    ? displayLists.find((list) => list.id === activeTask.listId)
    : null;

  // Delete list dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listToDelete, setListToDelete] = useState<List | null>(null);
  const [targetListId, setTargetListId] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  const customCollisionDetection: CollisionDetection = useCallback(
    args => boardDragCollision(args, displayLists.map(list => list.id)),
    [displayLists]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const taskSortMode = useCallback((taskId: string | number) => {
    const listId = tasks.find(task => task.id === taskId)?.listId;
    return listId ? columns[boardColumnScope(user?.id ?? '', projectId, listId)]?.sort ?? sortMode : sortMode;
  }, [tasks, columns, user?.id, projectId, sortMode]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const activeData = active.data.current;
      setDragError(null);

      if (activeData?.type === 'list') {
        isDraggingList.current = true;
        setActiveList(activeData.list);
        setActiveTask(null);
      } else {
        if (contextIds.has(String(active.id))) return;
        const task = tasks.find((t) => t.id === active.id);
        if (task) {
          setActiveTask(task);
          setActiveList(null);
        }
      }
    },
    [tasks, contextIds]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      setActiveList(null);

      const activeData = active.data.current;

      // Clear dragging flag for lists
      if (activeData?.type === 'list') {
        isDraggingList.current = false;
      }

      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      if (activeId === overId) return;

      // Handle list reordering
      if (activeData?.type === 'list') {
        const activeIndex = displayLists.findIndex((l) => l.id === activeId);
        const overIndex = displayLists.findIndex((l) => l.id === overId);

        if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
          // Optimistic update: immediately update local state
          const reordered = arrayMove(displayLists, activeIndex, overIndex);
          setLocalLists(reordered);

          // Then persist to Firestore
          reorderLists(reordered);
        }
        return;
      }

      // Date sorting controls presentation, not whether a task can change lists.
      // Persist only the final drop so hovered lists do not trigger their automation.
      if (!activeTask || activeTask.id !== activeId || contextIds.has(activeId)) return;
      const activeTaskItem = tasks.find((task) => task.id === activeId);
      const overTask = tasks.find((task) => task.id === overId);
      const targetListId = overTask?.listId ?? displayLists.find(
        (list) => list.id === overId || `list-${list.id}` === overId
      )?.id;
      if (!activeTaskItem || !targetListId || !displayLists.some((list) => list.id === targetListId)) return;

      try {
        if (activeTaskItem.listId !== targetListId) {
          const targetTasks = getTasksByListId(targetListId);
          const overIndex = overTask ? targetTasks.findIndex((task) => task.id === overId) : -1;
          await moveTask(activeId, targetListId, overIndex >= 0 ? overIndex : targetTasks.length);
          return;
        }

        // Within a date-sorted list, keep the selected date order.
        if (taskSortMode(activeId) !== 'manual' || !overTask) return;
        const listTasks = getTasksByListId(activeTaskItem.listId);
        const activeIndex = listTasks.findIndex((task) => task.id === activeId);
        const overIndex = listTasks.findIndex((task) => task.id === overId);
        if (activeIndex >= 0 && overIndex >= 0 && activeIndex !== overIndex) {
          await reorderTasks(activeTaskItem.listId, arrayMove(listTasks, activeIndex, overIndex).map((task) => task.id));
        }
      } catch {
        setDragError('タスクを移動できませんでした。接続・権限を確認して、もう一度お試しください。');
      }
    },
    [activeTask, contextIds, tasks, displayLists, getTasksByListId, reorderTasks, reorderLists, moveTask, taskSortMode]
  );

  const handleDragCancel = useCallback(() => {
    isDraggingList.current = false;
    setActiveTask(null);
    setActiveList(null);
  }, []);

  const handleAddList = () => {
    if (newListName.trim()) {
      addList(newListName.trim(), newListColor);
      setNewListName('');
      setNewListColor(LIST_COLORS[0].value);
      setIsAddingList(false);
    }
  };

  const handleAddTask = (listId: string) => async (title: string, position: 'top' | 'bottom', assigneeIds?: string[]) => {
    if (!firebaseUser) throw new Error('ログイン状態を確認してください。入力は保持しています。');
    return await addTask(listId, title, firebaseUser.uid, position, { assigneeIds });
  };

  const handleTaskMove = useCallback(
    (taskId: string, targetListId: string) => {
      const tasksInTargetList = getTasksByListId(targetListId);
      moveTask(taskId, targetListId, tasksInTargetList.length);
    },
    [getTasksByListId, moveTask]
  );

  const handleDeleteListRequest = (list: List) => {
    const tasksInList = getTasksByListId(list.id);
    if (tasksInList.length === 0) {
      // No tasks, delete immediately
      if (confirm('このリストを削除しますか？')) {
        removeList(list.id);
      }
    } else {
      // Has tasks, show dialog
      setListToDelete(list);
      // Default to first available list (not the one being deleted)
      const otherLists = displayLists.filter((l) => l.id !== list.id);
      if (otherLists.length > 0) {
        setTargetListId(otherLists[0].id);
      }
      setDeleteDialogOpen(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!listToDelete) return;

    setIsDeleting(true);
    try {
      await removeList(listToDelete.id, targetListId);
      setDeleteDialogOpen(false);
      setListToDelete(null);
      setTargetListId('');
    } finally {
      setIsDeleting(false);
    }
  };

  if (error) return <p role="alert" className="p-4 text-sm text-destructive">タスクを取得できませんでした。接続・権限を確認してください。</p>;
  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="pb-4" data-testid="board-view">
        {dragError && <p role="alert" className="mb-3 text-sm text-destructive">{dragError}</p>}
        <div className="flex w-fit gap-4">
          <SortableContext
            items={displayLists.map((l) => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            {displayLists.filter(list => !listId || list.id === listId || families.some(family => family.task.listId === list.id)).map((list) => (
              <BoardList
                key={`${user?.id ?? ''}:${list.id}`}
                projectId={projectId}
                list={list}
                tasks={getFilteredTasksByListId(list.id)}
                allTasks={tasks}
                childrenByParent={childrenByParent}
                contextIds={contextIds}
                viewerId={user?.id ?? ''}
                childNames={childNames} childMemberDetails={childMemberDetails}
                projectMemberIds={projectMemberIds}
                projectMembers={childMembers.users}
                projectMembersLoading={childMembers.isLoading}
                projectMembersError={childMembers.hasError}
                labels={labels}
                tags={tags}
                onAddTask={handleAddTask(list.id)}
                onEditList={(data) => editList(list.id, data)}
                onDeleteList={() => handleDeleteListRequest(list)}
                onTaskClick={onTaskClick}
                allLists={displayLists}
                onTaskMove={handleTaskMove}
              />
            ))}
          </SortableContext>

          {families.some(family => !lists.some(list => list.id === family.task.listId)) && <section className="w-72 shrink-0 space-y-2 rounded-lg bg-muted p-3" aria-label="分類不明のタスク">
            <h3 className="text-sm font-medium">分類不明（元のリストが見つかりません）</h3>
            {families.filter(family => !lists.some(list => list.id === family.task.listId)).map(family => <TaskCard key={family.task.id} projectId={projectId} task={family.task} listName="分類不明" listColor="#94a3b8" labels={labels} tags={tags} allTasks={tasks} disableDragging onClick={() => onTaskClick(family.task.id)} footer={<TaskChildrenSummary task={family.task} childrenTasks={family.children} allTasks={tasks} viewerId={user?.id ?? ''} names={childNames} members={childMemberDetails} lists={lists} onTaskClick={onTaskClick} rowLayout="single-line" />} />)}
          </section>}

          {/* Add List */}
          <div className="flex w-72 flex-shrink-0 self-start">
          {isAddingList ? (
            <div className="w-full rounded-lg bg-gray-100 p-3">
              <Input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="リスト名を入力..."
                className="mb-2"
                autoFocus
                onKeyDown={(e) => {
                  // IME変換中は無視（日本語入力対応）
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') handleAddList();
                  if (e.key === 'Escape') {
                    setNewListName('');
                    setIsAddingList(false);
                  }
                }}
              />
              <div className="mb-2 flex flex-wrap gap-1">
                {LIST_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setNewListColor(color.value)}
                    className={cn(
                      'h-5 w-5 rounded-full transition-transform hover:scale-110',
                      newListColor === color.value &&
                        'ring-2 ring-offset-1 ring-primary'
                    )}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddList}>
                  追加
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewListName('');
                    setIsAddingList(false);
                  }}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="h-auto w-full justify-start border-dashed py-3"
              onClick={() => setIsAddingList(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              リストを追加
            </Button>
          )}
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask && (
          <TaskCard
            projectId={projectId}
            task={activeTask}
            listName={activeTaskList?.name ?? ''}
            listColor={activeTaskList?.color ?? '#64748b'}
            labels={labels.filter((l) => activeTask.labelIds.includes(l.id))}
            tags={tags.filter((t) => activeTask.tagIds?.includes(t.id))}
            allTasks={tasks}
            onClick={() => {}}
            isDragging
          />
        )}
        {activeList && (
          <div className="w-72 rounded-lg bg-gray-100 p-3 shadow-xl ring-2 ring-primary/20">
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: activeList.color }}
              />
              <span className="font-semibold">{activeList.name}</span>
              <span className="text-sm text-muted-foreground">
                {getTasksByListId(activeList.id).length}
              </span>
            </div>
          </div>
        )}
      </DragOverlay>

      {/* Delete List Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              リスト削除の確認
            </DialogTitle>
            <DialogDescription>
              リスト「{listToDelete?.name}」には
              {listToDelete && getTasksByListId(listToDelete.id).length}件の
              タスクがあります。タスクを別のリストに移動してから削除します。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="mb-2 block text-sm font-medium">
              タスクの移動先
            </label>
            <Select value={targetListId} onValueChange={setTargetListId}>
              <SelectTrigger>
                <SelectValue placeholder="移動先のリストを選択" />
              </SelectTrigger>
              <SelectContent>
                {displayLists
                  .filter((l) => l.id !== listToDelete?.id)
                  .map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        {l.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || !targetListId}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              タスクを移動して削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
