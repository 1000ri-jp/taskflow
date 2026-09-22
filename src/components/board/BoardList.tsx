'use client';

import { useEffect, useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { MoreHorizontal, Plus, Trash2, GripVertical, CheckCircle2, CircleOff, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskCreationForm } from '@/components/task/TaskCreationForm';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColumnDisplayOptions } from './ColumnDisplayOptions';
import { boardColumnScope, useBoardColumnStore } from '@/stores/boardColumnStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TaskChildrenSummary } from './TaskChildrenSummary';
import type { TaskViewMember } from './TaskViewFields';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import type { List, Task, Label, Tag } from '@/types';
import { ListColorPalette } from './ListColorPalette';
import { useBoardSortStore } from '@/stores/boardSortStore';
import { sortBoardTasks } from '@/lib/board/sort';
import { ListReferencesPanel } from './ListReferencesPanel';

interface BoardListProps {
  projectId: string;
  list: List;
  tasks: Task[];
  allTasks: Task[]; // All tasks in project for dependency lookup
  childrenByParent?: Map<string, Task[]>;
  contextIds?: Set<string>;
  viewerId?: string;
  childNames?: Record<string, string>;
  childMemberDetails?: Record<string, TaskViewMember>;
  labels: Label[];
  tags: Tag[];
  onAddTask: (title: string, position: 'top' | 'bottom', assigneeIds?: string[]) => unknown | Promise<unknown>;
  onEditList: (data: { name?: string; color?: string; autoCompleteOnEnter?: boolean; autoUncompleteOnExit?: boolean; autoSetStartDateOnEnter?: boolean; defaultAssigneeId?: string | null }) => unknown | Promise<unknown>;
  projectMemberIds?: string[];
  projectMembers?: { id: string; displayName: string }[];
  projectMembersLoading?: boolean;
  projectMembersError?: boolean;
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
  childrenByParent,
  contextIds,
  viewerId = '',
  childNames, childMemberDetails,
  labels,
  tags,
  onAddTask,
  onEditList,
  onDeleteList,
  onTaskClick,
  allLists,
  onTaskMove,
  projectMemberIds = [],
  projectMembers = [],
  projectMembersLoading = false,
  projectMembersError = false,
}: BoardListProps) {
  const [taskComposerPosition, setTaskComposerPosition] = useState<'top' | 'bottom' | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(list.name);
  const [assigneeSelection, setAssigneeSelection] = useState<string | undefined>();
  const [assigneeSaveBusy, setAssigneeSaveBusy] = useState(false);
  const [assigneeSaveError, setAssigneeSaveError] = useState('');

  // Presentation only: retain saved order within each group without mutating tasks.
  const sharedSort = useBoardSortStore(state => state.byProject[projectId] ?? 'due-asc');
  const scope = boardColumnScope(viewerId, projectId, list.id);
  const { byScope, hydrate, save, persistenceFailed } = useBoardColumnStore();
  useEffect(() => { hydrate(); }, [hydrate, scope]);
  const options = byScope[scope] ?? { display: {} };
  const sortMode = options.sort ?? sharedSort;
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
    setTaskComposerPosition(null);
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
      {/* List Header and related information share the same controller. */}
      <ListReferencesPanel projectId={projectId} listId={list.id} renderTrigger={trigger => (
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
          <span className="shrink-0 text-xs text-muted-foreground" title="親タスクの件数。サブタスクは各カードの中に表示します">{tasks.length}件</span>
          {trigger}
        </div>

        <Popover>
          <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`${list.name}列の設定`}><MoreHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-64 max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto">
            <ColumnDisplayOptions name={list.name} sort={sortMode} display={options.display} onSort={sort => save(scope, { ...options, sort })} onDisplay={display => save(scope, { ...options, display })} onReset={() => save(scope, { sort: 'due-asc', display: {} })} error={persistenceFailed}>
              <div className="space-y-2"><p className="text-xs text-muted-foreground">カラー</p><ListColorPalette label={`${list.name}の色`} value={list.color} onChange={color => onEditList({ color })} /></div>
            </ColumnDisplayOptions>
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs text-muted-foreground">リストの動作（メンバー共通）</p>
              <label className="block space-y-1 py-1 text-xs font-medium">
                <span>新しいタスクの主担当</span>
                <select aria-label={`${list.name}の主担当`} className="h-9 w-full rounded-md border bg-background px-2 text-sm font-normal" value={assigneeSelection ?? list.defaultAssigneeId ?? ''} disabled={projectMembersLoading || projectMembersError || assigneeSaveBusy} onChange={event => {
                  const value = event.target.value;
                  setAssigneeSelection(value);
                  setAssigneeSaveError('');
                  setAssigneeSaveBusy(true);
                  void Promise.resolve().then(() => onEditList({ defaultAssigneeId: value || null }))
                    .then(() => setAssigneeSelection(undefined))
                    .catch(reason => setAssigneeSaveError(reason instanceof Error ? reason.message : '主担当を保存できませんでした。選択を確認して再試行してください。'))
                    .finally(() => setAssigneeSaveBusy(false));
                }}>
                  <option value="">プロジェクトの主担当を使う</option>
                  {projectMembers.filter(member => projectMemberIds.includes(member.id)).map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                  {list.defaultAssigneeId && !projectMemberIds.includes(list.defaultAssigneeId) && <option value={list.defaultAssigneeId}>現在のメンバーではありません</option>}
                </select>
              </label>
              {projectMembersError && <p role="alert" className="text-xs text-destructive">メンバーを取得できません。再読み込みしてから選んでください。</p>}
              {assigneeSaveError && <p role="alert" className="text-xs text-destructive">{assigneeSaveError}</p>}
              <p className="text-xs text-muted-foreground">指定した場合はプロジェクトの主担当より優先します。未設定ならプロジェクトの主担当を使います。</p>
              <Button type="button" variant="ghost" className="h-auto w-full justify-start px-0 text-xs" aria-pressed={list.autoCompleteOnEnter} onClick={() => onEditList({ autoCompleteOnEnter: !list.autoCompleteOnEnter })}><CheckCircle2 className="mr-2 h-4 w-4" />ここに入ったら完了{list.autoCompleteOnEnter && <span className="ml-auto text-green-600">ON</span>}</Button>
              <Button type="button" variant="ghost" className="h-auto w-full justify-start px-0 text-xs" aria-pressed={list.autoUncompleteOnExit} onClick={() => onEditList({ autoUncompleteOnExit: !list.autoUncompleteOnExit })}><CircleOff className="mr-2 h-4 w-4" />ここから出たら完了を外す{list.autoUncompleteOnExit && <span className="ml-auto text-amber-600">ON</span>}</Button>
              <Button type="button" variant="ghost" className="h-auto w-full justify-start px-0 text-xs" aria-pressed={list.autoSetStartDateOnEnter} onClick={() => onEditList({ autoSetStartDateOnEnter: !list.autoSetStartDateOnEnter })}><CalendarPlus className="mr-2 h-4 w-4" />ここに入ったら開始日を設定{list.autoSetStartDateOnEnter && <span className="ml-auto text-blue-600">ON</span>}</Button>
              <Button type="button" variant="ghost" className="w-full justify-start px-0 text-red-600" onClick={onDeleteList}><Trash2 className="mr-2 h-4 w-4" />削除</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      )} />

          {/* Add Task - At Top */}
      <div className="flex-shrink-0 px-3 pb-2">
        {taskComposerPosition === 'top' ? (
          <TaskCreationForm projectId={projectId} listDefaultAssigneeId={list.defaultAssigneeId} onSubmit={(title, assigneeIds) => onAddTask(title, 'top', assigneeIds)} onCancel={closeTaskComposer} />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-end px-2 text-xs text-primary hover:text-primary"
            onClick={() => setTaskComposerPosition('top')}
          >
            <Plus className="mr-1 size-3" />
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
                  displaySettings={options.display}
                  labels={labels}
                  tags={tags}
                  allTasks={allTasks}
                  onClick={() => onTaskClick(task.id)}
                  lists={allLists}
                  onMove={(targetListId) => onTaskMove(task.id, targetListId)}
                  disableDragging={contextIds?.has(task.id)}
                  footer={<>
                    {contextIds?.has(task.id) && <p className="px-2.5 py-1 text-[11px] text-muted-foreground">条件に合うサブタスクの親</p>}
                    <TaskChildrenSummary task={task} childrenTasks={childrenByParent?.get(task.id) ?? []} allTasks={allTasks} viewerId={viewerId} names={childNames} members={childMemberDetails} lists={allLists} onTaskClick={onTaskClick} rowLayout="single-line" />
                  </>}
                />
              ))}
            </SortableContext>

            {taskComposerPosition === 'bottom' ? (
              <TaskCreationForm projectId={projectId} listDefaultAssigneeId={list.defaultAssigneeId} onSubmit={(title, assigneeIds) => onAddTask(title, 'bottom', assigneeIds)} onCancel={closeTaskComposer} />
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
