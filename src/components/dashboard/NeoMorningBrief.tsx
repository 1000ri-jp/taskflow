'use client';

import Link from 'next/link';
import { useChecklistDeadlines } from '@/hooks/useChecklistDeadlines';
import { format, isBefore, isValid, startOfDay } from 'date-fns';
import { AlertTriangle, Bell, Clock3 } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { buildNeoBrief, isNeoAutomationReminder, neoDependencyEvidence, neoTaskKey } from '@/lib/dashboard/neo-brief';
import { notificationTaskHref } from '@/lib/task/commentSubmission';
import { NeoCalendar } from './NeoCalendar';
import { NeoReviewRequests, type NeoReviewRequestsProps } from './NeoReviewRequests';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { Notification } from '@/types';
import type { BriefTaskScope } from '@/stores/briefDisplayStore';
import type { TaskViewMember } from '@/components/board/TaskViewFields';
import { taskRowInteraction } from '@/components/ui/density';
import { cn } from '@/lib/utils';
import { NEO_TASK_LIST_END_CLASS, NEO_TASK_ROW_CLASS, NeoBriefTaskHeading, NeoBriefTaskMeta } from './NeoBriefTaskRow';
import type { ReactNode } from 'react';
import type { BriefTaskControls, BriefTaskControlsRenderer } from '@/components/desktop/DesktopBriefTaskActions';

export type BriefTaskActionRenderer = (task: DashboardTask, renderControls?: BriefTaskControlsRenderer) => ReactNode;

function BriefTask({ task, tasks, now, call, members, names, statusLabel, miniLayout = false, taskLinkTarget = '_self', taskActions }: { task: DashboardTask; tasks: readonly DashboardTask[]; now: Date; call?: Notification; members: Record<string, TaskViewMember>; names: Record<string, string>; statusLabel?: string; miniLayout?: boolean; taskLinkTarget?: '_self' | '_blank'; taskActions?: BriefTaskActionRenderer }) {
  const dependencies = neoDependencyEvidence(task, tasks);
  const row = (controls?: BriefTaskControls) => <div className={cn("flex min-w-0 items-center", controls && "pr-5")}>
      <div className="min-w-0 flex-1">
        {controls ? <div className={`group block ${NEO_TASK_ROW_CLASS} pr-0`}>
          <NeoBriefTaskHeading task={task} tasks={tasks} now={now} members={members} names={names} parentTitle={task.parentTitle} statusLabel={statusLabel} hideProgress={Boolean(taskActions)} miniLayout={miniLayout} completionControl={controls.actions} progressControl={controls.progress} scheduleControl={controls.schedule} taskHref={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} taskLinkTarget={taskLinkTarget} />
        </div> : <Link prefetch={false} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} className={`group block ${NEO_TASK_ROW_CLASS}`}>
          <NeoBriefTaskHeading task={task} tasks={tasks} now={now} members={members} names={names} parentTitle={task.parentTitle} statusLabel={statusLabel} hideProgress={Boolean(taskActions)} miniLayout={miniLayout} />
        </Link>}
        {task.workState && <p className="mt-1 break-words text-xs leading-relaxed text-amber-800">{task.workState.status === 'hold' ? '保留' : '待ち'}：{task.workState.reason} ／ 再開の条件：{task.workState.resumeCondition || '要確認'}{task.workState.reviewAt && ` ／ ${new Date(task.workState.reviewAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}に再確認`}</p>}
        {dependencies.length > 0 && <p className="mt-2 break-words text-xs leading-relaxed text-amber-800">{dependencies.map(dependency => dependency.state === 'unknown' ? `前提は未確認（${dependency.title}）` : dependency.state === 'cancelled' ? `前提「${dependency.title}」は取りやめ済み・条件の見直しが必要` : `前提「${dependency.title}」の完了待ち`).join(' ／ ')}</p>}
        {call && <Link prefetch={false} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined} href={notificationTaskHref(call)} className="mt-2 inline-block text-xs text-primary underline">{isNeoAutomationReminder(call) ? '全員分の確認状況（自動確認）' : `${call.senderName || 'メンバー'}からの呼びかけを確認`}</Link>}
      </div>
    </div>;
  return <li className={miniLayout ? 'border-b last:border-b-0' : undefined}>{taskActions ? taskActions(task, row) : row()}</li>;
}

type NeoBriefProps = NeoReviewRequestsProps & { taskScope?: BriefTaskScope; assigneeFilterId?: string | null; assigneeFilterName?: string; showStrict?: boolean; now?: Date; miniLayout?: boolean; showFooterNote?: boolean; taskActions?: BriefTaskActionRenderer };

