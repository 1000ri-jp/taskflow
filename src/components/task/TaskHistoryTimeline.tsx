'use client';
import { useState } from 'react';
import { format } from 'date-fns';
import { useTaskHistory } from '@/hooks/useTaskHistory';
import { changeLabel, changeValue, commentHistoryEntries, safeHistoryUrl, sortHistory } from '@/lib/task/history/presentation';
import { Button } from '@/components/ui/button';
import type { Comment } from '@/types';
import { requestOrganization } from '@/lib/task/organizationClient';
import type { OrganizationSource } from '@/lib/task/organizationTypes';

const dateLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? format(new Date(value), 'yyyy/M/d HH:mm') : '日時未確認';
function MeetingOriginal({ projectId, operationId }: { projectId: string; operationId: string }) {
  const [source, setSource] = useState<OrganizationSource | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError(''); setSource(null);
    try {
      const result = await requestOrganization<OrganizationSource>({ action: 'source', projectId, id: operationId });
      if (result.kind !== 'meeting' || typeof result.text !== 'string') throw new Error('会議原文を確認できません。');
      setSource(result);
    } catch { setError('会議原文を取得できません。取り込んだ本人のアクセス権限を確認してください。'); }
    finally { setBusy(false); }
  };
  return <div className="mt-1"><button type="button" className="text-blue-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => source ? setSource(null) : void load()}>{busy ? '原文を取得中…' : source ? '会議原文を閉じる' : '会議原文を開く（取り込んだ本人用）'}</button>
    {error && <p role="alert" className="mt-1 text-amber-700">{error}</p>}
    {source && <div className="mt-2 max-h-60 overflow-y-auto rounded bg-muted/40 p-2"><p className="mb-1 text-muted-foreground">{source.title} · 会議 {dateLabel(source.occurredAt)} · 本人用の取込原文</p><p className="whitespace-pre-wrap break-words">{source.text}</p></div>}
  </div>;
}
export function TaskHistoryTimeline({ projectId, taskId, userId, comments, commentStatus, names, enabled, taskUpdatedAt, inlineCommentOriginals = false }: {
  projectId: string; taskId: string; userId?: string; comments: Comment[];
  commentStatus?: 'loading' | 'ready' | 'error'; names: Record<string, string>; enabled: boolean; taskUpdatedAt?: string; inlineCommentOriginals?: boolean;
}) {
  const history = useTaskHistory(projectId, taskId, userId, enabled, taskUpdatedAt);
  const [expanded, setExpanded] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const page = history.page;
  const entries = sortHistory([...commentHistoryEntries(comments, names), ...(page?.entries ?? []), ...(privateOpen ? page?.privateSources?.entries ?? [] : [])]);
  const visible = expanded ? entries : entries.slice(0, 5);
  return <section aria-label="このタスクの経緯" className="mt-4 mb-3 rounded-lg border p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">経緯・何が変わったか</h3>
      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={history.busy} onClick={() => void history.refresh()}>{history.busy ? '取得中…' : '再取得'}</Button>
    </div>
    {commentStatus === 'loading' && <p role="status" className="mt-1 text-xs text-muted-foreground">コメントを取得中です。</p>}
    {commentStatus === 'error' && <p role="alert" className="mt-1 text-xs text-amber-700">コメントを取得できません。表示済みの内容は前回取得分です。タスクを開き直して再試行してください。</p>}
    {history.error && <p role="alert" className="mt-1 text-xs text-amber-700">{history.error}</p>}
    {page?.issues.map(issue => <p key={issue} className="mt-1 text-xs text-muted-foreground">{issue}</p>)}
    {!visible.length && !history.busy && !history.error && page?.activityStatus === 'ready' && commentStatus === 'ready' && <p className="py-3 text-xs text-muted-foreground">取得できた共有の経緯はまだありません。</p>}
    <ol className="mt-2 space-y-2">
      {visible.map(entry => {
        const url = safeHistoryUrl(entry.url);
        return <li key={entry.id} className="min-w-0 border-l-2 pl-3 text-xs">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium">{entry.title}</span>
            <span className="text-muted-foreground">{entry.actor} · {entry.kind === 'meeting' ? '会議 ' : entry.kind === 'gmail' ? 'メール ' : ''}{dateLabel(entry.at)}</span>
            {entry.private && <span className="rounded bg-violet-50 px-1.5 text-violet-700">本人用</span>}
          </div>
          {entry.text && <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">{entry.text}</p>}
          {!!entry.changes?.length && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">変更内容（{entry.changes.map(c => changeLabel(c.field)).join('・')}）</summary>
            {entry.changes.map((change, i) => <p key={i} className="mt-1 break-words">{changeLabel(change.field)}：{changeValue(change.field, change.before)} → {changeValue(change.field, change.after)}</p>)}
          </details>}
          {entry.recordedAt && <p className="mt-1 text-muted-foreground">{entry.kind === 'meeting' ? '反映' : entry.kind === 'comment' ? '編集' : '関連付け'} {dateLabel(entry.recordedAt)}</p>}
          {entry.kind === 'comment' && inlineCommentOriginals && <details className="mt-1"><summary className="cursor-pointer text-blue-600">コメントの全文を開く</summary><p className="mt-1 whitespace-pre-wrap break-words">{entry.text}</p></details>}
          {url && !(entry.kind === 'comment' && inlineCommentOriginals) && <a className="mt-1 inline-block text-blue-600 hover:underline" href={url} {...(!url.startsWith('#') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            onClick={url.startsWith('#') ? event => { event.preventDefault(); document.getElementById(url.slice(1))?.scrollIntoView({ block: 'center' }); } : undefined}>原文を開く</a>}
          {entry.sourceRef && entry.sourceRef.ownerId === userId && <MeetingOriginal key={`${entry.id}/${page?.checkedAt}`} projectId={projectId} operationId={entry.sourceRef.operationId} />}
          {entry.kind === 'meeting' && !url && entry.text && <details className="mt-1"><summary className="cursor-pointer text-blue-600">保存された会議の引用</summary><p className="mt-1 whitespace-pre-wrap break-words">{entry.text}</p></details>}
        </li>;
      })}
    </ol>
    {(entries.length > 5 || page?.nextCursor) && <div className="mt-2 flex flex-wrap gap-2">
      {entries.length > 5 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(v => !v)}>{expanded ? '最新5件に戻す' : `取得済みの経緯を展開（${entries.length}件）`}</Button>}
      {page?.nextCursor && <Button variant="outline" size="sm" className="h-7 text-xs" disabled={history.busy} onClick={() => { setExpanded(true); void history.more(); }}>さらに古い変更を取得</Button>}
    </div>}
    {page?.privateSources && <div className="mt-3 border-t pt-2">
      <button type="button" className="text-left text-xs text-violet-700" aria-expanded={privateOpen} onClick={() => { setPrivateOpen(v => !v); setExpanded(true); }}>本人用のメール・Chat（{page.privateSources.entries.length}件）{privateOpen ? 'を閉じる' : 'を見る'}</button>
      {page.privateSources.status !== 'ready' && <span className="ml-2 text-xs text-amber-700">{({ partial: '一部未取得', unavailable: '接続・許可範囲を確認', error: '取得失敗' } as const)[page.privateSources.status]}</span>}
      {privateOpen && <div className="mt-1 space-y-1 text-xs text-muted-foreground"><p>本人の閲覧用です。本文は共有コメントへ複製されません。</p>{page.privateSources.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
    </div>}
    {page && <p className="mt-2 text-[10px] text-muted-foreground">経緯の取得確認 {dateLabel(page.checkedAt)} · コメントと、このタスクを対象とする変更を表示</p>}
  </section>;
}
