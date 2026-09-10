'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { sortTaskTable, type TableSortField, type TaskTableSort } from '@/lib/board/taskViews';
import { TaskAssignees, TaskDate, TaskFlowStateBadge, TaskPriority, TaskStatus } from './TaskViewFields';
import { taskReviewState } from '@/lib/board/taskViews';
import type { List, Task } from '@/types';

const columns: { id: TableSortField; label: string }[] = [
  { id: 'title', label: 'タスク' }, { id: 'list', label: '分類（現在の列）' }, { id: 'status', label: '状態' },
  { id: 'assignee', label: '担当者' }, { id: 'startDate', label: '開始日' }, { id: 'dueDate', label: '期限' }, { id: 'priority', label: '優先度' },
];
export function TaskTableView({ tasks, lists, names, onTaskClick }: { tasks: Task[]; lists: List[]; names: Record<string, string>; onTaskClick: (id: string) => void }) {
  const [sort, setSort] = useState<TaskTableSort>({ field: 'dueDate', direction: 'asc' });
  const sorted = sortTaskTable(tasks, lists, names, sort);
  return <section aria-label="タスクテーブル" className="space-y-2 p-3">
    <p className="text-xs text-muted-foreground">{sorted.length}件。見出しで並べ替え、タスク名で詳細を開きます。並べ替えは表示だけに適用します。</p>
    <div className="overflow-x-auto rounded-lg border bg-background">
      <table className="w-full min-w-[850px] table-fixed text-left">
        <caption className="sr-only">タスク一覧。列見出しから並べ替えできます。</caption>
        <colgroup><col className="w-[30%]" /><col className="w-[18%]" /><col className="w-[8%]" /><col className="w-[15%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[7%]" /></colgroup>
        <thead className="bg-muted/60 text-xs"><tr>{columns.map(column => <th key={column.id} scope="col" className="px-3 py-3" aria-sort={sort.field === column.id ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          <button type="button" className="flex items-center gap-1 whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSort({ field: column.id, direction: sort.field === column.id && sort.direction === 'asc' ? 'desc' : 'asc' })}>
            {column.label}{sort.field === column.id ? sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
          </button>
        </th>)}</tr></thead>
        <tbody className="divide-y">{sorted.map(task => <tr key={task.id} className="hover:bg-muted/30">
          <td className="px-3 py-3"><div className="flex flex-wrap items-start gap-2"><button type="button" onClick={() => onTaskClick(task.id)} className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring">{task.title}</button>{(() => { const state = taskReviewState(task, tasks); return state && <TaskFlowStateBadge label={state.label} completed={state.completed} />; })()}</div>{task.parentTaskId && <p className="mt-1 text-xs text-blue-700">親：{tasks.find(parent => parent.id === task.parentTaskId)?.title ?? '親タスクあり'}</p>}</td>
          <td className="break-words px-3 py-3 text-xs text-muted-foreground">{lists.find(list => list.id === task.listId)?.name ?? '分類不明'}</td>
          <td className="px-3 py-3"><TaskStatus task={task} /></td>
          <td className="px-3 py-3"><TaskAssignees task={task} names={names} /></td>
          <td className="px-3 py-3"><TaskDate date={task.startDate} /></td>
          <td className="px-3 py-3"><TaskDate date={task.dueDate} /></td>
          <td className="px-3 py-3"><TaskPriority task={task} /></td>
        </tr>)}</tbody>
      </table>
      {!sorted.length && <p className="p-6 text-center text-sm text-muted-foreground">表示条件に合うタスクはありません。</p>}
    </div>
  </section>;
}
