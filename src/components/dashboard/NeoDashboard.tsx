'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format, endOfDay, isBefore } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarDays, List, Sparkles, Sunrise } from 'lucide-react';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { Skeleton } from '@/components/ui/skeleton';
import { NeoRecentChanges } from './NeoRecentChanges';
import { DashboardNavigation } from './DashboardNavigation';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import { NeoToday } from './NeoToday';
import { OrganizationReviewInbox } from './OrganizationReviewInbox';
import { SharedCountdown } from './SharedCountdown';
import { NeoScheduleCalendar } from './NeoScheduleCalendar';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { NEO_TASK_LIST_END_CLASS, NEO_TASK_ROW_CLASS, NeoBriefTaskHeading } from './NeoBriefTaskRow';

export function NeoDashboard() {
  const { tasks, allProjectTasks, projects, projectTaskStatus, isLoading, error } = useMyTasks();
  const [filter, setFilter] = useState<'mine' | 'recent' | 'due'>('mine');
  const [limit, setLimit] = useState(6);
  const [taskView, setTaskView] = useState<'today' | 'list' | 'calendar' | 'proposals'>('today');
  const [calendarDay, setCalendarDay] = useState<Date | null>(null);
  const [selection, setSelection] = useState<{ userId: string | null; key: string } | null>(null);
  const [today, setToday] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setToday(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  const userId = useAuthStore(state => state.user?.id ?? null);
  const selectedTaskKey = selection?.userId === userId ? selection.key : null;
  const members = useMeetingMembers(projects.filter(project => projectTaskStatus.get(project.id)?.status === 'ready'), !!userId);
  const memberById = Object.fromEntries(members.users.map(member => [member.id, member]));
  const memberNames = Object.fromEntries(members.users.map(member => [member.id, member.displayName]));
  const due = tasks.filter(task => task.dueDate && isBefore(task.dueDate, endOfDay(today)));
  const shown = filter === 'mine' ? tasks : due;
  const continueTask = (task: DashboardTask) => { setSelection({ userId, key: JSON.stringify([task.projectId, task.id]) }); setTaskView('today'); };
  return <div className="mx-auto w-full max-w-[1600px] pb-8" data-testid="neo-dashboard">
    <div className="mb-4 grid items-end gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] [&>div]:mb-0 [&>section]:max-w-none">
    <DashboardNavigation current="neo" showSettingsLink={false} trailingAlign="start" trailing={
      <div className="flex flex-col items-start gap-3 pt-1">
        <time dateTime={format(today, 'yyyy-MM-dd')} aria-label={format(today, 'yyyy年M月d日 EEEE', { locale: ja })} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span aria-hidden="true" className="whitespace-nowrap text-3xl font-medium leading-none tracking-tight text-foreground tabular-nums sm:text-4xl">{format(today, 'yyyy.M.d')}</span>
          <span aria-hidden="true" className="whitespace-nowrap text-xs font-medium text-orange-700">{format(today, 'EEEE', { locale: ja })}</span>
        </time>
        <ViewSwitcher label="タスクの表示" value={taskView} options={[
          { id: 'today', label: '今日', icon: Sunrise }, { id: 'calendar', label: 'カレンダー', icon: CalendarDays },
          { id: 'list', label: 'タスク', icon: List }, { id: 'proposals', label: 'モアイの提案', icon: Sparkles },
        ]} onChange={view => { if (view === 'calendar') setCalendarDay(null); setTaskView(view); }} />
      </div>
    } />
    <SharedCountdown tasks={allProjectTasks} tasksLoading={isLoading} tasksError={error} />
    </div>
    {isE2EMockAuthEnabled() && <p className="mb-3 text-xs text-amber-800">架空データの検証画面です。</p>}
    <div data-testid="neo-dashboard-layout" className="min-w-0">
      {taskView === 'proposals' ? <OrganizationReviewInbox key={userId ?? ''} userId={userId} projects={projects} tasks={allProjectTasks} disabled={isLoading} /> : taskView === 'today' ? <NeoToday key={userId ?? ''} now={today} tasks={allProjectTasks} userId={userId} isLoading={isLoading} error={error} projectTaskStatus={projectTaskStatus} members={members.users} selectedTaskKey={selectedTaskKey} onList={() => { setFilter('mine'); setTaskView('list'); }} onCalendar={() => { setCalendarDay(today); setTaskView('calendar'); }} /> : <section id="neo-tasks" aria-label="タスク一覧" className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {taskView === 'calendar' ? <NeoScheduleCalendar key={userId ?? ''} tasks={tasks} isLoading={isLoading} error={error} onList={() => { setFilter('mine'); setTaskView('list'); }} onContinue={continueTask} initialDay={calendarDay} /> : <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><h1 className="font-semibold">タスク一覧</h1><button type="button" className="text-xs text-muted-foreground hover:text-primary" onClick={() => { setFilter('due'); setLimit(6); }}>今日までの期限 {isLoading || error ? '—' : due.length}件</button></div>
          <div className="flex flex-wrap gap-x-4 border-b px-5" aria-label="タスクの絞り込み">{([{ id: 'mine', label: '自分の担当' }, { id: 'due', label: '今日まで' }, { id: 'recent', label: '最近の更新' }] as const).map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setLimit(6); }} className={cn('border-b-2 py-3 text-xs font-medium', filter === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')}>{item.label}</button>)}</div>
          {error && <p role="alert" className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">一部のタスクを取得できません。取得できた分を表示しています。</p>}
          {filter === 'recent' ? <NeoRecentChanges key={userId} tasks={allProjectTasks} userId={userId} isLoading={isLoading} error={error} projectTaskStatus={projectTaskStatus} /> : isLoading ? <div role="status" aria-label="タスクを読み込み中" className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            : shown.length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">{error ? '取得できたタスクはありません。' : filter === 'mine' ? '未完了の担当タスクはありません。' : filter === 'due' ? '今日までが期限の担当タスクはありません。' : '表示する更新はありません。'}</p>
            : <ul className={NEO_TASK_LIST_END_CLASS}>{shown.slice(0, limit).map(task => <li key={`${task.projectId}/${task.id}`}><Link href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} className={`group block ${NEO_TASK_ROW_CLASS}`}><NeoBriefTaskHeading task={task} tasks={allProjectTasks} now={today} members={memberById} names={memberNames} parentTitle={task.parentTitle} /></Link></li>)}</ul>}
          {taskView === 'list' && (filter === 'mine' || filter === 'due') && !isLoading && shown.length > limit && <Button variant="ghost" className="m-2" onClick={() => setLimit(value => value + 12)}>ほかのタスクを見る（残り{shown.length - limit}件）</Button>}
        </>}
      </section>}
    </div>
  </div>;
}
