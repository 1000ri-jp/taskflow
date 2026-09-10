'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Timer, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/authStore';
import { useSharedCountdown } from '@/hooks/useSharedCountdown';
import { useLocalCountdown } from '@/hooks/useLocalCountdown';
import { countdownDay, describeCountdown, type CountdownTarget, type CountdownTask, type SharedCountdownData } from '@/lib/dashboard/countdown';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { cn } from '@/lib/utils';

interface Props { tasks: DashboardTask[]; tasksLoading: boolean; tasksError: Error | null }
interface Controller {
  data?: SharedCountdownData;
  isLoading: boolean;
  error: Error | null;
  isSaving: boolean;
  refresh: () => Promise<{ data?: SharedCountdownData; error?: Error | null }>;
  save: (input: { target: CountdownTarget | null; revision: number }) => Promise<void>;
  localOnly?: boolean;
}
const taskTarget = (task: DashboardTask): CountdownTarget => ({ projectId: task.projectId, taskId: task.id });
const sameTarget = (a: CountdownTarget | null, b: CountdownTarget | null) => a?.projectId === b?.projectId && a?.taskId === b?.taskId;
const taskSummary = (task: DashboardTask): CountdownTask => ({ title: task.title, projectName: task.projectName, dueDate: task.dueDate?.toISOString() ?? null, isCompleted: task.isCompleted, isAbandoned: task.isAbandoned });

function CountdownContent({ task, now }: { task: CountdownTask; now: Date }) {
  const summary = describeCountdown(task, now);
  return <>
    <span className={cn('mr-2 text-lg font-bold tabular-nums', summary.tone === 'red' ? 'text-rose-700' : summary.tone === 'green' ? 'text-emerald-700' : 'text-amber-900')}>{summary.label}</span>
    <span className="font-medium">{task.title}</span>
    <span className="mt-0.5 block text-xs text-muted-foreground">{task.projectName}{task.dueDate && !Number.isNaN(new Date(task.dueDate).getTime()) ? <span className="inline-block">・期限 {countdownDay(new Date(task.dueDate))}</span> : null}</span>
  </>;
}

function CountdownPanel({ tasks, tasksLoading, tasksError, controller }: Props & { controller: Controller }) {
  const { data, isLoading, error, refresh, save, isSaving, localOnly } = controller;
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CountdownTarget | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  const eligible = useMemo(() => tasks.filter((task) => task.dueDate && !Number.isNaN(task.dueDate.getTime()) && !task.isArchived && !task.isAbandoned && !task.isCompleted)
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

  return <section aria-label="共通カウントダウン" className="flex w-full min-w-0 max-w-[640px] flex-wrap items-center justify-self-end gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm"><Timer className="h-4 w-4" /></span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-amber-800">カウントダウン <span className="ml-1 font-normal">{localOnly ? 'テスト用・このブラウザに保存' : '全員共通'}</span></p>
      {error ? <p role="status" className="mt-1 text-sm">{localOnly ? error.message : '共有保存は準備中（認証・接続を確認してください）'}</p>
        : isLoading ? <p className="mt-1 text-sm">設定を読み込み中…</p>
        : currentTask && data?.target ? <Link className="mt-1 block text-sm hover:underline focus-visible:outline-2" href={`/projects/${encodeURIComponent(data.target.projectId)}/board?task=${encodeURIComponent(data.target.taskId)}`}><CountdownContent task={currentTask} now={now} /></Link>
        : <p className="mt-1 text-sm">{data?.status === 'restricted' ? '共有タスクの閲覧権限がありません。' : data?.status === 'unavailable' ? '対象タスクが削除・アーカイブ済み、または閲覧できません。' : '期限まで数えるタスクを選んでください。'}</p>}
    </div>
    <Dialog open={open} onOpenChange={(next) => {
      if (isSaving) return;
      setOpen(next);
      if (next) { setDraft(data?.target ?? null); setRevision(data?.revision ?? null); setSearch(''); setSaveError(''); }
    }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="h-8 gap-1.5" aria-label="共通カウントダウンの設定"><Settings2 className="h-3.5 w-3.5" />タスクを選択</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>共通カウントダウンの設定</DialogTitle>
          <DialogDescription>{localOnly ? 'このテスト環境では、このブラウザだけにタスクの指定を保存します。他のユーザーには共有されません。タスク本体は変更しません。' : '設定は全員共通です。タスクの指定だけを共有保存し、期限や完了状態は変更しません。タスクの閲覧権限はそのままです。'}</DialogDescription>
        </DialogHeader>
        {!localOnly && (!connectionReady || revision === null) && <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <p>共有保存は準備中です。サーバーの認証・接続が整うまではプレビューのみ確認できます。</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={isLoading} onClick={async () => { const result = await refresh(); if (result.data && !result.error) setRevision(result.data.revision); }}>接続を再確認</Button>
        </div>}
        <Input aria-label="カウントダウンのタスクを検索" placeholder="タスク名・プロジェクト名で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div role="radiogroup" aria-label="期限のある未完了タスク" className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-1">
          {tasksLoading && <p className="p-3 text-sm text-muted-foreground">タスクを読み込み中…</p>}
          {tasksError && <p role="alert" className="p-3 text-xs text-rose-700">一部のタスクを取得できませんでした。取得できたものを表示しています。</p>}
          {!tasksLoading && candidates.length === 0 && <p className="p-3 text-sm text-muted-foreground">対象のタスクがありません。</p>}
          {candidates.map((task) => <button key={`${task.projectId}/${task.id}`} type="button" role="radio" aria-checked={sameTarget(taskTarget(task), draft)} disabled={isSaving} className={cn('block w-full rounded p-2 text-left text-sm focus-visible:outline-2', sameTarget(taskTarget(task), draft) ? 'bg-amber-100' : 'hover:bg-muted')} onClick={() => setDraft(taskTarget(task))}>
            <span className="block font-medium">{task.title}</span><span className="text-xs text-muted-foreground">{task.projectName}・期限 {countdownDay(task.dueDate!)}</span>
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

function RemoteCountdown(props: Props & { userId: string }) {
  const controller = useSharedCountdown(props.userId);
  return <CountdownPanel {...props} controller={controller} />;
}
function LocalCountdown(props: Props) {
  const controller = useLocalCountdown(props.tasks, props.tasksLoading);
  return <CountdownPanel {...props} controller={controller} />;
}

export function isLocalCountdownPreview(mode: string, hostname: string, port: string) {
  return mode === 'development' && ['localhost', '127.0.0.1'].includes(hostname) && port === '3002';
}
const subscribeToOrigin = () => () => {};
const localModeSnapshot = () => isLocalCountdownPreview(process.env.NODE_ENV, window.location.hostname, window.location.port);
const serverModeSnapshot = () => null;
export function SharedCountdown(props: Props) {
  const userId = useAuthStore((state) => state.firebaseUser?.uid);
  const localOnly = useSyncExternalStore(subscribeToOrigin, localModeSnapshot, serverModeSnapshot);
  if (!userId) return <section aria-label="共通カウントダウン" className="w-full max-w-[640px] justify-self-end rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">カウントダウンはログイン後に表示されます。</section>;
  if (localOnly === null) return <section aria-label="共通カウントダウン" className="w-full max-w-[640px] justify-self-end rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">カウントダウンを読み込み中…</section>;
  return localOnly ? <LocalCountdown key={userId} {...props} /> : <RemoteCountdown key={userId} userId={userId} {...props} />;
}
