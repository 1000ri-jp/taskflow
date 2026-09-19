'use client';

import { useId, useState } from 'react';
import { AIReferenceFields } from './AIReferenceFields';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_AI_SUPPORT, SUPPORT_LIMITS, supportProfileSummary, type AISupportProfile } from '@/lib/ai/support/profile';
import { requestAISupport } from '@/lib/ai/support/client';

export const supportQueryKey = (userId: string) => ['ai-support', userId];

export function AISupportSettings({ userId }: { userId: string }) {
  const query = useQuery({ queryKey: supportQueryKey(userId), queryFn: () => requestAISupport(userId), enabled: !!userId, refetchOnWindowFocus: false });
  return <Card density="compact" id="ai-support">
    <CardHeader>
      <CardTitle>AIの手伝い方</CardTitle>
      <CardDescription>まずはこの形で手伝います。合わなければ一言で変えられます。</CardDescription>
    </CardHeader>
    <CardContent>
      {query.isPending ? <p role="status" className="text-sm text-muted-foreground">読み込み中…</p>
        : query.isError ? <div role="alert"><p className="text-sm">手伝い方を取得できませんでした。</p><Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>再取得</Button></div>
          : <SupportForm key={userId} userId={userId} saved={query.data} />}
    </CardContent>
  </Card>;
}

function SupportForm({ userId, saved }: { userId: string; saved: AISupportProfile }) {
  const queryClient = useQueryClient();
  const displayHelpId = useId();
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const next = await requestAISupport(userId, draft);
      queryClient.setQueryData(supportQueryKey(userId), next); setDraft(next);
      setMessage('保存しました。次のAI応答・新しく整理する提案から反映します。');
    } catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした。'); }
    finally { setBusy(false); }
  }}>
    <div className="rounded-md bg-muted/40 p-3 text-xs">
      <p className="mb-1 font-medium">現在適用している手伝い方</p>
      {supportProfileSummary(saved).map((line, index) => <p key={index} className="whitespace-pre-wrap break-words">{line}</p>)}
    </div>
    <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />個人化を使う</label>
      <label className="block space-y-1 text-sm"><span>希望（任意）</span><Textarea aria-label="AIへの希望" value={draft.wishes} maxLength={SUPPORT_LIMITS.wishes} rows={2} placeholder="端的に。次の一歩を先に。全体の一覧にもすぐ戻りたい。" onChange={event => setDraft({ ...draft, wishes: event.target.value })} /></label>
      {draft.feedback && <label className="block space-y-1 text-sm"><span>使っている場所で伝えた最新の希望</span><Textarea aria-label="最新の希望" value={draft.feedback} maxLength={1000} rows={2} onChange={event => setDraft({ ...draft, feedback: event.target.value })} /></label>}
      <label className="flex flex-wrap items-center gap-2 text-sm"><span>仕事の表示</span><select aria-label="仕事の表示" aria-describedby={displayHelpId} className="rounded-md border bg-background px-2 py-1" value={draft.presentation ?? 'brief'} onChange={event => setDraft({ ...draft, presentation: event.target.value as 'brief' | 'overview' })}><option value="brief">次の一歩を先に</option><option value="overview">背景・全体を先に</option></select></label>
      <p id={displayHelpId} className="text-xs text-muted-foreground">行動から、短く。全体から、詳しく。</p>
      <label className="block space-y-1 text-sm"><span>普段の手伝い方を調整（任意）</span><Textarea aria-label="普段の手伝い方" value={draft.approach} maxLength={SUPPORT_LIMITS.approach} rows={2} placeholder="まず結論、その後に理由。提案は必要なときだけ。" onChange={event => setDraft({ ...draft, approach: event.target.value })} /></label>
      <AIReferenceFields draft={draft} onChange={setDraft} />
      <p className="text-xs text-muted-foreground">本人だけの設定です。有効な内容は、選択中のAIに応答・提案のために送られます。担当・期限・権限は変わりません。</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ ...DEFAULT_AI_SUPPORT }); setMessage('標準の内容に戻しました。保存すると反映します。'); }}>標準に戻す</Button>
        <Button type="submit" size="sm" disabled={!changed}>{busy ? '保存中…' : '保存して反映'}</Button>
      </div>
    </fieldset>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
