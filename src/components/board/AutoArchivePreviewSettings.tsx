'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Archive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getProjectLists, getProjectTasks } from '@/lib/firebase/firestore';
import { DEFAULT_AUTO_ARCHIVE_DAYS, previewAutoArchive, validArchiveDays } from '@/lib/board/autoArchivePreview';
import { archivePreviewScope, AUTO_ARCHIVE_PREVIEW_KEY, useAutoArchivePreviewStore } from '@/stores/autoArchivePreviewStore';
import { useAuthStore } from '@/stores/authStore';

export function AutoArchivePreviewSettings({ projectId }: { projectId: string }) {
  const viewerId = useAuthStore(state => state.user?.id ?? '');
  const { byScope, hydrated, hydrate, persistenceFailed, save } = useAutoArchivePreviewStore();
  const scope = archivePreviewScope(viewerId, projectId);
  const days = byScope[scope] === undefined ? DEFAULT_AUTO_ARCHIVE_DAYS : byScope[scope];
  useEffect(() => {
    hydrate();
    const sync = (event: StorageEvent) => { if (event.key === AUTO_ARCHIVE_PREVIEW_KEY || event.key === null) hydrate(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [hydrate]);
  return <Card id="auto-archive-preview" aria-label="自動アーカイブのテスト設定">
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2"><Archive className="h-5 w-5" />完了タスクの自動アーカイブ
        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-normal text-amber-800">テスト用・自動実行なし</span>
      </CardTitle>
      <CardDescription>初期値は完了から30日です。期間設定と対象タスクのプレビューを、このログインユーザー・このプロジェクトに適用します。設定はこのブラウザだけに保存し、共有データは変更しません。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {!hydrated ? <p role="status" className="text-sm text-muted-foreground">設定を読み込み中…</p> : !viewerId ? <p className="text-sm">設定するにはログインしてください。</p> : <>
        <ArchivePeriodForm key={`${scope}:${days}`} days={days} onSave={value => save(scope, value)} />
        {persistenceFailed && <p role="alert" className="text-sm text-destructive">ブラウザに保存できません。この画面内だけで設定を保持しています。</p>}
        {days === null ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">自動処理なし（OFF）。期間を選んで保存すると、対象タスクを確認できます。</p> : <ArchiveCandidates key={scope} projectId={projectId} viewerId={viewerId} days={days} />}
      </>}
    </CardContent>
  </Card>;
}

function ArchivePeriodForm({ days, onSave }: { days: number | null; onSave: (value: number | null) => void }) {
  const id = useId();
  const [period, setPeriod] = useState(days === null ? 'off' : days === 7 || days === 30 ? String(days) : 'custom');
  const [custom, setCustom] = useState(String(days ?? 90));
  const value = period === 'off' ? null : period === 'custom' ? Number(custom) : Number(period);
  const valid = value === null || (period !== 'custom' || /^\d+$/.test(custom)) && validArchiveDays(value);
  const [saved, setSaved] = useState(false);
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (valid) { onSave(value); setSaved(true); } }}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-period`} className="block text-sm font-medium">完了からの期間</label>
        <select id={`${id}-period`} value={period} onChange={event => { setPeriod(event.target.value); setSaved(false); }} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="off">自動処理なし（OFF）</option>
          <option value="7">1週間（7日）</option>
          <option value="30">1か月（30日）</option>
          <option value="custom">指定日数</option>
        </select>
      </div>
      {period === 'custom' && <div className="space-y-1">
        <label htmlFor={`${id}-days`} className="block text-sm font-medium">日数（1〜3650）</label>
        <Input id={`${id}-days`} type="number" min={1} max={3650} step={1} value={custom} onChange={event => { setCustom(event.target.value); setSaved(false); }} className="h-9 w-32" />
      </div>}
      <Button type="submit" variant="outline" size="sm" disabled={!valid}>テスト設定を保存</Button>
    </div>
    {!valid && <p role="alert" className="text-xs text-destructive">1〜3650の整数で指定してください。</p>}
    <p className="text-xs text-muted-foreground">1日＝24時間。完了日時から数えます。保存後にプレビューへ反映します。</p>
    {saved && <p role="status" className="text-xs text-muted-foreground">テスト設定を反映しました。</p>}
  </form>;
}

function ArchiveCandidates({ projectId, viewerId, days }: { projectId: string; viewerId: string; days: number }) {
  const query = useQuery({
    queryKey: ['auto-archive-preview', viewerId, projectId],
    queryFn: async () => {
      const [tasks, lists] = await Promise.all([getProjectTasks(projectId), getProjectLists(projectId)]);
      return { tasks, lists };
    },
    staleTime: 30_000,
    retry: 1,
  });
  const asOf = new Date(query.dataUpdatedAt);
  const result = query.data ? previewAutoArchive(query.data.tasks, projectId, days, asOf) : null;
  return <section className="space-y-3 rounded-lg border p-3" aria-label="アーカイブ対象のプレビュー">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">対象プレビュー：完了から{days}日以上</h3>
      <Button type="button" variant="ghost" size="sm" disabled={query.isFetching || query.isPaused} onClick={() => { void query.refetch(); }}><RefreshCw className="mr-1 h-3 w-3" />プレビューを更新</Button>
    </div>
    <p className="text-xs text-amber-800">一覧に表示されてもアーカイブされません。自動実行は未接続です。</p>
    {query.isPaused ? <p role="status" className="text-sm text-muted-foreground">オフラインのため更新待ちです。接続後に再取得します。</p> : query.isError ? <p role="alert" className="text-sm text-destructive">タスクを取得できませんでした。「プレビューを更新」から再試行してください。</p> : query.isPending ? <p role="status" className="text-sm text-muted-foreground">タスクを読み込み中…</p> : result && <>
      <p className="text-xs text-muted-foreground">判定時点：{format(asOf, 'yyyy/M/d HH:mm')}（この端末の時刻）{query.isFetching && '・更新中…'}</p>
      <p className="text-sm">対象 {result.candidates.length}件 ／ 期間未経過 {result.waitingCount}件 ／ 完了日不明で除外 {result.missingDateCount}件</p>
      {result.candidates.length === 0 ? <p className="py-2 text-sm text-muted-foreground">この期間に該当するタスクはありません。</p> : <ul className="max-h-80 divide-y overflow-y-auto">
        {result.candidates.map(({ task, completedAt, elapsedDays }) => <li key={task.id} className="py-3">
          <Link href={`/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(task.id)}`} className="block break-words text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring">{task.title}</Link>
          <p className="mt-1 break-words text-xs text-muted-foreground">{query.data.lists.find(list => list.id === task.listId)?.name ?? 'リスト不明'} · 完了 {format(completedAt, 'yyyy/M/d HH:mm')} · {elapsedDays}日経過</p>
        </li>)}
      </ul>}
      <p className="text-xs text-muted-foreground">未完了・アーカイブ済み・完了日不明のタスクは対象に含めません。最新の状態は「プレビューを更新」で確認できます。</p>
    </>}
  </section>;
}
