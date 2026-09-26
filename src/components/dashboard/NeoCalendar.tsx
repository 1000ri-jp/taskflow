'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { addDays, format, isBefore, isSameDay, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectMark } from '@/components/project/ProjectMark';
import { useGoogleCalendarRange } from '@/hooks/useGoogleCalendarRange';
import { useUpcomingRangeStore } from '@/stores/upcomingRangeStore';
import { UPCOMING_RANGES } from '@/lib/dashboard/upcoming-range';
import { buildNeoCalendarDays } from '@/lib/dashboard/neo-calendar';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { GoogleItem, GoogleSource } from '@/lib/google/workspace/types';
import { cn } from '@/lib/utils';
import { taskRowInteraction } from '@/components/ui/density';
import { NeoScheduleCalendar } from './NeoScheduleCalendar';

interface TaskProps {
  tasks: readonly DashboardTask[];
  isLoading: boolean;
  error: Error | null;
  scheduleOnly?: boolean;
  miniLayout?: boolean;
  onList?: () => void;
  linkTarget?: '_self' | '_blank';
}

export function NeoCalendar(props: TaskProps) {
  if (!props.scheduleOnly) return <NeoScheduleCalendar {...props} />;
  return isE2EMockAuthEnabled() ? <NeoCalendarContent {...props} /> : <ConnectedCalendar {...props} />;
}

function ConnectedCalendar(props: TaskProps) {
  const start = startOfDay(new Date());
  const google = useGoogleCalendarRange(start, addDays(start, 1));
  return <NeoCalendarContent {...props} source={google.source} calendarLoading={google.loading} calendarError={google.error} />;
}

function eventTime(event: GoogleItem, date: Date) {
  if (event.allDay) return '終日';
  const start = new Date(event.at), end = event.end ? new Date(event.end) : null;
  const startText = isSameDay(start, date) ? format(start, 'H:mm') : '前日から';
  if (!end || !Number.isFinite(end.getTime())) return startText;
  return `${startText}–${isSameDay(end, date) ? format(end, 'H:mm') : `${format(end, 'M/d')} ${format(end, 'H:mm')}`}`;
}