function StrictDeadlineSection({ checklistUserId, checklistScope, checklistAssignee, hideEmpty = false, items, available, now, memberById, names, incomplete, emptyText, standalone = false, miniLayout = false, taskLinkTarget = '_self', taskActions }: { checklistUserId: string | null; checklistScope?: BriefTaskScope; checklistAssignee?: string | null; hideEmpty?: boolean; items: DashboardTask[]; available: readonly DashboardTask[]; now: Date; memberById: Record<string, TaskViewMember>; names: Record<string, string>; incomplete: boolean; emptyText: string; standalone?: boolean; miniLayout?: boolean; taskLinkTarget?: '_self' | '_blank'; taskActions?: BriefTaskActionRenderer }) {
  const checklist = useChecklistDeadlines(available, checklistUserId, checklistScope, checklistAssignee);
  const count = items.length + checklist.items.length;
  if (hideEmpty && !count && !checklist.loading && !checklist.error) return null;
  return <section aria-label="期限厳守" className={cn(standalone ? 'overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/60 shadow-sm' : 'border-t bg-rose-50/60')}>
    <div className="flex flex-wrap items-center gap-2 px-5 py-3"><h3 className="inline-flex items-center gap-2 text-sm font-semibold text-rose-800"><AlertTriangle className="size-4 text-rose-600" aria-hidden="true" />期限厳守</h3>{count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}件{incomplete ? '以上' : ''}</span>}</div>
    {items.length ? <ul className={NEO_TASK_LIST_END_CLASS}>{items.map(task => <BriefTask key={neoTaskKey(task)} task={task} tasks={available} now={now} members={memberById} names={names} statusLabel={miniLayout ? undefined : '期限厳守'} miniLayout={miniLayout} taskLinkTarget={taskLinkTarget} taskActions={taskActions} />)}</ul> : <p className="px-5 pb-3 text-xs text-muted-foreground">{incomplete ? emptyText : count || checklist.loading || checklist.error ? '' : '期限厳守の仕事はありません。'}</p>}
    {checklist.items.length > 0 && <ul className={NEO_TASK_LIST_END_CLASS}>{checklist.items.map(({task, checklistId, item, at}) => <li key={JSON.stringify([task.projectId, task.id, checklistId, item.id])}>
      <Link prefetch={false} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} className={`group block ${NEO_TASK_ROW_CLASS}`}>
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="min-w-0 flex-1 break-words text-sm font-medium">{item.text}</p>
          <p className="shrink-0 text-xs text-rose-800"><time className="whitespace-nowrap tabular-nums" dateTime={at}>{item.dueDate?.replaceAll('-', '/')} {item.dueTime}</time>{Date.parse(at) < now.getTime() && <span className="block">期限超過</span>}</p>
        </div>
        <p className="mt-1 break-words text-xs text-muted-foreground">{task.projectName} / {task.title}</p>
      </Link>
    </li>)}</ul>}
    {checklist.loading && <p role="status" className="px-5 pb-3 text-xs text-muted-foreground">チェック項目の期限を読み込み中…</p>}
    {checklist.error && <p role="alert" className="px-5 pb-3 text-xs text-destructive">チェック項目の期限を取得できません。再読み込みしてください。</p>}
  </section>;
}

export function NeoStrictDeadlines(props: NeoBriefProps) {
  const { tasks, userId, isLoading, error, projectTaskStatus, taskScope = 'mine', assigneeFilterId, now: providedNow, members = [] } = props;
  const notifications = useNotifications();
  const statuses = [...(projectTaskStatus?.values() ?? [])];
  const incomplete = isLoading || !!error || statuses.some(status => status.status !== 'ready');
  const available = projectTaskStatus ? tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready') : incomplete ? [] : tasks;
  const now = providedNow ?? new Date();
  const brief = buildNeoBrief(available, notifications.notifications, userId, now, taskScope, assigneeFilterId);
  const memberById = Object.fromEntries(members.map(member => [member.id, member]));
  const names = Object.fromEntries(members.map(member => [member.id, member.displayName]));
  return <StrictDeadlineSection checklistUserId={userId} checklistScope={taskScope} checklistAssignee={assigneeFilterId} items={brief.strict} available={available} now={now} memberById={memberById} names={names} incomplete={incomplete} emptyText="取得できた範囲にはありません。未取得の仕事は未確認です。" standalone hideEmpty taskLinkTarget={props.taskLinkTarget} taskActions={props.taskActions} />;
}

