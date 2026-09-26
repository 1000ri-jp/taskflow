'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { TASK_STATUSES, taskStatus } from '@/lib/task/status';
import { taskSituation } from '@/lib/task/history/presentation';
import { format, isBefore, isSameDay, isValid, startOfDay } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { TaskAssignees, type TaskViewMember } from '@/components/board/TaskViewFields';
import { ProjectMark } from '@/components/project/ProjectMark';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ControlHint } from '@/components/ui/control-hint';
import type { ReviewRequester } from '@/lib/dashboard/review-requests';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { cn } from '@/lib/utils';
import { compactRow, taskRowInteraction } from '@/components/ui/density';
import type { Priority } from '@/types';
import { isStrictDeadlineTask } from '@/lib/task/deadlinePolicy';

export const NEO_TASK_ROW_CLASS = compactRow + ' py-0.5 rounded-md px-5 ' + taskRowInteraction;
export const NEO_TASK_LIST_CLASS = 'space-y-0.5';
export const NEO_TASK_LIST_END_CLASS = `${NEO_TASK_LIST_CLASS} pb-4`;

interface PeopleProps {
  task: DashboardTask;
  members: Record<string, TaskViewMember>;
  names: Record<string, string>;
  requester?: ReviewRequester;
  assigneeLimit?: number;
  tasks?: readonly DashboardTask[];
}
const priorities: Record<Priority, { label: string; className: string }> = {
  high: { label: '高', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  medium: { label: '中', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  low: { label: '低', className: 'border-slate-200 bg-slate-50 text-slate-600' },
};

function RequesterAvatar({ requester, members }: { requester: ReviewRequester; members: Record<string, TaskViewMember> }) {
  const person = requester.id ? members[requester.id] : undefined;
  const knownSelf = !!requester.id && requester.isSelf;
  const name = knownSelf ? '自分' : requester.name;
  const label = name ? `依頼者: ${name}` : '依頼者を確認';
  return <ControlHint label={label} description={!name ? '依頼者名は未取得です。' : undefined}>
    <Avatar role="img" aria-label={label} title={label} tabIndex={0} className="h-[18px] w-[18px] border border-background focus-visible:outline-2 focus-visible:outline-ring">
      <AvatarImage src={person?.photoURL || ''} alt="" />
      <AvatarFallback aria-hidden="true" className="text-[9px]">{name ? name.slice(0, 2) : '?'}</AvatarFallback>
    </Avatar>
  </ControlHint>;
}

export function NeoBriefTaskMeta({ task, members, names, requester, assigneeLimit = 5, showPriority = true }: PeopleProps & { showPriority?: boolean }) {
  const priority = task.priority ? priorities[task.priority] : null;
  return <span className={cn('inline-flex shrink-0 items-center', requester ? 'gap-0' : 'gap-2')}>
    {showPriority && priority && <Badge variant="outline" aria-label={`優先度: ${priority.label}`} className={cn('h-5 rounded px-1.5 py-0 text-[10px]', priority.className)}>{priority.label}</Badge>}
    {requester && <><RequesterAvatar requester={requester} members={members} /><ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /></>}
    <TaskAssignees task={task} names={names} members={members} iconOnly maxVisible={assigneeLimit} />
  </span>;
}

/** Shared visual order for ordinary work and review requests; task data stays untouched. */
export function NeoBriefTaskHeading({ task, now, members, names, requester, assigneeLimit, displayTitle, parentTitle, statusLabel, hideProgress = false, completionControl, progressControl, scheduleControl, taskHref, taskLinkTarget = '_self', miniLayout = false, tasks = [] }: PeopleProps & { now: Date; displayTitle?: string; parentTitle?: string; statusLabel?: string; hideProgress?: boolean; completionControl?: ReactNode; progressControl?: ReactNode; scheduleControl?: ReactNode; taskHref?: string; taskLinkTarget?: '_self' | '_blank'; miniLayout?: boolean }) {
  const due = task.dueDate && isValid(task.dueDate) ? task.dueDate : null;
  const overdue = due && isBefore(due, startOfDay(now));
  const priority = task.priority ? priorities[task.priority] : null;
  const strict = isStrictDeadlineTask(task);
  const showSituation = task.review || task.workProgress || task.taskKind === 'decision' || tasks.some(t => t.projectId === task.projectId && t.parentTaskId === task.id && t.review);
  const situation = showSituation ? taskSituation(task, tasks.filter(t => t.projectId === task.projectId), names, []) : null;
  const status = TASK_STATUSES.find(option => option.id === taskStatus(task, tasks))!;
  const hasExplicitProgress = statusLabel === '着手中' || statusLabel === '未着手';
  const duplicateProgressSituation = hasExplicitProgress && (situation?.situation === '着手' || situation?.situation === '未着手');
  if (miniLayout) return <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 py-2">
    <span className="flex items-start gap-1">{completionControl}<ProjectMark name={task.projectName} color={task.projectColor} /></span>
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-5">{taskHref ? <Link prefetch={false} href={taskHref} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined}>{displayTitle ?? task.title}</Link> : displayTitle ?? task.title}</span>
        <NeoBriefTaskMeta task={task} members={members} names={names} requester={requester} assigneeLimit={assigneeLimit} showPriority={false} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {statusLabel && !(hideProgress && hasExplicitProgress) && <span className="rounded border border-primary/30 bg-primary/5 px-1.5 leading-5">{statusLabel}</span>}
        {situation && !duplicateProgressSituation && !(hideProgress && ['着手', '未着手'].includes(situation.situation)) && <span className={cn('rounded border border-current/20 px-1.5 leading-5', status.color)}>{situation.situation}</span>}
        {progressControl}
        <span className={cn('inline-flex items-center gap-1', (overdue || strict) && 'text-rose-700')}>
          {scheduleControl}
          {due ? <time dateTime={due.toISOString()}>{strict ? `${format(due, 'M/d H:mm')}に` : `期限 ${format(due, 'M/d')}`}{overdue ? '・期限超過' : ''}</time> : task.dueDate ? '期限を確認できません' : '期限なし'}
          {task.startDate && isValid(task.startDate) && isSameDay(task.startDate, now) && '・今日から'}
        </span>
        {priority && <Badge variant="outline" aria-label={`優先度: ${priority.label}`} className={cn('h-5 rounded px-1.5 py-0 text-[10px]', priority.className)}>{priority.label}</Badge>}
      </div>
      {(task.listName || parentTitle) && <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">{task.listName && <span>{task.listName}</span>}{parentTitle && <span title={`親タスク: ${parentTitle}`}>／ {parentTitle}</span>}</div>}
    </div>
  </div>;
  return <div className="flex min-h-8 items-center gap-2">
    {completionControl}
    <ProjectMark name={task.projectName} color={task.projectColor} />
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <p className="flex min-w-[min(100%,10rem)] flex-1 flex-wrap items-center gap-x-3 gap-y-1 break-words text-sm"><span className="min-w-0 font-medium">{taskHref ? <Link prefetch={false} href={taskHref} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined}>{displayTitle ?? task.title}</Link> : displayTitle ?? task.title}</span>
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {statusLabel && !(hideProgress && hasExplicitProgress) && <span className="inline-flex items-center rounded border border-primary/30 bg-primary/5 px-1.5 text-[10px] leading-5">{statusLabel}</span>}
          {situation && !duplicateProgressSituation && !(hideProgress && ['着手', '未着手'].includes(situation.situation)) && <span title={`${situation.situation} · ${situation.next}`} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded border border-current/20 px-1.5 text-[10px] leading-5', status.color)}><span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden="true" />{situation.situation}</span>}
          {!miniLayout && task.listName && <span className={cn('inline-block max-w-full rounded border px-1.5 text-[10px] font-medium leading-5', priority?.className ?? 'bg-muted text-muted-foreground')}>{task.listName}</span>}
          {!miniLayout && parentTitle && <span className="min-w-0 max-w-full break-words text-xs text-muted-foreground" title={`親タスク: ${parentTitle}`}>{parentTitle}</span>}
          <span className="inline-flex items-center gap-x-2 whitespace-nowrap">
          {progressControl}
          <span className="inline-flex items-center">
          {strict && !miniLayout && <Badge variant="outline" className="mr-1.5 h-5 rounded border-rose-300 bg-rose-50 px-1.5 py-0 text-[10px] font-semibold text-rose-700">期限厳守</Badge>}
          {scheduleControl}
          <span className={cn('inline-flex h-7 items-center text-xs leading-none text-muted-foreground', (overdue || strict) && 'text-rose-700')}>
            {due ? strict && miniLayout
              ? <Badge variant="outline" className="mr-1.5 h-5 rounded border-rose-300 bg-rose-50 px-2 py-0 text-[11px] font-semibold text-rose-700"><time dateTime={due.toISOString()}>{format(due, 'M/d H:mm')}{overdue ? '・期限超過' : ''}</time></Badge>
              : <time dateTime={due.toISOString()}>{strict ? `${format(due, 'M/d H:mm')}に` : `期限 ${format(due, 'M/d')}`}{overdue ? '・期限超過' : ''}</time>
              : task.dueDate ? '期限を確認できません' : '期限なし'}
            {task.startDate && isValid(task.startDate) && isSameDay(task.startDate, now) && '・今日から'}
          </span>
          </span>
          </span>
          {miniLayout && task.listName && <span className={cn('inline-block max-w-full rounded border px-1.5 text-[10px] font-medium leading-5', priority?.className ?? 'bg-muted text-muted-foreground')}>{task.listName}</span>}
          {miniLayout && parentTitle && <span className="min-w-0 max-w-full break-words text-xs text-muted-foreground" title={`親タスク: ${parentTitle}`}>{parentTitle}</span>}
        </span>
      </p>
      <span className="ml-auto inline-flex items-center"><NeoBriefTaskMeta task={task} members={members} names={names} requester={requester} assigneeLimit={assigneeLimit} showPriority={false} /></span>
    </div>
    <span className="inline-flex h-5 w-6 shrink-0 items-center justify-end" aria-hidden={priority ? undefined : true}>
      {priority && <Badge variant="outline" aria-label={`優先度: ${priority.label}`} className={cn('h-5 shrink-0 rounded px-1.5 py-0 text-[10px]', priority.className)}>{priority.label}</Badge>}
    </span>
  </div>;
}
