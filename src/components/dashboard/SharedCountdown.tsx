'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Timer, Settings2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/authStore';
import { useCountdownMilestones } from '@/hooks/useCountdownMilestones';
import type { Project } from '@/types';
import { useSharedCountdown } from '@/hooks/useSharedCountdown';
import { useLocalCountdown } from '@/hooks/useLocalCountdown';
import { countdownDay, describeCountdown, milestoneSummary, type CountdownMilestone, type CountdownTarget, type CountdownTask, type SharedCountdownData } from '@/lib/dashboard/countdown';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { cn } from '@/lib/utils';

interface Props { projects?: Pick<Project, 'id' | 'name'>[]; tasks: DashboardTask[]; tasksLoading: boolean; tasksError: Error | null }
interface Controller {
  data?: SharedCountdownData;
  isLoading: boolean;
  error: Error | null;
  isSaving: boolean;
  isRefreshing?: boolean;
  refresh: () => Promise<{ data?: SharedCountdownData; error?: Error | null }>;
  save: (input: { target: CountdownTarget | null; revision: number }) => Promise<void>;
  localOnly?: boolean;
}
interface MilestoneProps { milestones: CountdownMilestone[]; milestonesLoading: boolean; milestonesError: Error | null }
const taskTarget = (task: CountdownMilestone): CountdownTarget => ({ projectId: task.projectId, milestoneId: task.id });
const sameTarget = (a: CountdownTarget | null, b: CountdownTarget | null) => a?.projectId === b?.projectId && a?.taskId === b?.taskId && a?.milestoneId === b?.milestoneId;
const taskSummary = milestoneSummary;

function CountdownContent({ task, now }: { task: CountdownTask; now: Date }) {
  const summary = describeCountdown(task, now);
  const remainingDays = summary.label.match(/^あと(\d+)日$/);
  const dueDay = task.dueDate && !Number.isNaN(new Date(task.dueDate).getTime()) ? countdownDay(new Date(task.dueDate)) : null;
  return <span className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-x-4">
    <span className={cn('whitespace-nowrap text-lg font-bold tabular-nums', summary.tone === 'red' ? 'text-rose-700' : summary.tone === 'green' ? 'text-emerald-700' : 'text-amber-900')}>
      {remainingDays ? <><span className="sr-only">{summary.label}</span><span aria-hidden="true" className="text-base">あと<span className="text-xl">{remainingDays[1]}</span>日</span></> : summary.label}
    </span>
    <span className="min-w-0 break-words font-medium leading-relaxed">
      {task.title}{dueDay && <span className="ml-1 inline-block whitespace-nowrap text-xs font-normal text-muted-foreground">（{dueDay.split('-').map(Number).join('-')}）</span>}
    </span>
  </span>;
}

