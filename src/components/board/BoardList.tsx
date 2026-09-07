'use client';

import { useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { MoreHorizontal, Plus, Trash2, Palette, GripVertical, CheckCircle2, CircleOff, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import type { List, Task, Label, Tag } from '@/types';
import { LIST_COLORS } from '@/types';
import { useBoardSortStore } from '@/stores/boardSortStore';
import { sortBoardTasks } from '@/lib/board/sort';

interface BoardListProps {
  projectId: string;
  list: List;
  tasks: Task[];
  allTasks: Task[]; // All tasks in project for dependency lookup
  labels: Label[];
  tags: Tag[];
  onAddTask: (title: string, position: 'top' | 'bottom') => void;
  onEditList: (data: { name?: string; color?: string; autoCompleteOnEnter?: boolean; autoUncompleteOnExit?: boolean; autoSetStartDateOnEnter?: boolean }) => void;
  onDeleteList: () => void;
  onTaskClick: (taskId: string) => void;
  allLists: List[];
  onTaskMove: (taskId: string, listId: string) => void;
}

export function BoardList({
  projectId,
  list,
  tasks,
  allTasks,
  labels,
  tags,
  onAddTask,
  onEditList,
  onDeleteList,
  onTaskClick,
  allLists,
  onTaskMove,
}: BoardListProps) {
  const [taskComposerPosition, setTaskComposerPosition] = useState<'top' | 'bottom' | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(list.name);

  // Presentation only: retain saved order within each group without mutating tasks.
  const sortMode = useBoardSortStore(state => state.byProject[projectId] ?? 'manual');
  const displayTasks = sortBoardTasks(tasks, sortMode);

  // Sortable for list reordering
  const {
    attributes,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
    data: { type: 'list', list },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Droppable for receiving tasks
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `list-${list.id}`,
    data: { type: 'list', listId: list.id },
  });

  const closeTaskComposer = () => {
    setNewTaskTitle('');
    setTaskComposerPosition(null);
  };

  const handleAddTask = () => {
    if (newTaskTitle.trim() && taskComposerPosition) {
      onAddTask(newTaskTitle.trim(), taskComposerPosition);
      closeTaskComposer();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME変換中は無視（日本語入力対応）
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'Enter') {
      handleAddTask();
    } else if (e.key === 'Escape') {
      closeTaskComposer();
    }
  };

  const handleNameSave = () => {
    if (editName.trim() && editName !== list.name) {
      onEditList({ name: editName.trim() });
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    // IME変換中は無視（日本語入力対応）
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setEditName(list.name);
      setIsEditingName(false);
    }
  };

  return (
    <div
      ref={setSortableNodeRef}
      style={style}
      className={cn(
        'flex w-72 flex-shrink-0 flex-col rounded-lg bg-gray-100 transition-colors',
        isOver && 'bg-gray-200',
        isDragging && 'opacity-0'
      )}
      data-testid="board-list"
    >
      {/* List Header */}
      <div className="flex flex-shrink-0 items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
          <button
            className="cursor-grab touch-none text-gray-400 hover:text-gray-600"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: list.color }}
          />
          {isEditingName ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              className="h-7 w-32 text-sm font-semibold"
              autoFocus
            />
          ) : (
            <h3
              className="cursor-pointer font-semibold"
              onClick={() => setIsEditingName(true)}
            >
              {list.name}
            </h3>
          )}
          <span className="text-sm text-muted-foreground">{tasks.length}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                カラー変更
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {LIST_COLORS.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => onEditList({ color: color.value })}
                        className={cn(
                          'h-6 w-6 rounded-full transition-transform hover:scale-110',
                          list.color === color.value && 'ring-2 ring-offset-1 ring-primary'
                        )}
                        style={{ backgroundColor: color.value }}
                      />
                    ))}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onEditList({ autoCompleteOnEnter: !list.autoCompleteOnEnter })}
            >
              <CheckCircle2 className={cn('mr-2 h-4 w-4', list.autoCompleteOnEnter && 'text-green-600')} />
              ここに入ったら完了
              {list.autoCompleteOnEnter && <span className="ml-auto text-xs text-green-600">ON</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onEditList({ autoUncompleteOnExit: !list.autoUncompleteOnExit })}
            >
              <CircleOff className={cn('mr-2 h-4 w-4', list.autoUncompleteOnExit && 'text-amber-600')} />
              ここから出たら完了を外す
              {list.autoUncompleteOnExit && <span className="ml-auto text-xs text-amber-600">ON</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onEditList({ autoSetStartDateOnEnter: !list.autoSetStartDateOnEnter })}
            >
              <CalendarPlus className={cn('mr-2 h-4 w-4', list.autoSetStartDateOnEnter && 'text-blue-600')} />
              ここに入ったら開始日を設定
              {list.autoSetStartDateOnEnter && <span className="ml-auto text-xs text-blue-600">ON</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDeleteList}
              className="text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

          {/* Add Task - At Top */}
      <div className="flex-shrink-0 px-3 pb-2">
        {taskComposerPosition === 'top' ? (
          <div className="space-y-2 rounded-lg border bg-white p-2">
            <Input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="タスク名を入力..."
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddTask}>
                追加
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={closeTaskComposer}
              >
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start text-primary hover:text-primary"
            onClick={() => setTaskComposerPosition('top')}
          >
            <Plus className="mr-1 h-4 w-4" />
            タスクを追加
          </Button>
        )}
      </div>

      {/* Tasks */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setDroppableNodeRef}
            className="min-h-[40px] flex-1 space-y-2 px-3 pb-3"
          >
            <SortableContext
              items={displayTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  projectId={projectId}
                  task={task}
                  listName={list.name}
                  listColor={list.color}
                  labels={labels}
                  tags={tags}
                  allTasks={allTasks}
                  onClick={() => onTaskClick(task.id)}
                  lists={allLists}
                  onMove={(targetListId) => onTaskMove(task.id, targetListId)}
                  disableDragging={sortMode !== 'manual'}
                />
              ))}
            </SortableContext>

            {taskComposerPosition === 'bottom' ? (
              <div className="space-y-2 rounded-lg border bg-white p-2">
                <Input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="タスク名を入力..."
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddTask}>
                    追加
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={closeTaskComposer}
                  >
                    キャンセル
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setTaskComposerPosition('bottom')}
                className="flex w-full items-center gap-1 rounded-md py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-600"
              >
                <Plus className="h-4 w-4" />
                <span>タスクを追加</span>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setTaskComposerPosition('bottom')}>
            <Plus className="mr-2 h-4 w-4" />
            新規タスク
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
