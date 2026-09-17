'use client';

import { UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { assigneeLabel, taskDateLabel } from '@/lib/board/taskViews';
import { cn } from '@/lib/utils';
import { TASK_STATUSES, taskStatus } from '@/lib/task/status';
import type { Task } from '@/types';

export type TaskViewMember = { id: string; displayName: string; photoURL?: string | null };

export function TaskStatus({ task, allTasks = [] }: { task: Task; allTasks?: Task[] }) {
  const status = TASK_STATUSES.find(option => option.id === taskStatus(task, allTasks))!;
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', status.color)}>
    <span className={cn('h-2 w-2 rounded-full', status.dot)} aria-hidden="true" />{status.label}
  </span>;
}
export function TaskPriority({ task }: { task: Task }) {
  return <span className={cn('text-xs', task.priority === 'high' && 'font-medium text-rose-600')}>{task.priority ? { high: '高', medium: '中', low: '低' }[task.priority] : '—'}</span>;
}
export function TaskFlowStateBadge({ label, completed }: { label: string; completed: boolean }) {
  const isReviewPending = label.startsWith('確認依頼中');
  return <span aria-label={`TaskFlow ${label}`} className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-bold leading-none', completed ? 'bg-emerald-100 text-emerald-800' : isReviewPending ? 'bg-yellow-200 text-yellow-900' : 'bg-neutral-900 text-white')}>
    <span className="font-medium">{label}</span>
  </span>;
}
export function TaskAssignees({ task, names, members = {}, iconOnly = true, compact = false, maxVisible }: { task: Pick<Task, 'assigneeIds'>; names: Record<string, string>; members?: Record<string, TaskViewMember>; iconOnly?: boolean; compact?: boolean; maxVisible?: number }) {
  if (!iconOnly) return <span className="break-words text-xs text-muted-foreground">{assigneeLabel(task.assigneeIds, names)}</span>;
  if (!task.assigneeIds.length) return compact ? null : <span className="text-xs text-muted-foreground">—</span>;
  const labels = task.assigneeIds.map(id => names[id] || '名前未取得');
  const limit = maxVisible !== undefined && Number.isInteger(maxVisible) && maxVisible > 0 ? maxVisible : compact ? 2 : 4;
  const size = compact ? 'h-[18px] w-[18px] border' : 'h-6 w-6 border-2';
  return <span data-testid="task-assignees-icons" role="group" aria-label={`担当者: ${labels.join('、')}`} className="inline-flex shrink-0 -space-x-1">
    {task.assigneeIds.slice(0, limit).map((id, index) => {
      const member = members[id];
      return <Avatar key={id} aria-label={labels[index]} title={labels[index]} className={cn(size, 'border-background')}>
        <AvatarImage src={member?.photoURL || ''} alt="" />
        <AvatarFallback aria-hidden="true"><UserRound className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /></AvatarFallback>
      </Avatar>;
    })}
    {task.assigneeIds.length > limit && <span className={cn(size, 'flex items-center justify-center rounded-full border-background bg-muted text-[10px] font-medium')} title={`ほか${task.assigneeIds.length - limit}名: ${labels.slice(limit).join('、')}`} aria-label={`ほか${task.assigneeIds.length - limit}名`}>+{task.assigneeIds.length - limit}</span>}
  </span>;
}
export function TaskDate({ date }: { date: Date | null }) {
  return <span className="whitespace-nowrap text-xs tabular-nums">{taskDateLabel(date)}</span>;
}
