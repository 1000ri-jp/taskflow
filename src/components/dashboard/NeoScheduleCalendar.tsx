'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { addDays, format, isSameDay, isSameMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, Settings2, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGoogleCalendarRange } from '@/hooks/useGoogleCalendarRange';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { buildNeoCalendarDays, type NeoCalendarDay } from '@/lib/dashboard/neo-calendar';
import { calendarEventColor, calendarWindow, moveCalendar, placeTimedEvents, type CalendarView } from '@/lib/dashboard/calendar-layout';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { GoogleItem, GoogleSource } from '@/lib/google/workspace/types';
import { cn } from '@/lib/utils';
import { taskRowInteraction } from '@/components/ui/density';
import { useAuthStore } from '@/stores/authStore';
import { useNeoCalendarViewStore } from '@/stores/neoCalendarViewStore';
import { useWorkBlocks } from '@/hooks/useWorkBlocks';
import { scheduledWork } from '@/lib/dashboard/work-blocks';
import { NeoDayAgenda } from './NeoDayAgenda';

interface Props { tasks: readonly DashboardTask[]; isLoading: boolean; error: Error | null; onList?: () => void; onContinue?: (task: DashboardTask) => void; initialDay?: Date | null }
interface Data { source?: GoogleSource; loading?: boolean; refreshing?: boolean; error?: string | null; refresh?: () => void }
interface Selection {
  anchor: Date; view: CalendarView; now: Date;
  setAnchor: (date: Date) => void; setView: (view: CalendarView) => void;
}
interface CalendarProps extends Props { selection: Selection; data?: Data }

// TaskDeadline and compact timed events share these chip metrics: `text-xs leading-tight`
// is 15px high, `py-1` adds 8px and the one-pixel border adds 2px, for 25px total.
const CALENDAR_CHIP_TEXT_CLASS = 'text-xs leading-tight';
const CALENDAR_CHIP_VERTICAL_CLASS = 'py-1';
const CALENDAR_CHIP_HEIGHT_PX = 12 * 1.25 + 2 * 4 + 2;
const CALENDAR_MINUTE_HEIGHT_PX = CALENDAR_CHIP_HEIGHT_PX / 30;
const CALENDAR_HOUR_HEIGHT_PX = CALENDAR_MINUTE_HEIGHT_PX * 60;
const CALENDAR_DAY_HEIGHT_PX = CALENDAR_HOUR_HEIGHT_PX * 24;
const calendarMinutesToPixels = (minutes: number) => minutes * CALENDAR_MINUTE_HEIGHT_PX;

export function NeoScheduleCalendar(props: Props) {
  const [now, setNow] = useState(() => new Date());
  const [anchor, setAnchor] = useState(props.initialDay ?? now);
  const { view, setView, hydrate } = useNeoCalendarViewStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const selection = { now, anchor, setAnchor, view, setView };
  return isE2EMockAuthEnabled() ? <NeoScheduleCalendarContent {...props} selection={selection} /> : <ConnectedCalendar {...props} selection={selection} />;
}

function ConnectedCalendar(props: CalendarProps) {
  const range = calendarWindow(props.selection.anchor, props.selection.view);
  const data = useGoogleCalendarRange(range.start, range.end);
  return <NeoScheduleCalendarContent {...props} data={data} />;
}