export function NeoCalendarContent({ tasks, isLoading, error, source, calendarLoading = false, calendarError = null, now = new Date(), scheduleOnly = false, linkTarget = '_self', miniLayout = false }: TaskProps & {
  source?: GoogleSource;
  calendarLoading?: boolean;
  calendarError?: string | null;
  now?: Date;
}) {
  const { dayCount, hydrate, setDayCount, persistenceFailed } = useUpcomingRangeStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  const connected = source?.connected === true;
  const fetchedAt = source?.fetchedAt && Number.isFinite(Date.parse(source.fetchedAt)) ? new Date(source.fetchedAt) : null;
  const stale = !!fetchedAt && isBefore(fetchedAt, startOfDay(now));
  const calendarIncomplete = calendarLoading || !!calendarError || (connected && (source?.status !== 'ready' || stale || !fetchedAt));
  const allDays = buildNeoCalendarDays(scheduleOnly ? [] : tasks, connected ? source?.items ?? [] : [], now, dayCount);
  const days = scheduleOnly ? allDays.slice(0, 1) : allDays;
  const notice = calendarError || source?.status === 'error' ? 'Google予定を取得できません。前回の取得分があれば表示しています。'
    : source?.status === 'partial' ? 'Google予定は取得できた分を表示しています。'
    : source?.status === 'selection_required' ? '表示するGoogleカレンダーを選んでください。'
    : connected && (source?.status === 'pending' || !fetchedAt) ? 'Google予定の取得をまだ確認できていません。'
    : stale ? 'Google予定は前回の取得分です。最新の予定を確認してください。' : null;
  const undated = tasks.filter(task => !task.dueDate && !task.isCompleted && !task.isArchived && !task.isAbandoned).length;

  return <div aria-label={scheduleOnly ? "今日の予定" : "直近のカレンダー"}>
    <div className={cn('flex flex-wrap items-center justify-between gap-2 px-5 py-3', !scheduleOnly && 'border-b')}>
      <div><h3 className={scheduleOnly ? 'inline-flex items-center gap-2 text-sm font-semibold' : 'text-sm font-medium'}>{scheduleOnly && <CalendarDays className="size-4 text-primary" aria-hidden="true" />}{scheduleOnly ? '今日の予定' : `今日から${dayCount}日`}</h3>{!scheduleOnly && <p className="mt-0.5 text-xs text-muted-foreground">自分の期限{connected && '・Google予定'}</p>}</div>
      {scheduleOnly && fetchedAt && <p className="ml-auto max-w-full text-right text-xs text-muted-foreground">Google予定の取得：{format(fetchedAt, 'M/d H:mm')}</p>}
      {!scheduleOnly && <div role="group" aria-label="直近の表示期間" className="flex gap-1 rounded-md border bg-muted/30 p-0.5">
        {UPCOMING_RANGES.map(value => <Button key={value} size="sm" variant={dayCount === value ? 'default' : 'ghost'} className="h-7 px-2.5 text-xs" aria-pressed={dayCount === value} onClick={() => setDayCount(value)}>{value}日</Button>)}
      </div>}
    </div>
    {persistenceFailed && <p role="status" className="px-5 pt-3 text-xs text-muted-foreground">表示期間はこの画面でのみ有効です。</p>}
    {isLoading && <p role="status" className="px-5 pt-3 text-xs text-muted-foreground">タスクを読み込み中…</p>}
    {calendarLoading && <p role="status" className="px-5 pt-3 text-xs text-muted-foreground">Google予定を読み込み中…</p>}
    {notice && <p role="status" className="px-5 pt-3 text-xs text-amber-800">{notice} <Link prefetch={false} target={linkTarget} rel={linkTarget === '_blank' ? 'noreferrer' : undefined} className="underline" href="/settings/google">Google連携を開く</Link></p>}
    <div className="divide-y border-b">
      {days.map((day, index) => {
        const rows = [
          ...day.events.map(event => {
            const content = <>
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words text-sm"><span>{event.title}</span><span className="ml-2 inline-block text-xs text-muted-foreground">{eventTime(event, day.date)}</span>{event.sourceName && <span className="ml-2 text-xs text-muted-foreground">{event.sourceName}</span>}</span>
              {event.url && <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </>;
            const className = 'flex min-w-0 items-start gap-2 rounded-md py-0.5';
            return <li key={`event:${event.id}`}>
              {event.url ? <a href={event.url} target="_blank" rel="noreferrer" className={cn(className, 'hover:bg-muted/60')}>{content}</a> : <div className={className}>{content}</div>}
            </li>;
          }),
          ...day.tasks.map(task => <li key={`task:${task.projectId}:${task.id}`}>
            <Link prefetch={false} target={linkTarget} rel={linkTarget === '_blank' ? 'noreferrer' : undefined} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} className={taskRowInteraction + ' flex min-w-0 items-center gap-2 rounded-md py-0.5'}>
              <ProjectMark name={task.projectName} color={task.projectColor} />
              <span className="min-w-0 flex-1 break-words text-sm">{task.title}<span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">期限</span><span className="ml-2 text-xs text-muted-foreground">{[...new Set([task.projectName, task.listName].filter(Boolean))].join(' / ')}</span></span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>),
        ];
        return <section key={day.date.toISOString()} aria-label={format(day.date, 'M月d日')} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-5 py-2">
          <div className="self-start"><time dateTime={format(day.date, 'yyyy-MM-dd')} className="block text-sm font-semibold tabular-nums">{format(day.date, 'M/d')}</time><p className={cn('mt-0.5 text-xs', day.date.getDay() === 0 ? 'text-rose-700' : day.date.getDay() === 6 ? 'text-sky-700' : 'text-muted-foreground')}>{index === 0 ? '今日' : format(day.date, 'EEEE', { locale: ja })}</p></div>
          <div className="min-w-0">
            {rows.length ? <ul className="space-y-0.5">{rows}</ul>
              : <p className="py-0.5 text-xs text-muted-foreground">{isLoading || calendarLoading ? '読み込み中…' : error || calendarIncomplete ? scheduleOnly ? '取得できた予定はありません' : '取得できた予定・期限はありません' : connected ? scheduleOnly ? '取得範囲に今日の予定はありません' : '予定・期限なし' : scheduleOnly ? miniLayout ? <Link prefetch={false} target={linkTarget} rel={linkTarget === '_blank' ? 'noreferrer' : undefined} href="/settings/google" className="underline">連携する</Link> : 'Google予定は未連携です' : '期限タスクなし'}</p>}
          </div>
        </section>;
      })}
    </div>
    {(!scheduleOnly || (!calendarLoading && !connected && !calendarError && !miniLayout)) && <div className="space-y-1 px-5 py-3 text-xs text-muted-foreground">
      {!miniLayout && !calendarLoading && !connected && !calendarError && <p>Google予定は未連携です。<Link prefetch={false} target={linkTarget} rel={linkTarget === '_blank' ? 'noreferrer' : undefined} href="/settings/google" className="ml-1 underline">連携する</Link></p>}
      {!scheduleOnly && fetchedAt && <p>Google予定の取得：{format(fetchedAt, 'M/d H:mm')}</p>}
      {!scheduleOnly && undated > 0 && <p>期限未設定の{undated}件は一覧で確認できます。</p>}
    </div>}
  </div>;
}