function CountdownPanel({ milestones: tasks, milestonesLoading: tasksLoading, milestonesError: tasksError, controller }: Props & MilestoneProps & { controller: Controller }) {
  const { data, isLoading, error, refresh, save, isSaving, isRefreshing, localOnly } = controller;
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CountdownTarget | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const current = new Date();
      setNow(previous => countdownDay(previous) === countdownDay(current) ? previous : current);
      const tomorrow = new Date(`${countdownDay(current)}T00:00:00+09:00`).getTime() + 86_400_000;
      timer = setTimeout(tick, tomorrow - current.getTime() + 50);
    };
    tick();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearTimeout(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const eligible = useMemo(() => tasks.filter((task) => task.dueDate && !Number.isNaN(task.dueDate.getTime()) && task.status !== 'cancelled' && task.status !== 'achieved')
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime() || a.title.localeCompare(b.title, 'ja')), [tasks]);
  const candidates = eligible.filter((task) => `${task.title} ${task.projectName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = eligible.find((task) => sameTarget(taskTarget(task), draft));
  const connectionReady = Boolean(data) && !error && !isLoading;
  const canSave = connectionReady && revision !== null && !isSaving && Boolean(selected) && !sameTarget(draft, data?.target ?? null);
  const canClear = connectionReady && revision !== null && !isSaving && Boolean(data?.target);
  const currentTask = data?.status === 'ready' ? data.task : null;
  const submit = async (target: CountdownTarget | null) => {
    if (revision === null) return;
    setSaveError('');
    try { await save({ target, revision }); setOpen(false); }
    catch (error) { setSaveError(error instanceof Error ? error.message : '保存できませんでした。'); }
  };

  return <section aria-label="共通カウントダウン" className="grid w-full min-w-0 max-w-[640px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center justify-self-end gap-x-3 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 py-3 pl-3 pr-5 text-amber-950 shadow-sm">
    <span className="row-start-1 flex h-9 w-9 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm"><Timer className="h-4 w-4" /></span>
    <div className="contents">
      {error ? <p role="status" className="col-start-2 row-start-1 text-sm">{localOnly ? error.message : '共有保存は準備中（認証・接続を確認してください）'}</p>
        : isLoading ? <p className="col-start-2 row-start-1 text-sm">設定を読み込み中…</p>
        : currentTask && data?.target ? <div className="col-start-2 row-start-1 min-w-0 text-sm"><CountdownContent task={currentTask} now={now} /></div>
        : <p className="col-start-2 row-start-1 text-sm">{data?.status === 'restricted' ? '対象の閲覧権限がありません。' : data?.status === 'unavailable' ? '対象が削除・アーカイブ済み、または閲覧できません。設定から節目を選んでください。' : 'カウントダウンする節目を選んでください。'}</p>}
    </div>
    {!localOnly && <Button size="icon" variant="ghost" className="col-start-4 row-start-1 h-8 w-8" aria-label="カウントダウンを更新" title="カウントダウンを更新" disabled={isLoading || isRefreshing || isSaving} onClick={() => void refresh()}><RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} /></Button>}
    <Dialog open={open} onOpenChange={(next) => {
      if (isSaving) return;
      setOpen(next);
      if (next) { setDraft(data?.target ?? null); setRevision(data?.revision ?? null); setSearch(''); setSaveError(''); }
    }}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" className="col-start-3 row-start-1 h-8 w-8" aria-label="共通カウントダウンの設定" title="共通カウントダウンの設定"><Settings2 className="h-4 w-4" aria-hidden="true" /></Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>共通カウントダウンの設定</DialogTitle>
          <DialogDescription>{localOnly ? 'このテスト環境では、このブラウザだけに節目の指定を保存します。他のユーザーには共有されません。節目本体は変更しません。' : '設定は全員共通です。節目の指定だけを共有保存し、日付や達成状態は変更しません。節目の閲覧権限はそのままです。'}</DialogDescription>
        </DialogHeader>
        {!localOnly && (!connectionReady || revision === null) && <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <p>共有保存は準備中です。サーバーの認証・接続が整うまではプレビューのみ確認できます。</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={isLoading} onClick={async () => { const result = await refresh(); if (result.data && !result.error) setRevision(result.data.revision); }}>接続を再確認</Button>
        </div>}
        <Input aria-label="カウントダウンの節目を検索" placeholder="節目名・プロジェクト名で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div role="radiogroup" aria-label="日付のある未達成の節目" className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-1">
          {tasksLoading && <p className="p-3 text-sm text-muted-foreground">節目を読み込み中…</p>}
          {tasksError && <p role="alert" className="p-3 text-xs text-rose-700">一部の節目を取得できませんでした。取得できたものを表示しています。</p>}
          {!tasksLoading && candidates.length === 0 && <p className="p-3 text-sm text-muted-foreground">対象の節目がありません。プロジェクトの「節目・出展日」で日付のある節目を登録してください。</p>}
          {candidates.map((task) => <button key={`${task.projectId}/${task.id}`} type="button" role="radio" aria-checked={sameTarget(taskTarget(task), draft)} disabled={isSaving} className={cn('block w-full rounded p-2 text-left text-sm focus-visible:outline-2', sameTarget(taskTarget(task), draft) ? 'bg-amber-100' : 'hover:bg-muted')} onClick={() => setDraft(taskTarget(task))}>
            <span className="block font-medium">{task.title}</span><span className="text-xs text-muted-foreground">{task.projectName}・日付 {countdownDay(task.dueDate!)}</span>
          </button>)}
        </div>
        {selected && <div aria-label="カウントダウンのプレビュー" className="rounded-md bg-amber-50 p-3 text-sm"><p className="mb-1 text-xs text-muted-foreground">プレビュー（未保存・日本時間基準）</p><CountdownContent task={taskSummary(selected)} now={now} /></div>}
        {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {data?.target && <Button size="sm" variant="ghost" disabled={!canClear} onClick={() => void submit(null)}>設定を解除</Button>}
          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => setOpen(false)}>キャンセル</Button>
          <Button size="sm" disabled={!canSave} onClick={() => void submit(draft)}>{isSaving ? '保存中…' : localOnly ? 'このブラウザに保存' : '全員共通で保存'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}

function RemoteCountdown(props: Props & MilestoneProps & { userId: string }) {
  const controller = useSharedCountdown(props.userId);
  return <CountdownPanel {...props} controller={controller} />;
}
function LocalCountdown(props: Props & MilestoneProps) {
  const controller = useLocalCountdown(props.tasks, props.tasksLoading || props.milestonesLoading, props.milestones);
  return <CountdownPanel {...props} controller={controller} />;
}

export function isLocalCountdownPreview(mode: string, hostname: string, port: string) {
  return mode === 'development' && ['localhost', '127.0.0.1'].includes(hostname) && port === '3002';
}
const subscribeToOrigin = () => () => {};
const localModeSnapshot = () => isLocalCountdownPreview(process.env.NODE_ENV, window.location.hostname, window.location.port);
const serverModeSnapshot = () => null;
const noProjects: Pick<Project, 'id' | 'name'>[] = [];
export function SharedCountdown(props: Props) {
  const milestoneData = useCountdownMilestones(props.projects ?? noProjects);
  const milestoneProps = { milestones: milestoneData.milestones, milestonesLoading: props.tasksLoading || milestoneData.isLoading, milestonesError: props.tasksError ?? milestoneData.error };
  const userId = useAuthStore((state) => state.firebaseUser?.uid);
  const localOnly = useSyncExternalStore(subscribeToOrigin, localModeSnapshot, serverModeSnapshot);
  if (!userId) return <section aria-label="共通カウントダウン" className="w-full max-w-[640px] justify-self-end rounded-2xl border border-amber-200 bg-amber-50 py-4 pl-6 pr-5 text-sm">カウントダウンはログイン後に表示されます。</section>;
  if (localOnly === null) return <section aria-label="共通カウントダウン" className="w-full max-w-[640px] justify-self-end rounded-2xl border border-amber-200 bg-amber-50 py-4 pl-6 pr-5 text-sm">カウントダウンを読み込み中…</section>;
  return localOnly ? <LocalCountdown key={userId} {...props} {...milestoneProps} /> : <RemoteCountdown key={userId} userId={userId} {...props} {...milestoneProps} />;
}