export function NeoMorningBrief(props: NeoBriefProps) {
  const { tasks, userId, isLoading, error, projectTaskStatus, isSample = false, taskScope = 'mine', assigneeFilterId, assigneeFilterName, members = [], showStrict = true, miniLayout = false, showFooterNote = true, now: providedNow, taskLinkTarget = '_self', taskActions } = props;
  const notifications = useNotifications();
  const statuses = [...(projectTaskStatus?.values() ?? [])];
  const incomplete = isLoading || !!error || statuses.some(status => status.status !== 'ready');
  const available = projectTaskStatus ? tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready') : incomplete ? [] : tasks;
  const now = providedNow ?? new Date();
  const brief = buildNeoBrief(available, notifications.notifications, userId, now, taskScope, assigneeFilterId);
  const memberById = Object.fromEntries(members.map(member => [member.id, member]));
  const names = Object.fromEntries(members.map(member => [member.id, member.displayName]));
  const scopeDescription = assigneeFilterId === undefined
    ? taskScope === 'all' ? '参加中の案件の全員の仕事を表示。' : '参加中の案件の自分担当を表示。'
    : assigneeFilterId === null ? '参加中の案件の全員の仕事を表示。'
      : assigneeFilterId === userId ? '参加中の案件の自分担当を表示。'
        : `参加中の案件の担当者「${assigneeFilterName || '選択中の人'}」の仕事を表示。`;
  const emptyText = incomplete ? '取得できた範囲にはありません。未取得の仕事は未確認です。' : 'いまはありません。';
  const taskSection = (name: string, items: DashboardTask[], statusLabel?: (task: DashboardTask) => string | undefined, emptyLabel = 'いまはありません。', strict = false) => <section aria-label={name} className={cn('border-t', strict && 'bg-rose-50/60')}>
    <div className="flex flex-wrap items-center gap-2 px-5 py-3"><h3 className={cn('inline-flex items-center gap-2 text-sm font-semibold', strict && 'text-rose-800')}><>{strict ? <AlertTriangle className="size-4 text-rose-600" aria-hidden="true" /> : <Clock3 className="size-4 text-primary" aria-hidden="true" />}</>{name}</h3>{items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{items.length}件{incomplete ? '以上' : ''}</span>}</div>
    {items.length ? <ul className={NEO_TASK_LIST_END_CLASS}>{items.map(task => <BriefTask key={neoTaskKey(task)} task={task} tasks={available} now={now} members={memberById} names={names} statusLabel={statusLabel?.(task)} miniLayout={miniLayout} call={brief.taskCalls.find(call => call.projectId === task.projectId && call.taskId === task.id)} taskLinkTarget={taskLinkTarget} taskActions={taskActions} />)}</ul> : <p className="px-5 pb-3 text-xs text-muted-foreground">{incomplete ? emptyText : emptyLabel}</p>}
  </section>;
  return <div data-testid="neo-morning-brief">
    <NeoCalendar tasks={[]} isLoading={false} error={null} scheduleOnly linkTarget={taskLinkTarget} miniLayout={miniLayout} />
    <NeoReviewRequests {...props} isSample={miniLayout ? false : isSample} calls={brief.taskCalls} embedded taskActions={taskActions} />
    {(brief.calls.length > 0 || notifications.isLoading || notifications.error) && <section aria-label="返答・確認" className="border-t">
      <h3 className="flex items-center gap-2 px-5 py-3 text-sm font-semibold"><Bell className="size-4 text-primary" aria-hidden="true" />返答・確認</h3>
      {notifications.error ? <p role="alert" className="px-5 pb-3 text-xs text-amber-800">呼びかけの通知を取得できません。</p> : notifications.isLoading ? <p role="status" className="px-5 pb-3 text-xs text-muted-foreground">呼びかけを読み込み中…</p> : <ul>{brief.calls.map(call => {
        const task = available.find(task => task.projectId === call.projectId && task.id === call.taskId);
        return <li key={call.id}><Link prefetch={false} target={taskLinkTarget} rel={taskLinkTarget === '_blank' ? 'noreferrer' : undefined} href={notificationTaskHref(call)} className={taskRowInteraction + ' block px-5 py-3'}><p className="break-words text-sm font-medium">{call.taskName || call.title}</p>
          {task && <div className="mt-1"><NeoBriefTaskMeta task={task} names={names} members={memberById} /></div>}
          <p className="mt-1 text-xs text-muted-foreground">{isNeoAutomationReminder(call) ? '全員分の確認状況 · 自動確認' : `${call.senderName || 'メンバー'}から`} · {format(call.createdAt, 'M/d H:mm')}</p>{call.message && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{call.message}</p>}</Link></li>;
      })}</ul>}
    </section>}
    <section aria-label="今日の仕事・期限">
      {showStrict && <StrictDeadlineSection checklistUserId={userId} checklistScope={taskScope} checklistAssignee={assigneeFilterId} items={brief.strict} available={available} now={now} memberById={memberById} names={names} incomplete={incomplete} emptyText={emptyText} hideEmpty={miniLayout} miniLayout={miniLayout} taskLinkTarget={taskLinkTarget} taskActions={taskActions} />}
      {taskSection('期限', brief.deadlines, task => task.dueDate && isValid(task.dueDate) && !isBefore(startOfDay(task.dueDate), startOfDay(now)) ? '今日が期限' : undefined, '期限が今日以前の仕事はありません。')}
      {taskSection('作業期間中', brief.workPeriod, task => task.workProgress === 'started' ? '着手中' : '未着手', '作業期間中の仕事はありません。')}
    </section>
    {taskSection('期限に影響する待ち・詰まり', brief.waiting)}
    {brief.paused.length > 0 && taskSection('チームで保留・待ちにした仕事', brief.paused)}
    {showFooterNote && <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">{isSample ? '架空データ。' : ''}{scopeDescription}確認依頼・呼びかけ・Google予定は自分宛てのみ。待ちは登録された前提関係を照合しています。{incomplete ? '一部のタスクは未確認です。' : '共有タスクの変更は自動で表示に反映されます。'}</p>}
  </div>;
}