function eventTime(event: GoogleItem) {
  if (event.allDay) {
    const last = event.end ? addDays(new Date(event.end), -1) : new Date(event.at);
    return format(new Date(event.at), 'M/d') + (!isSameDay(new Date(event.at), last) ? '–' + format(last, 'M/d') : '') + ' 終日';
  }
  const start = new Date(event.at), end = event.end ? new Date(event.end) : null;
  return format(start, 'M/d H:mm') + (end ? '–' + format(end, isSameDay(start, end) ? 'H:mm' : 'M/d H:mm') : '（終了時刻未設定）');
}
function Event({ event, className, style, compact = false, deadlineChipBaseline = false, onOpen }: { onOpen?: () => void; event: GoogleItem; className?: string; style?: CSSProperties; compact?: boolean; deadlineChipBaseline?: boolean }) {
  const time = eventTime(event);
  const verticalPadding = deadlineChipBaseline ? (compact ? CALENDAR_CHIP_VERTICAL_CLASS : 'py-0') : (compact ? 'py-0.5' : CALENDAR_CHIP_VERTICAL_CLASS);
  if (event.eventType === 'taskflowWork') return <button type="button" onClick={onOpen} style={style} aria-label={event.title + '、作業時間、' + time}
    className={cn('flex min-w-0 w-full flex-col items-start overflow-hidden rounded-md border border-l-[3px] border-emerald-400 bg-emerald-50 px-2 text-left text-emerald-950 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-primary', CALENDAR_CHIP_TEXT_CLASS, verticalPadding, className)}>
    <span className="flex w-full min-w-0 items-center gap-1"><CalendarClock className="size-3 shrink-0" /><span className="truncate">{event.title}{compact && deadlineChipBaseline && ' · ' + format(new Date(event.at), 'H:mm') + '–' + format(new Date(event.end!), 'H:mm')}</span></span>
    {!compact && <span className="mt-0.5 text-[10px]">{format(new Date(event.at), 'H:mm')}–{format(new Date(event.end!), 'H:mm')} · 作業</span>}
  </button>;
  return <Popover>
    <PopoverTrigger asChild><button type="button" style={style} aria-label={event.title + '、' + time + '、' + event.sourceName}
      className={cn('flex w-full min-w-0 flex-col items-stretch overflow-hidden rounded-md border-l-[3px] px-2 text-left focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary', CALENDAR_CHIP_TEXT_CLASS, verticalPadding, compact ? 'justify-center' : 'justify-start', calendarEventColor(event.sourceName), className)}>
      <span className={compact ? 'block truncate' : 'line-clamp-2 break-words'}>{!event.allDay && compact && <span className="mr-1 tabular-nums">{format(new Date(event.at), 'H:mm')}</span>}{event.title}</span>
      {!compact && !event.allDay && <span className="mt-0.5 block truncate text-[10px] tabular-nums">{format(new Date(event.at), 'H:mm')}{event.end && '–' + format(new Date(event.end), 'H:mm')}</span>}
    </button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl">
      <p className="break-words text-sm font-medium">{event.title}</p>
      <p className="text-sm tabular-nums">{time}</p>
      {event.sourceName && <p className="text-xs text-muted-foreground">{event.sourceName}</p>}
      {event.text && <p className="whitespace-pre-wrap break-words text-sm">{event.text}</p>}
      {event.url && <a href={event.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">Googleカレンダーで開く<ArrowUpRight className="size-3" aria-hidden="true" /></a>}
    </PopoverContent>
  </Popover>;
}
function TaskDeadline({ task, now }: { task: DashboardTask; now: Date }) {
  return <Link href={'/projects/' + encodeURIComponent(task.projectId) + '/board?task=' + encodeURIComponent(task.id)}
    title={task.title + '・期限 ' + format(task.dueDate!, 'M/d') + '・' + task.projectName}
    aria-label={task.title + '、期限 ' + format(task.dueDate!, 'M/d') + '、' + task.projectName}
    style={{ minHeight: CALENDAR_CHIP_HEIGHT_PX }}
    className={cn('flex min-w-0 items-center gap-1.5 rounded-md border px-2', CALENDAR_CHIP_TEXT_CLASS, CALENDAR_CHIP_VERTICAL_CLASS, taskRowInteraction, format(task.dueDate!, 'yyyy-MM-dd') < format(now, 'yyyy-MM-dd') ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-border bg-card text-foreground')}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current opacity-60" /><span className="truncate">{task.title}</span>
  </Link>;
}
function CompactItems({ items, label }: { items: ReactNode[]; label: string }) {
  return <div className="space-y-1">
    {items.slice(0, 3)}
    {items.length > 3 && <Popover><PopoverTrigger asChild><button type="button" aria-label={label + 'をすべて表示'} className="rounded px-1 text-xs text-muted-foreground hover:text-foreground">ほか{items.length - 3}件</button></PopoverTrigger>
      <PopoverContent className="max-h-80 w-80 space-y-1 overflow-y-auto rounded-xl"><p className="mb-2 text-xs font-medium">{label}</p>{items}</PopoverContent></Popover>}
  </div>;
}

export function NeoScheduleCalendarContent({ tasks, isLoading, error, onList, onContinue, initialDay, selection, data = {} }: CalendarProps) {
  const { anchor, view, now, setAnchor, setView } = selection;
  const [showGoogle, setShowGoogle] = useState(true), [showTasks, setShowTasks] = useState(true);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [activeDay, setActiveDay] = useState<Date | null>(initialDay ?? null);
  const [showWork, setShowWork] = useState(true);
  const userId = useAuthStore(state => state.user?.id ?? null);
  const work = useWorkBlocks(userId);
  const reservations = showWork ? scheduledWork(tasks, work.blocks) : [];
  const scroll = useRef<HTMLDivElement>(null);
  const range = calendarWindow(anchor, view);
  const days = buildNeoCalendarDays(showTasks ? tasks : [], [...(showGoogle && data.source?.connected ? data.source.items : []), ...reservations.map(item => item.event)], range.start, range.count);
  const rangeKey = format(range.start, 'yyyy-MM-dd');
  useEffect(() => {
    if (scroll.current && view !== 'month') scroll.current.scrollTop = 7 * CALENDAR_HOUR_HEIGHT_PX;
  }, [rangeKey, view]);
  const source = data.source;
  const fetchedAt = source?.fetchedAt && Number.isFinite(Date.parse(source.fetchedAt)) ? new Date(source.fetchedAt) : null;
  const notice = data.error ? 'Google予定を取得できません。表示中の予定は前回の取得分です。'
    : source?.status === 'partial' ? 'Google予定は一部の取得分です。すべての予定はGoogleカレンダーで確認できます。'
    : source?.status === 'selection_required' ? '表示するGoogleカレンダーを選んでください。'
    : source?.status === 'error' ? 'Google予定を取得できません。'
    : source?.connected && source.status !== 'ready' ? 'Google予定を確認中です。' : null;
  const isDisconnected = !data.loading && !data.error && !source?.connected;
  const undated = tasks.filter(task => !task.dueDate && !task.isCompleted && !task.isArchived && !task.isAbandoned).length;
  const title = view === 'day' ? format(anchor, 'yyyy年M月d日（EEE）', { locale: ja })
    : view === 'month' || isSameMonth(range.start, addDays(range.end, -1)) ? format(view === 'month' ? anchor : range.start, 'yyyy年M月')
    : format(range.start, 'yyyy年M月') + ' – ' + format(addDays(range.end, -1), 'yyyy年M月');
  const columns = { gridTemplateColumns: '52px repeat(' + days.length + ', minmax(0, 1fr))' };
  const taskItems = (day: NeoCalendarDay) => day.tasks.map(task => <TaskDeadline key={task.projectId + task.id} task={task} now={now} />);
  const allDayItems = (day: NeoCalendarDay) => day.events.filter(event => event.allDay).map(event => <Event key={event.id} event={event} compact />);
  const openDay = (date: Date) => setActiveDay(date);

  return <section aria-label="予定と期限のカレンダー" className="min-w-0" data-testid="neo-schedule-calendar">
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5">
      <Button size="sm" variant="outline" onClick={() => setAnchor(now)}>今日</Button>
      <Button size="icon-sm" variant="ghost" aria-label="前の期間" onClick={() => setAnchor(moveCalendar(anchor, view, -1))}><ChevronLeft className="size-4" /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="次の期間" onClick={() => setAnchor(moveCalendar(anchor, view, 1))}><ChevronRight className="size-4" /></Button>
      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}><PopoverTrigger asChild>
        <button type="button" aria-label="表示日を選ぶ" className="rounded-md px-1 py-1 text-left hover:bg-muted"><h2 aria-live="polite" className="text-base font-medium tracking-tight sm:text-xl">{title}</h2></button>
      </PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={anchor} defaultMonth={anchor} onSelect={date => { if (date) { setAnchor(date); setDatePickerOpen(false); } }} /></PopoverContent></Popover>
      <div className="ml-auto flex items-center gap-2">
        {data.refresh && <Button size="icon-sm" variant="ghost" aria-label="予定を更新" disabled={data.refreshing} onClick={data.refresh}><RefreshCw className={cn('size-4', data.refreshing && 'animate-spin')} /></Button>}
        <Popover><PopoverTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="表示設定"><Settings2 className="size-4" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 rounded-xl text-xs">
            <h3 className="font-semibold">表示設定</h3>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-primary" checked={showGoogle} onChange={event => setShowGoogle(event.target.checked)} />Google予定</label>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-primary" checked={showWork} onChange={event => setShowWork(event.target.checked)} />自分の作業時間</label>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-primary" checked={showTasks} onChange={event => setShowTasks(event.target.checked)} />タスクの期限</label>
            <div className="space-y-1 border-t pt-3 text-muted-foreground"><p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{fetchedAt && <p>Google予定 更新 {format(fetchedAt, 'M/d H:mm')}</p>}<Link href="/settings/google" className="inline-block text-primary underline">取得元のカレンダー</Link></div>
            {undated > 0 && onList && <button type="button" onClick={onList} className="text-primary hover:underline">日付なし {undated}件を一覧で見る</button>}
          </PopoverContent>
        </Popover>
        <div role="group" aria-label="カレンダーの表示" className="flex rounded-lg border bg-muted/30 p-0.5">
          {([{ id: 'day', label: '日' }, { id: 'week', label: '週' }, { id: 'month', label: '月' }] as const).map(item => <Button key={item.id} size="sm" className="h-7 px-3" variant={view === item.id ? 'default' : 'ghost'} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</Button>)}
        </div>
      </div>
    </header>
    {(isLoading || data.loading || error || notice || isDisconnected) && <div role="status" className="border-t px-5 py-2 text-xs text-muted-foreground">
      {isLoading && <p>タスクを読み込み中…</p>}
      {error && <p>タスクは取得できた分を表示しています。</p>}
      {data.loading && <p>この期間のGoogle予定を読み込み中…</p>}
      {notice && <p>{notice} <Link href="/settings/google" className="text-primary underline">Google連携</Link></p>}
      {isDisconnected && <p>Googleカレンダーを連携すると、予定もここに表示されます。<Link href="/settings/google" className="ml-1 text-primary underline">連携する</Link></p>}
    </div>}
    {work.error && <p role="status" className="px-5 py-2 text-xs text-amber-800">{work.error}</p>}
    {view === 'month' ? <div className="overflow-x-auto border-t">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 border-b">{days.slice(0, 7).map(day => <div key={day.date.toISOString()} className="py-2 text-center text-xs text-muted-foreground">{format(day.date, 'EEE', { locale: ja })}</div>)}</div>
        <div className="grid grid-cols-7">{days.map(day => <section key={day.date.toISOString()} aria-label={format(day.date, 'M月d日')} className={cn('min-h-28 min-w-0 border-b border-r p-1.5 last:border-r-0', !isSameMonth(day.date, anchor) && 'bg-muted/30 text-muted-foreground')}>
          <button type="button" aria-label={format(day.date, 'M月d日を表示')} onClick={() => openDay(day.date)} className={cn('mb-1 flex size-7 items-center justify-center rounded-full text-xs hover:bg-muted', isSameDay(day.date, now) && 'bg-primary text-primary-foreground hover:bg-primary/90')}>{format(day.date, 'd')}</button>
          <CompactItems label={format(day.date, 'M/dの予定・期限')} items={[...allDayItems(day), ...taskItems(day), ...day.events.filter(event => !event.allDay).map(event => <Event key={event.id} event={event} compact onOpen={() => openDay(day.date)} />)]} />
        </section>)}</div>
      </div>
    </div> : <div ref={scroll} tabIndex={0} aria-label="時間ごとの予定" className="relative h-[calc(100dvh-220px)] min-h-80 overflow-auto border-t focus-visible:outline-primary">
      <div className={view === 'week' ? 'min-w-[760px]' : 'min-w-[280px]'}>
        <div className="sticky top-0 z-30 border-b bg-card shadow-xs">
          <div className="grid" style={columns}><div />{days.map(day => <button type="button" key={day.date.toISOString()} onClick={() => openDay(day.date)} aria-label={format(day.date, 'M月d日を表示')} className="flex flex-col items-center gap-1 border-l py-2">
            <span className={cn('text-[11px]', isSameDay(day.date, now) ? 'text-primary' : 'text-muted-foreground')}>{format(day.date, 'EEE', { locale: ja })}</span>
            <span className={cn('flex size-8 items-center justify-center rounded-full text-xl tabular-nums', isSameDay(day.date, now) && 'bg-primary text-primary-foreground')}>{format(day.date, 'd')}</span>
          </button>)}</div>
          <div className="grid border-t" style={columns}><div className="py-2 text-center text-[10px] text-muted-foreground">終日</div>{days.map(day => <div key={day.date.toISOString()} className="min-w-0 border-l p-1"><CompactItems label={format(day.date, 'M/dの終日予定')} items={allDayItems(day)} /></div>)}</div>
          {showTasks && <div className="grid border-t" style={columns}><div className="py-2 text-center text-[10px] text-muted-foreground">期限</div>{days.map(day => <div key={day.date.toISOString()} className="min-w-0 border-l p-1"><CompactItems label={format(day.date, 'M/dの期限')} items={taskItems(day)} /></div>)}</div>}
        </div>
        <div className="relative grid" style={columns}>
          <div aria-hidden="true" className="relative bg-card text-right text-[10px] text-muted-foreground" style={{ height: CALENDAR_DAY_HEIGHT_PX }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 tabular-nums" style={{ top: hour * CALENDAR_HOUR_HEIGHT_PX }}>{hour}:00</span>)}</div>
          {days.map(day => <section key={day.date.toISOString()} aria-label={format(day.date, 'M月d日の時間割')} className={cn('relative min-w-0 border-l', isSameDay(day.date, now) ? 'bg-primary/[0.025]' : 'bg-card')} style={{ height: CALENDAR_DAY_HEIGHT_PX }}>
            {Array.from({ length: 24 }, (_, hour) => <div key={hour} aria-hidden="true" className="absolute inset-x-0 border-t border-border/70" style={{ top: hour * CALENDAR_HOUR_HEIGHT_PX, height: CALENDAR_HOUR_HEIGHT_PX }} />)}
            {placeTimedEvents(day.events, day.date).map(item => <Event key={item.event.id} event={item.event} onOpen={() => openDay(day.date)} className="absolute z-10 border border-l-[3px] hover:brightness-95" compact={item.end - item.start < 45} deadlineChipBaseline style={{ top: calendarMinutesToPixels(item.start), height: calendarMinutesToPixels(item.end - item.start), left: 'calc(' + (item.column / item.columns * 100) + '% + 2px)', width: 'calc(' + (100 / item.columns) + '% - 4px)' }} />)}
            {isSameDay(day.date, now) && <div aria-label="現在時刻" className="pointer-events-none absolute inset-x-0 z-20 border-t border-rose-500 before:absolute before:-left-1 before:-top-1 before:size-2 before:rounded-full before:bg-rose-500" style={{ top: calendarMinutesToPixels(now.getHours() * 60 + now.getMinutes()) }} />}
          </section>)}
        </div>
      </div>
    </div>}
    <NeoDayAgenda date={activeDay} onClose={() => setActiveDay(null)} tasks={tasks} events={data.source?.connected ? data.source.items : []} blocks={work.blocks} saveBlock={work.save} removeBlock={work.remove} canPlan={!!userId && !isLoading && !error && !work.error} onContinue={onContinue} notice={data.loading ? 'Google予定を読み込み中です。' : error || isLoading ? 'タスクは取得できた分を表示しています。' : notice || (isDisconnected ? 'Google予定は未連携です。' : null)} />
  </section>;
}
