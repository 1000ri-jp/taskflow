'use client';
import { compactCell, taskRowInteraction, taskTitle } from '@/components/ui/density';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { sortTaskTable, type TableSortField, type TaskTableSort } from '@/lib/board/taskViews';
import { TaskAssignees, type TaskViewMember, TaskDate, TaskFlowStateBadge, TaskPriority, TaskStatus } from './TaskViewFields';
import { taskReviewState } from '@/lib/board/taskViews';
import { groupTaskFamilies } from '@/lib/board/taskHierarchy';
import { TaskListPicker, type MoveTaskToList } from './TaskListPicker';
import { TaskChildrenSummary } from './TaskChildrenSummary';
import type { List, Task } from '@/types';

const columns: { id: TableSortField; label: string }[] = [
  { id: 'title', label: 'タスク' }, { id: 'list', label: '分類（現在の列）' }, { id: 'status', label: '状態' },
  { id: 'assignee', label: '担当者' }, { id: 'startDate', label: '開始日' }, { id: 'dueDate', label: '期限' }, { id: 'priority', label: '優先度' },
];
export function TaskTableView({ tasks, allTasks = tasks, viewerId = '', lists, names, members = {}, onTaskClick, onMoveTask }: { tasks: Task[]; allTasks?: Task[]; viewerId?: string; lists: List[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; onTaskClick: (id: string) => void; onMoveTask?: MoveTaskToList }) {
  const [sort, setSort] = useState<TaskTableSort>({ field: 'dueDate', direction: 'asc' });
  const families = groupTaskFamilies(tasks, allTasks);
  const sorted = sortTaskTable(families.map(family => family.task), lists, names, sort, allTasks);
  return <section aria-label="タスクテーブル" className="space-y-2 p-3">
    <p className="text-xs text-muted-foreground">{sorted.length}件。見出しで並べ替え、タスク名で詳細を開きます。並べ替えは表示だけに適用します。</p>
    <div className="overflow-x-auto rounded-lg border bg-background">
      <table className="w-full min-w-[850px] table-fixed text-left">
        <caption className="sr-only">タスク一覧。列見出しから並べ替えできます。</caption>
        <colgroup><col className="w-[30%]" /><col className="w-[18%]" /><col className="w-[8%]" /><col className="w-[15%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[7%]" /></colgroup>
        <thead className="bg-muted/60 text-xs"><tr>{columns.map(column => <th key={column.id} scope="col" className={compactCell} aria-sort={sort.field === column.id ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          <button type="button" className="flex items-center gap-1 whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSort({ field: column.id, direction: sort.field === column.id && sort.direction === 'asc' ? 'desc' : 'asc' })}>
            {column.label}{sort.field === column.id ? sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
          </button>
        </th>)}</tr></thead>
        <tbody className="divide-y">{sorted.map(task => <tr key={task.id} className={taskRowInteraction}>
          <td className={compactCell}><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => onTaskClick(task.id)} className={taskTitle}><span className={task.isCompleted ? 'line-through' : undefined}>{task.title}</span></button>{(() => { const state = taskReviewState(task, allTasks); return state && <TaskFlowStateBadge label={state.label} completed={state.completed} />; })()}</div>{task.parentTaskId && <p className="mt-1 text-xs text-blue-700">親：{allTasks.find(parent => parent.id === task.parentTaskId)?.title ?? '親タスクを表示できません'}</p>}<TaskChildrenSummary task={task} childrenTasks={families.find(family => family.task.id === task.id)?.children ?? []} allTasks={allTasks} viewerId={viewerId} names={names} members={members} lists={lists} onTaskClick={onTaskClick} onMoveTask={onMoveTask} /></td>
          <td className={`${compactCell} break-words text-xs text-muted-foreground`}>{onMoveTask ? <TaskListPicker task={task} lists={lists} onMove={onMoveTask} showName /> : lists.find(list => list.id === task.listId)?.name ?? '分類不明'}</td>
          <td className={compactCell}><TaskStatus task={task} allTasks={allTasks} /></td>
          <td className={compactCell}><TaskAssignees task={task} names={names} members={members} /></td>
          <td className={compactCell}><TaskDate date={task.startDate} /></td>
          <td className={compactCell}><TaskDate date={task.dueDate} /></td>
          <td className={compactCell}><TaskPriority task={task} /></td>
        </tr>)}</tbody>
      </table>
      {!sorted.length && <p className="p-6 text-center text-sm text-muted-foreground">表示条件に合うタスクはありません。</p>}
    </div>
  </section>;
}
