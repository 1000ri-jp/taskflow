'use client';

import { CheckCircle2, Circle, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { assigneeLabel, taskDateLabel } from '@/lib/board/taskViews';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';

export type TaskViewMember = { id: string; displayName: string; photoURL?: string | null };

export function TaskStatus({ task }: { task: Task }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', task.isCompleted ? 'text-emerald-700' : 'text-muted-foreground')}>
    {task.isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}{task.isCompleted ? '完了' : '未完了'}
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
export function TaskAssignees({ task, names, members = {}, iconOnly = false }: { task: Task; names: Record<string, string>; members?: Record<string, TaskViewMember>; iconOnly?: boolean }) {
  if (!iconOnly) return <span className="break-words text-xs text-muted-foreground">{assigneeLabel(task.assigneeIds, names)}</span>;
  if (!task.assigneeIds.length) return <span className="text-xs text-muted-foreground">—</span>;
  const labels = task.assigneeIds.map(id => names[id] || '名前未取得');
  return <div data-testid="task-assignees-icons" role="group" aria-label={`担当者: ${labels.join('、')}`} className="flex -space-x-1">
    {task.assigneeIds.slice(0, 4).map((id, index) => {
      const member = members[id];
      return <Avatar key={id} aria-label={labels[index]} title={labels[index]} className="h-6 w-6 border-2 border-background">
        <AvatarImage src={member?.photoURL || ''} alt="" />
        <AvatarFallback aria-hidden="true"><UserRound className="h-3.5 w-3.5" /></AvatarFallback>
      </Avatar>;
    })}
    {task.assigneeIds.length > 4 && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium" title={`ほか${task.assigneeIds.length - 4}名`} aria-label={`ほか${task.assigneeIds.length - 4}名`}>+{task.assigneeIds.length - 4}</span>}
  </div>;
}
export function TaskDate({ date }: { date: Date | null }) {
  return <span className="whitespace-nowrap text-xs tabular-nums">{taskDateLabel(date)}</span>;
}
