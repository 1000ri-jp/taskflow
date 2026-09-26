'use client';

import { useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { ArrowRight, CalendarDays, Sunrise, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useGoogleCalendarRange } from '@/hooks/useGoogleCalendarRange';
import { useWorkBlocks } from '@/hooks/useWorkBlocks';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { buildNeoCalendarDays } from '@/lib/dashboard/neo-calendar';
import { scheduledWork } from '@/lib/dashboard/work-blocks';
import type { GoogleItem, GoogleSource } from '@/lib/google/workspace/types';
import type { MyTask } from '@/hooks/useMyTasks';
import type { TaskViewMember } from '@/components/board/TaskViewFields';
import type { NeoReviewRequestsProps } from './NeoReviewRequests';
import { NeoWorkContinuation } from './NeoWorkContinuation';
import { NeoMorningBrief, NeoStrictDeadlines } from './NeoMorningBrief';
import { NeoTaskAttention } from './NeoTaskAttention';
import { DesktopBriefTaskActions, type MiniTaskFeedback, type BriefTaskControlsRenderer } from '@/components/desktop/DesktopBriefTaskActions';
import { agendaTime } from './NeoDayAgenda';

function CalendarSource({ event }: { event: GoogleItem }) {
  const label = event.eventType === 'taskflowWork' ? '自分の作業時間' : event.sourceName || 'カレンダー名未取得';
  return <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground" aria-label={`カレンダー: ${label}`}><CalendarDays className="size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{label}</span></span>;
}

interface Props extends NeoReviewRequestsProps {
  tasks: readonly MyTask[]; now: Date; onList: () => void; onCalendar: () => void;
  selectedTaskKey?: string | null;
}
export function NeoToday(props: Props) {
  return isE2EMockAuthEnabled() ? <NeoTodayContent {...props} /> : <ConnectedToday {...props} />;
}
function ConnectedToday(props: Props) {
  const data = useGoogleCalendarRange(startOfDay(props.now), addDays(startOfDay(props.now), 1));
  return <NeoTodayContent {...props} source={data.source} calendarLoading={data.loading} calendarError={data.error} />;
}

export function NeoTodayContent({ tasks, now, userId, isLoading, error, projectTaskStatus = new Map(), members = [], onList, onCalendar, selectedTaskKey, source, calendarLoading, calendarError }: Props & { source?: GoogleSource; calendarLoading?: boolean; calendarError?: string | null }) {
  const work = useWorkBlocks(userId);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(userId);
  const ready = tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready');
  const activeAssigneeIds = new Set(ready.filter(task => !task.isCompleted && !task.isArchived && !task.isAbandoned).flatMap(task => task.assigneeIds));
  const assigneeChoices: TaskViewMember[] = members.filter(member => member.id === userId || activeAssigneeIds.has(member.id));
  if (userId && !assigneeChoices.some(member => member.id === userId)) assigneeChoices.unshift({ id: userId, displayName: '自分' });
  assigneeChoices.sort((a, b) => a.id === userId ? -1 : b.id === userId ? 1 : a.displayName.localeCompare(b.displayName, 'ja'));
  const selectedAssignee = assigneeChoices.find(member => member.id === selectedAssigneeId);
  const mine = ready.filter(task => task.assigneeIds.includes(userId ?? ''));
  const day = buildNeoCalendarDays(mine, [...(source?.connected ? source.items : []), ...scheduledWork(mine, work.blocks).map(item => item.event)], now, 1)[0];
  const next = day.events.filter(event => !event.allDay && (event.end ? new Date(event.end).getTime() > now.getTime() : new Date(event.at).getTime() >= now.getTime())).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const upcoming = day.events.find(event => !event.allDay && Date.parse(event.at) > now.getTime());
  const ongoing = next && Date.parse(next.at) <= now.getTime();
  const incompleteCalendar = !!calendarError || source?.connected && source.status !== 'ready';
  const [feedback, setFeedback] = useState<MiniTaskFeedback | null>(null);
  const taskActions = (task: import('@/lib/dashboard/brief').DashboardTask, renderControls?: BriefTaskControlsRenderer) => userId ? <DesktopBriefTaskActions renderControls={renderControls} task={task} allTasks={ready} userId={userId} onFeedback={setFeedback} /> : renderControls?.({ progress: null, schedule: null, actions: null });
  const requestProps = { tasks: ready, userId, isLoading, error, projectTaskStatus, members, taskActions };
  return <div data-testid="neo-today" className="space-y-4">
    {feedback && <p role={feedback.ok ? 'status' : 'alert'} className="text-sm">{feedback.task.title}：{feedback.message}</p>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
      <section aria-label="今日のブリーフィング" className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Sunrise className="size-5" aria-hidden="true" />今日のブリーフィング</h1>
          <div role="group" aria-label="ブリーフの担当者" className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
            {assigneeChoices.map(member => {
              const isSelf = member.id === userId;
              const selected = selectedAssigneeId === member.id;
              const name = member.displayName || (isSelf ? '自分' : '担当者');
              return <Button key={member.id} type="button" size="icon" variant={selected ? 'default' : 'ghost'} aria-label={isSelf ? `${name}・自分` : name} aria-pressed={selected} title={isSelf ? `${name}（自分）` : name} className="h-8 w-8 shrink-0 p-0" onClick={() => setSelectedAssigneeId(member.id)}>
                <Avatar aria-hidden="true" className="size-6 border border-background text-[9px]">
                  <AvatarImage src={member.photoURL || ''} alt="" />
                  <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Button>;
            })}
            <Button type="button" size="icon" variant={selectedAssigneeId === null ? 'default' : 'ghost'} aria-label="全員" title="全員" aria-pressed={selectedAssigneeId === null} className="h-8 w-8 shrink-0 p-0" onClick={() => setSelectedAssigneeId(null)}>
              <UsersRound className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <NeoMorningBrief {...requestProps} now={now} taskScope={selectedAssigneeId === null ? 'all' : 'mine'} assigneeFilterId={selectedAssigneeId} assigneeFilterName={selectedAssignee?.displayName} showStrict={false} />
      </section>
      <div className="min-w-0 space-y-4">
        <NeoTaskAttention {...requestProps} />
        <NeoStrictDeadlines {...requestProps} now={now} taskScope={selectedAssigneeId === null ? 'all' : 'mine'} assigneeFilterId={selectedAssigneeId} />
        <section aria-label="次の予定" className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4" />{ongoing ? 'いまの予定' : '次の予定'}</h2><Button size="sm" variant="ghost" onClick={onCalendar}>今日の予定を見る<ArrowRight className="size-3.5" /></Button></div>
          {next ? <><p className="text-2xl font-medium tabular-nums tracking-tight">{agendaTime(next)}</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><p className="min-w-0 break-words text-base font-medium">{next.title}</p><CalendarSource event={next} /></div></>
            : <p className="text-sm text-muted-foreground">{calendarLoading ? '予定を読み込み中…' : calendarError ? 'Google予定を取得できません。' : source?.connected ? 'このあと表示できる時刻付きの予定はありません。' : 'Google予定は未連携です。'}</p>}
          {ongoing && upcoming && <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-sm"><span className="text-xs text-muted-foreground">次の予定</span><span className="tabular-nums">{format(new Date(upcoming.at), 'H:mm')}</span><span className="min-w-0 break-words">{upcoming.title}</span><CalendarSource event={upcoming} /></div>}
          {day.events.some(event => event.allDay) && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{day.events.filter(event => event.allDay).map(event => <li key={event.id} className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 break-words">終日 · {event.title}</span><CalendarSource event={event} /></li>)}</ul>}
          {incompleteCalendar && <p role="status" className="mt-3 text-xs text-amber-800">予定は取得できた分です。カレンダーで取得状況を確認できます。</p>}
          {work.error && <p role="status" className="mt-3 text-xs text-amber-800">{work.error}</p>}
        </section>

        <section aria-label="進めているタスク" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <NeoWorkContinuation key={selectedTaskKey ?? 'default'} tasks={tasks} userId={userId} isLoading={isLoading} error={error} projectTaskStatus={projectTaskStatus} onList={onList} initialTaskKey={selectedTaskKey} preferStarted />
        </section>
      </div>
    </div>
  </div>;
}
