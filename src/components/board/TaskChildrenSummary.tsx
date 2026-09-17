'use client';

import { useId, useState } from 'react';
import { taskTitle } from '@/components/ui/density';
import { format } from 'date-fns';
import { Archive, Ban, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleHelp, ListTree, TriangleAlert, UserRound } from 'lucide-react';
import type { List, Task } from '@/types';
import { orderChildTasks } from '@/lib/board/taskHierarchy';
import { TaskListPicker, type MoveTaskToList } from './TaskListPicker';
import { TaskAssignees, type TaskViewMember } from './TaskViewFields';

export function TaskChildrenSummary({ task, childrenTasks, allTasks, viewerId, lists = [], names = {}, members, onTaskClick, onMoveTask, display = 'summary', rowLayout = 'stacked' }: {
  display?: 'summary' | 'expanded'; rowLayout?: 'stacked' | 'single-line'; task: Task; childrenTasks: Task[]; allTasks: Task[]; viewerId: string; lists?: List[];
  names?: Record<string, string>; members?: Record<string, TaskViewMember>; onTaskClick: (id: string) => void; onMoveTask?: MoveTaskToList;
}) {
  const pending = orderChildTasks(childrenTasks.filter(child => !child.isArchived && !child.isCompleted && !child.isAbandoned), allTasks);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? pending.length > 0;
  const singleLineSummary = display === 'summary' && rowLayout === 'single-line';
  const contentId = useId();
  if (!childrenTasks.length) return null;
  const mine = viewerId ? pending.filter(child => child.assigneeIds.includes(viewerId)) : [];
  const completed = childrenTasks.filter(child => !child.isArchived && child.isCompleted);
  const abandoned = childrenTasks.filter(child => !child.isArchived && !child.isCompleted && child.isAbandoned);
  const archived = childrenTasks.filter(child => child.isArchived);
  const hasUnfinishedChildren = task.isCompleted && pending.length > 0;
  const summary = `サブタスク ${childrenTasks.length}件・未完了 ${pending.length}件${mine.length ? `・自分の未完了 ${mine.length}件` : ''}${hasUnfinishedChildren ? '・親は完了・サブタスクは未完了です' : ''}`;
  const row = (child: Task) => {
    const statusLabel = child.isArchived ? 'アーカイブ' : child.isCompleted ? '完了' : child.isAbandoned ? '取りやめ' : child.taskKind === 'review_request' ? '確認待ち' : '未完了';
    const statusIcon = child.isArchived ? <Archive aria-hidden="true" className="size-3.5" /> : child.isCompleted ? <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" /> : child.isAbandoned ? <Ban aria-hidden="true" className="size-3.5" /> : child.taskKind === 'review_request' ? <CircleHelp aria-hidden="true" className="size-3.5 text-amber-600" /> : <Circle aria-hidden="true" className="size-3.5" />;
    return <div key={child.id} data-testid="task-child-row" className={display === 'expanded' ? 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1' : singleLineSummary ? 'flex min-w-0 items-center gap-x-2' : 'min-w-0 space-y-0.5'}>
      <button type="button" className={display === 'expanded' ? `${taskTitle} basis-full sm:basis-auto` : singleLineSummary ? `${taskTitle} min-h-6 text-xs` : taskTitle + ' block w-full text-xs'} onClick={() => onTaskClick(child.id)}>
        <span className={child.isCompleted ? 'line-through text-muted-foreground' : undefined}>{child.title || '名称未設定のサブタスク'}</span>
      </button>
      {onMoveTask && !child.isArchived && <TaskListPicker task={child} lists={lists} onMove={onMoveTask} showName={display === 'summary' || child.listId !== task.listId} />}
      <div data-testid="task-child-metadata" className={`flex min-w-0 ${singleLineSummary ? 'shrink-0 flex-nowrap' : 'flex-wrap'} items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground`}>
        <span className="inline-flex shrink-0 items-center" title={statusLabel}>
          {statusIcon}
          <span className="sr-only">{statusLabel}</span>
        </span>
        <TaskAssignees task={child} names={names} members={members} compact />
        {child.dueDate && <time dateTime={format(child.dueDate, 'yyyy-MM-dd')} aria-label={`期限：${format(child.dueDate, 'yyyy年M月d日')}`} title={`期限：${format(child.dueDate, 'yyyy年M月d日')}`} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums"><CalendarDays aria-hidden="true" className="size-3.5" />{format(child.dueDate, 'M/d')}</time>}
        {child.listId !== task.listId && ` · ${lists.find(list => list.id === child.listId)?.name ?? '別のリスト'}`}
        {child.parentTaskId && child.parentTaskId !== task.id && ` · 親：${allTasks.find(parent => parent.id === child.parentTaskId)?.title ?? '表示できません'}`}
        {(child.dependsOnTaskIds ?? []).some(id => !allTasks.find(item => item.id === id)?.isCompleted) && ' · 前の作業待ち'}
      </div>
    </div>;
  };
  return <div aria-label={display === 'expanded' ? `${task.title}のサブタスク` : undefined} className={display === 'expanded' ? 'relative ml-9 mr-4 mb-2 border-l-2 pl-4' : 'relative border-t bg-slate-50/70 px-2.5 py-1'} data-testid="task-children-summary" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
    <span id={`${contentId}-summary`} className="sr-only">{summary}</span>
    {display === 'summary' && <button type="button" className="flex min-h-6 w-full items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={expanded} aria-controls={expanded ? contentId : undefined} aria-label={`${task.title}のサブタスクを${expanded ? '折りたたむ' : '展開'}`} aria-describedby={`${contentId}-summary`} title={summary} onClick={() => setExpandedOverride(value => !(value ?? pending.length > 0))}>
      <ListTree aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>サブタスク {childrenTasks.length}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {hasUnfinishedChildren && <span title="親は完了・サブタスクは未完了です"><TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" /></span>}
        {mine.length > 0 && <span title={`自分の未完了 ${mine.length}件`} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary"><UserRound aria-hidden="true" className="h-3 w-3" />{mine.length}</span>}
        {expanded ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
      </span>
    </button>}
    {(expanded || display === 'expanded') && <div id={contentId} className={display === 'expanded' ? 'space-y-2 pb-1' : singleLineSummary ? 'mt-1 space-y-0.5' : 'mt-2 space-y-3 pb-1'}>
      {hasUnfinishedChildren && <p className="text-xs text-amber-800 dark:text-amber-300">親は完了・サブタスクは未完了です</p>}
      {pending.map(row)}
      {completed.length > 0 && <details><summary className="cursor-pointer py-1 text-xs text-muted-foreground">完了済み {completed.length}件</summary><div className="mt-2 space-y-3">{completed.map(row)}</div></details>}
      {archived.length > 0 && <details><summary className="cursor-pointer text-xs text-muted-foreground">アーカイブ {archived.length}件</summary><div className="mt-2 space-y-3">{archived.map(row)}</div></details>}
      {abandoned.length > 0 && <details><summary className="cursor-pointer text-xs text-muted-foreground">取りやめ {abandoned.length}件</summary><div className="mt-2 space-y-3">{abandoned.map(row)}</div></details>}
    </div>}
  </div>;
}
