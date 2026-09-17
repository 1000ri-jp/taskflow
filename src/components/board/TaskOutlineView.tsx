'use client';
import { compactRow, taskTitle } from '@/components/ui/density';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { groupTaskOutline, taskReviewState } from '@/lib/board/taskViews';
import { TaskAssignees, TaskDate, TaskFlowStateBadge, TaskPriority, TaskStatus, type TaskViewMember } from './TaskViewFields';
import { groupTaskFamilies } from '@/lib/board/taskHierarchy';
import { TaskListPicker, type MoveTaskToList } from './TaskListPicker';
import { TaskChildrenSummary } from './TaskChildrenSummary';
import type { List, Task } from '@/types';

interface Props { projectId: string; viewerId: string; tasks: Task[]; allTasks?: Task[]; lists: List[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; onTaskClick: (id: string) => void; onMoveTask?: MoveTaskToList }
export function TaskOutlineView({ tasks, allTasks = tasks, lists, ...props }: Props) {
  const families = groupTaskFamilies(tasks, allTasks);
  const groups = groupTaskOutline(families.map(family => family.task), lists, 'due-asc');
  return <section aria-label="計画リスト" className="space-y-2 p-3">
    <p className="text-xs text-muted-foreground">現在の列を分類として縦に表示し、期限が早い順に並べています。タスク左の矢印でサブタスクを展開し、タスク名から詳細、横のフォルダ矢印からリストを変更できます。</p>
    {!tasks.length && <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">表示条件に合うタスクはありません。</p>}
    {groups.filter(group => group.tasks.length).map(group => <details key={group.id} open className="rounded-lg border bg-background">
      <summary className="cursor-pointer rounded-t-lg bg-muted/40 px-4 py-1.5 text-sm font-semibold">
        <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} /> {group.name}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{group.tasks.length}件 · 完了 {group.tasks.filter(task => task.isCompleted).length}件</span>
      </summary>
      <div className="hidden grid-cols-[minmax(240px,1fr)_75px_150px_105px_55px] gap-3 border-t px-4 py-2 text-xs text-muted-foreground lg:grid" aria-hidden="true">
        <span>タスク／サブタスク</span><span>状態</span><span>担当者</span><span>期限</span><span>優先度</span>
      </div>
      <div className="divide-y">{group.tasks.map(task => <OutlineTask key={task.id} task={task} siblings={allTasks} childrenTasks={families.find(family => family.task.id === task.id)?.children ?? []} lists={lists} {...props} />)}</div>
    </details>)}
  </section>;
}

function OutlineTask({ task, siblings, childrenTasks, lists, viewerId, names, members, onTaskClick, onMoveTask }: Omit<Props, 'tasks'> & { task: Task; siblings: Task[]; childrenTasks: Task[] }) {
  const [expanded, setExpanded] = useState(false);
  const reviewState = taskReviewState(task, siblings);
  return <div>
    <div className={`${compactRow} flex flex-wrap items-center gap-x-3 gap-y-1 px-4 lg:grid lg:grid-cols-[minmax(240px,1fr)_75px_150px_105px_55px] lg:gap-3`}>
      <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
        {childrenTasks.length > 0 ? <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${task.title}のサブタスクを${expanded ? '折りたたむ' : '展開'}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button> : <span className="size-8 shrink-0" aria-hidden="true" />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button type="button" className={taskTitle} onClick={() => onTaskClick(task.id)}><span className={task.isCompleted ? 'line-through' : undefined}>{task.title}</span></button>
          {onMoveTask && <TaskListPicker task={task} lists={lists} onMove={onMoveTask} />}
          {reviewState && <TaskFlowStateBadge label={reviewState.label} completed={reviewState.completed} />}
        </div>
      </div>
      <TaskStatus task={task} allTasks={siblings} /><TaskAssignees task={task} names={names} members={members} iconOnly />
      <span><span className="mr-1 text-xs text-muted-foreground lg:hidden">期限</span><TaskDate date={task.dueDate} /></span>
      <span><span className="mr-1 text-xs text-muted-foreground lg:hidden">優先度</span><TaskPriority task={task} /></span>
    </div>
    {task.parentTaskId && !siblings.some(parent => parent.id === task.parentTaskId && !parent.isArchived) && <p className="px-4 text-xs text-muted-foreground">親タスクを表示できません</p>}
    {expanded && <TaskChildrenSummary display="expanded" task={task} childrenTasks={childrenTasks} allTasks={siblings} lists={lists} viewerId={viewerId} names={names} members={members} onTaskClick={onTaskClick} onMoveTask={onMoveTask} />}
  </div>;
}
