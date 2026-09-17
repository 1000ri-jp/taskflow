'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { taskRowInteraction } from '@/components/ui/density';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid } from 'date-fns';
import { Archive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { readAutoArchive, saveAutoArchive } from '@/lib/board/autoArchiveClient';
import { DEFAULT_AUTO_ARCHIVE_DAYS, validArchiveDays } from '@/lib/board/autoArchivePreview';
import type { AutoArchiveSave, AutoArchiveView } from '@/lib/board/autoArchiveTypes';
import { useAuthStore } from '@/stores/authStore';

const periodLabel = (days: number | null) => days === null ? 'OFF' : `完了から${days}日`;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return isValid(date) ? format(date, 'yyyy/M/d HH:mm') : '日時を確認できません';
};

export function AutoArchiveSettings({ projectId = null }: { projectId?: string | null }) {
  const viewerId = useAuthStore(state => state.user?.id ?? '');
  return <ArchiveScopeSettings key={JSON.stringify([viewerId, projectId])} viewerId={viewerId} projectId={projectId} />;
}

function ArchiveScopeSettings({ viewerId, projectId }: { viewerId: string; projectId: string | null }) {
  const client = useQueryClient();
  const queryKey = ['auto-archive-settings', viewerId, projectId];
  const query = useQuery({ queryKey, queryFn: () => readAutoArchive(projectId), enabled: !!viewerId,
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const draftRevision = useRef<string | null>(null);
  const refreshAfterSave = useRef(false);
  const refetch = query.refetch;
  useEffect(() => {
    if (!viewerId) return;
    const updated = () => {
      if (locked.current) refreshAfterSave.current = true;
      else void refetch({ cancelRefetch: false });
    };
    window.addEventListener('taskflow-auto-archive-updated', updated);
    return () => window.removeEventListener('taskflow-auto-archive-updated', updated);
  }, [refetch, viewerId]);
  async function save(input: AutoArchiveSave) {
    if (locked.current || !query.data?.canEdit || query.isError || query.isFetching) return;
    locked.current = true; setBusy(true); setMessage(''); setSaveError('');
    try {
      await client.cancelQueries({ queryKey });
      const result = await saveAutoArchive(input);
      client.setQueryData(queryKey, result);
      setDirty(false);
      setMessage('自動アーカイブ設定を保存しました。');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '設定の保存を確認できませんでした。');
    } finally {
      locked.current = false; setBusy(false);
      if (refreshAfterSave.current) { refreshAfterSave.current = false; void refetch({ cancelRefetch: false }); }
    }
  }
  const view = query.data;
  const formRevision = dirty ? draftRevision.current ?? view?.revision : view?.revision;
  return <Card density="compact" id={projectId ? 'auto-archive-preview' : 'auto-archive'} aria-label="完了タスクの自動アーカイブ設定">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" aria-hidden="true" />完了タスクの自動アーカイブ</CardTitle>
      {projectId && <CardDescription>完了から指定日数で自動アーカイブ。</CardDescription>}
    </CardHeader>
    <CardContent className={projectId ? 'space-y-2' : 'space-y-4'}>
      {!viewerId ? <p className="text-sm">設定するにはログインしてください。</p> : <>
        {query.isPaused ? <p role="status" className="text-sm text-muted-foreground">オフラインのため取得待ちです。</p>
          : query.isPending && <p role="status" className="text-sm text-muted-foreground">設定を読み込み中…</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">設定を取得できませんでした。<button type="button" className="ml-1 underline" onClick={() => void query.refetch()}>再取得</button></p>}
        {view && <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {!projectId && <p>{view.scopeLabel}</p>}
            <p aria-label="現在の適用状態" className={`rounded-md border px-2.5 py-1.5 font-medium ${view.effectiveDays === null ? 'border-border bg-muted text-muted-foreground' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {view.effectiveDays === null ? '停止中：自動アーカイブしません' : `適用中：完了から${view.effectiveDays}日後にアーカイブ`}{projectId && view.mode === 'inherit' ? '（共通設定）' : ''}
            </p>
            {projectId && view.mode === 'custom' && <p className="text-xs text-muted-foreground">共通：{periodLabel(view.defaultDays)}</p>}
            {!view.configured && <p className={projectId ? 'text-xs text-muted-foreground' : 'w-full text-xs text-muted-foreground'}>{projectId ? '共通設定は未保存のためOFFです（初期値30日）。' : '未保存です。日数の初期値は30日で、保存するまで自動アーカイブはOFFです。'}</p>}
          </div>
          <ArchivePolicyForm key={`${formRevision}:${formVersion}`} view={view} revision={formRevision!} disabled={busy || query.isFetching || query.isError || query.isPaused} onSave={save} onChange={changed => { if (!dirty && changed) draftRevision.current = view.revision; setDirty(changed); setMessage(''); }} />
          {!view.canEdit && <p className="text-sm text-muted-foreground">この設定を変更する権限がありません。</p>}
          {busy && <p role="status" className="text-sm text-muted-foreground">設定を保存中…</p>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          {saveError && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{saveError}</p><p className="text-xs">入力内容を保持しています。再度保存するか、最新の設定を読み直してください。</p><Button type="button" variant="ghost" size="sm" disabled={busy || query.isFetching} onClick={async () => { const result = await query.refetch(); if (!result.isError) { setDirty(false); setSaveError(''); setFormVersion(version => version + 1); } }}>入力を戻して最新の設定を取得</Button></div>}
          {projectId ? <>
            <p className="text-xs text-muted-foreground">保存時と毎日0時（日本時間）に確認。{view.backgroundConfigured ? '閉じている間も未実施分を確認します。' : '未実施分は次に開いた時に1回確認します。'}</p>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">日数の数え方・復元</summary><p className="pt-1">1日＝24時間。完了日時から数え、保存後に適用します。アーカイブ後はプロジェクト設定から復元できます。</p></details>
          </> : <p className="text-xs text-muted-foreground">保存すると、対象タスクのアーカイブを開始します。以後は毎日0時（日本時間）に確認します。{view.backgroundConfigured ? 'ページを閉じている間もバックグラウンドで当日の未実施分を確認します。' : '閉じていた場合は、次に開いた時に未実施分を1回確認します。'}アーカイブ後はプロジェクト設定から復元できます。</p>}
          {view.lastRun && <p role={view.lastRun.error ? 'alert' : undefined} className={view.lastRun.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            前回の確認：{dateLabel(view.lastRun.at)} · {view.lastRun.archivedCount}件をアーカイブ{view.lastRun.error && ` · ${view.lastRun.error}`}
          </p>}
          {projectId && view.preview && <ArchiveCandidates projectId={projectId} view={view} busy={busy || query.isFetching || query.isPaused || dirty} updating={busy || query.isFetching} onRefresh={() => void query.refetch()} />}
        </>}
      </>}
    </CardContent>
  </Card>;
}

function ArchivePolicyForm({ view, revision, disabled, onSave, onChange }: { view: AutoArchiveView; revision: string; disabled: boolean; onSave: (input: AutoArchiveSave) => Promise<void>; onChange: (changed: boolean) => void }) {
  const id = useId();
  const compact = !!view.projectId;
  const [mode, setMode] = useState(view.projectId ? view.mode : 'custom');
  const initialDays = !view.configured ? DEFAULT_AUTO_ARCHIVE_DAYS : view.mode === 'inherit' ? view.defaultDays ?? DEFAULT_AUTO_ARCHIVE_DAYS : view.days;
  const [period, setPeriod] = useState(initialDays === null ? 'off' : initialDays === 7 || initialDays === 30 ? String(initialDays) : 'custom');
  const [custom, setCustom] = useState(String(initialDays ?? 90));
  const [saved] = useState({ configured: view.configured, mode: view.projectId ? view.mode : 'custom', days: view.days });
  const hasChanges = (nextMode: string, nextPeriod: string, nextCustom: string) => !saved.configured || nextMode !== saved.mode || nextMode === 'custom' && (nextPeriod === 'off' ? null : nextPeriod === 'custom' ? Number(nextCustom) : Number(nextPeriod)) !== saved.days;
  const changed = hasChanges(mode, period, custom);
  const canSave = changed || !!view.lastRun?.error;
  const days = period === 'off' ? null : period === 'custom' ? Number(custom) : Number(period);
  const valid = mode === 'inherit' || days === null || (period !== 'custom' || /^\d+$/.test(custom)) && validArchiveDays(days);
  return <form className={compact ? 'space-y-2' : 'space-y-3'} onSubmit={event => { event.preventDefault(); if (canSave && valid && !disabled && view.canEdit) void onSave({ projectId: view.projectId, revision, mode, days: mode === 'inherit' ? null : days }); }}>
    <fieldset disabled={disabled || !view.canEdit} className={compact ? 'flex min-w-0 flex-wrap items-end gap-2' : 'flex min-w-0 flex-wrap items-center gap-2'}>
      {view.projectId && <div className="min-w-0">
        <label htmlFor={`${id}-scope`} className="sr-only">日数の設定</label>
        <select id={`${id}-scope`} value={mode} onChange={event => { setMode(event.target.value as 'inherit' | 'custom'); onChange(hasChanges(event.target.value, period, custom)); }} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm">
          <option value="inherit">共通設定（{periodLabel(view.defaultDays)}）</option>
          <option value="custom">このプロジェクトだけ指定</option>
        </select>
      </div>}
      {mode === 'custom' && <div className={compact ? 'flex min-w-0 flex-wrap items-end gap-2' : 'contents'}>
        <div className={compact ? 'space-y-1' : 'flex min-w-0 flex-wrap items-center gap-2'}>
          <label htmlFor={`${id}-period`} className={compact ? 'sr-only' : 'shrink-0 text-sm font-medium'}>完了からの期間</label>
          <select id={`${id}-period`} value={period} onChange={event => { setPeriod(event.target.value); onChange(hasChanges(mode, event.target.value, custom)); }} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm">
            <option value="off">自動アーカイブしない（OFF）</option><option value="7">1週間（7日）</option><option value="30">1か月（30日）</option><option value="custom">指定日数</option>
          </select>
        </div>
        {period === 'custom' && <div className={compact ? 'space-y-1' : 'flex flex-wrap items-center gap-2'}><label htmlFor={`${id}-days`} className="block text-sm font-medium">日数（1〜3650）</label><Input id={`${id}-days`} type="number" min={1} max={3650} step={1} value={custom} onChange={event => { setCustom(event.target.value); onChange(hasChanges(mode, period, event.target.value)); }} className="h-9 w-32" /></div>}
      </div>}
      {!valid && <p role="alert" className={compact ? 'w-full text-xs text-destructive' : 'order-last w-full text-xs text-destructive'}>1〜3650の整数で指定してください。</p>}
      <Button type="submit" size="sm" className="h-9" disabled={!valid || !canSave}>保存</Button>
      {changed && <span className="text-xs text-amber-700">未保存</span>}
    </fieldset>
  </form>;
}

function ArchiveCandidates({ projectId, view, busy, updating, onRefresh }: { projectId: string; view: AutoArchiveView; busy: boolean; updating: boolean; onRefresh: () => void }) {
  const preview = view.preview!;
  return <section className="space-y-3 rounded-lg border p-3" aria-label="アーカイブ対象のプレビュー">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">保存済み設定の対象</h3><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRefresh}><RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />プレビューを更新</Button></div>
    <p className="text-xs text-muted-foreground">判定時点：{dateLabel(view.asOf)}{updating && '・更新中…'}</p>
    <p className="text-sm">対象 {preview.candidates.length}件 ／ 期間未経過 {preview.waitingCount}件</p>
    {(preview.missingDateCount > 0 || preview.protectedCount > 0 || preview.restoredCount > 0) && <p className="text-xs text-muted-foreground">対象外：完了日不明 {preview.missingDateCount}件・保護対象 {preview.protectedCount}件・復元済み {preview.restoredCount}件</p>}
    {preview.candidates.length === 0 ? <p className="text-sm text-muted-foreground">現在の設定に該当するタスクはありません。</p> : <ul className="max-h-80 divide-y overflow-y-auto">{preview.candidates.map(candidate => <li key={candidate.id} className="py-2">
      <Link href={`/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(candidate.id)}`} className={taskRowInteraction + ' block rounded-md px-1 py-1 break-words text-sm font-medium'}>{candidate.title}</Link>
      <p className="mt-1 break-words text-xs text-muted-foreground">{candidate.listName} · 完了 {dateLabel(candidate.completedAt)} · {candidate.elapsedDays}日経過</p>
    </li>)}</ul>}
    <p className="text-xs text-muted-foreground">取得時点の対象です。実行時に最新の状態を確認します。</p>
  </section>;
}
