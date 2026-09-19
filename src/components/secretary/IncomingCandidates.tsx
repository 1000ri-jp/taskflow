'use client';

import { useState } from 'react';
import { TaskOrganizer } from '@/components/task/TaskOrganizer';
import { requestReplyDraft, showScopedConversation } from '@/lib/ai/scopedConversationClient';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { currentIncomingReview, incomingSourceUsable, INCOMING_SERVICES, MAX_INCOMING_ITEMS } from '@/lib/secretary/incoming';
import type { SecretaryView } from '@/lib/secretary/types';
import { pendingIncomingCandidates, visibleIncomingDecisions, type IncomingActionRequest } from '@/lib/secretary/incomingDecisions';

const date = (v: string) => new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const labels = { request: '依頼の確認', reply: '返信の確認', deadline: '期限の確認' };
function incomingPresentation(view: SecretaryView) {
  const context = view.snapshot.incoming;
  if (!context) return null;
  const hasUsable = INCOMING_SERVICES.some(s => incomingSourceUsable(context.sources[s], view.snapshot.checkedAt));
  const candidates = pendingIncomingCandidates(view.state, view.snapshot);
  const review = currentIncomingReview(view.state, view.snapshot);
  const scopeIssues = INCOMING_SERVICES.flatMap(service => {
    const source = context.sources[service];
    if (!source.connected) return [];
    const issue = source.status === 'error' ? '取得エラー' : source.status === 'selection_required' ? '対象未選択' : source.status === 'pending' || !source.fetchedAt ? '未取得' : !incomingSourceUsable(source, view.snapshot.checkedAt) ? '情報が古い・更新が必要' : source.status === 'partial' ? '一部取得' : null;
    return issue ? [`${service === 'gmail' ? 'Gmail' : 'Chat'}：${issue}`] : [];
  });
  const status = candidates.length ? `${hasUsable ? '' : '前回の'}確認候補 ${candidates.length}件` : !hasUsable ? '未確認 · Google連携を確認' : review ? '取得範囲に確認候補なし' : '未整理 · 「AIで整理」で確認';
  return { hasUsable, status, scopeIssues };
}

export function incomingCandidatesStatus(view: SecretaryView, { includeCoverage = true }: { includeCoverage?: boolean } = {}): string | null {
  const presentation = incomingPresentation(view);
  if (!presentation) return view.incomingStorage?.inactive ? `メール・Chat：取得対象外の記録 ${view.incomingStorage.inactive}件` : null;
  return [`メール・Chat：${presentation.status}`, ...(includeCoverage ? presentation.scopeIssues : [])].join(' ／ ');
}

export function IncomingCandidates({ view, disabled = false, onAction, embedded = false }: { view: SecretaryView; disabled?: boolean; onAction?: (request: IncomingActionRequest) => void; embedded?: boolean }) {
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const { provider, getActiveModel } = useAISettingsStore();
  const [expanded, setExpanded] = useState(false);
  const context = view.snapshot.incoming;
  if (!context) return view.incomingStorage?.inactive && onAction ? <details className="mt-3 border-t pt-3 text-xs text-stone-500"><summary className="cursor-pointer">連絡の保存記録 {view.incomingStorage.inactive}件</summary><div className="mt-2"><p>取得対象外の保存記録 {view.incomingStorage.inactive}件（保留 {view.incomingStorage.heldInactive}件）</p><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction({ kind: 'incoming', action: 'forget_inactive', revision: view.state.revision, requestId: crypto.randomUUID() })}>取得対象外の記録を削除（保留を含む）</Button></div></details> : null;
  const review = currentIncomingReview(view.state, view.snapshot);
  const candidates = pendingIncomingCandidates(view.state, view.snapshot);
  const records = visibleIncomingDecisions(view.state, view.snapshot).filter(d => d.status !== 'cleared');
  const act = (action: IncomingActionRequest['action'], target: { candidateId?: string; decisionKey?: string; taskKey?: string }) => onAction?.({ kind: 'incoming', action, ...target, connectionEpoch: context.connectionEpoch, revision: view.state.revision, requestId: crypto.randomUUID() });
  async function openDraft(sourceId: string, candidateId: string) {
    if (draftBusy) return;
    setDraftBusy(true); setDraftError(null);
    try {
      const result = await requestReplyDraft(view.snapshot.userId, { action: 'open', sourceId, candidateId, signature: context!.signature }, provider, getActiveModel());
      showScopedConversation(view.snapshot.userId, result.conversationId, 'draft');
    } catch (error) { setDraftError(error instanceof Error ? error.message : '返信案を保存できませんでした。もう一度開くと同じ依頼を再試行します。'); }
    finally { setDraftBusy(false); }
  }
  const { hasUsable, status, scopeIssues } = incomingPresentation(view)!;
  return <section aria-label="メール・Chatの確認候補" className={embedded ? 'space-y-2' : 'mt-3 space-y-2 border-t border-stone-200 pt-3'}>
    {!embedded && <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h4 className="text-sm font-semibold text-stone-700">メール・Chat</h4>
      <p role="status" className="text-xs text-stone-500">{status}{scopeIssues.length > 0 && <span className="ml-2 text-amber-800">{scopeIssues.join(' ／ ')}</span>}</p></div>}
    {draftError && <p role="alert" className="text-sm text-destructive">{draftError}</p>}
    {(expanded ? candidates : candidates.slice(0, 3)).map(p => <article key={p.id} aria-label={`連絡候補: ${p.title}`} className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap gap-2 text-xs text-stone-600"><span className="rounded bg-orange-50 px-2 py-0.5 text-orange-800">{labels[p.kind]}</span>{[...new Set(p.evidence.map(e => e.service))].map(s => <span key={s}>{s === 'gmail' ? 'Gmail' : 'Google Chat'}</span>)}</div>
      <h5 className="mt-2 font-medium text-stone-900">{p.title}</h5>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">{p.reason}</p>
      {p.evidence.some(e => e.service === 'gmail') && <Button className="mt-2" size="sm" variant="outline" disabled={disabled || draftBusy} onClick={() => openDraft(p.evidence.find(e => e.service === 'gmail')!.id, p.id)}>{draftBusy ? '返信案を準備中…' : '返信案'}</Button>}
      {onAction && <details className="mt-3 text-sm"><summary className="cursor-pointer">整理</summary><div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={() => act('done', { candidateId: p.id })}>対応済み</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => act('hold', { candidateId: p.id })}>保留</Button>
        <label className="sr-only" htmlFor={`link-${p.id}`}>関連する仕事</label><select id={`link-${p.id}`} aria-label={`関連する仕事: ${p.title}`} value="" disabled={disabled} className="max-w-full rounded border bg-white px-2 py-1 text-sm" onChange={e => { if (e.target.value) act('link', { candidateId: p.id, taskKey: e.target.value }); }}><option value="">仕事に関連付ける…</option>{[...view.snapshot.tasks].sort((a, b) => Number(p.matchedTaskKeys.includes(b.key)) - Number(p.matchedTaskKeys.includes(a.key))).map(t => <option key={t.key} value={t.key}>{t.projectName} ／ {t.title}</option>)}</select>
      </div></details>}
      <div className="mt-3 flex flex-wrap gap-2">{[...new Set((p.matchedTaskKeys.length ? view.snapshot.tasks.filter(t=>p.matchedTaskKeys.includes(t.key)) : view.snapshot.tasks).filter(t=>t.canWrite).map(t=>t.projectId))].map(projectId=>{
        const first=p.evidence[0];const item=context.sources[first.service].items.find(i=>i.id===first.id);if(!item)return null;
        const projectTasks=view.snapshot.tasks.filter(t=>t.projectId===projectId&&t.canWrite);
        const target=projectTasks.find(t=>p.matchedTaskKeys.includes(t.key));
        return <TaskOrganizer key={projectId} projectId={projectId} tasks={projectTasks.map(t=>({id:t.taskId,title:t.title,assigneeIds:t.assigneeIds}))} disabled={disabled}
          source={{kind:'incoming',id:`${first.service}:${first.id}`,title:item.title,text:item.text,occurredAt:item.at,incoming:{service:first.service,id:first.id,version:context.sourceVersions?.[`${first.service}:${first.id}`]??'',...(context.connectionEpoch?{connectionEpoch:context.connectionEpoch}:{})}}}
          initialDraft={{kind:'update',taskIds:target?[target.taskId]:[],...(target?{targetTaskId:target.taskId}:{}),description:'',reason:'元の連絡を確認し、共有する内容と反映先を本人が指定します。',quote:first.quote}}
          label={`${projectTasks[0]?.projectName??'仕事'}へ反映`}/>;
      })}</div>
      {p.deadline && <p className="mt-2 text-xs text-orange-900">期限の原文：「{p.deadline}」<span className="ml-1 text-stone-500">日付・対応状況は要確認</span></p>}
      {p.uncertainties.length > 0 && <p className="mt-2 text-xs leading-relaxed text-amber-800">確認すること：{p.uncertainties.join(' ／ ')}</p>}
      {p.matchedTaskKeys.length > 0 && <div className="mt-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-600"><p>既存タスクとの照合候補</p>{p.matchedTaskKeys.map(key => {
        const task = view.snapshot.tasks.find(t => t.key === key);
        return task && <p key={key} className="mt-1"><Link className="underline underline-offset-4" href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.taskId)}`}>{task.projectName} ／ {task.title}</Link>{task.isCompleted ? '（完了済み）' : task.isAbandoned ? '（中止済み）' : ''}</p>;
      })}</div>}
      <details className="mt-3 text-xs text-stone-600"><summary className="cursor-pointer">原文・元の連絡を確認（{p.evidence.length}件）</summary><div className="mt-2 space-y-3">{p.evidence.map((e, i) => <div key={`${e.service}:${e.id}:${i}`}>
        <p>{e.sourceName} ／ {date(e.at)}</p><blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-stone-200 pl-3">{e.quote}</blockquote>
        <a className="mt-1 inline-block underline underline-offset-4" href={e.url} target="_blank" rel="noopener noreferrer">{e.service === 'gmail' ? '元のメールを開く' : '投稿元のChatを開く'}</a>
      </div>)}</div></details>
    </article>)}
    {review && candidates.length > 3 && <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? '連絡候補を3件に戻す' : `残りの連絡候補${candidates.length - 3}件を見る`}</Button>}
    {records.length > 0 && <details className="text-sm"><summary className="cursor-pointer">保留・対応済み・関連付け {records.length}件</summary><div className="mt-2 space-y-2">{records.map(d => <div key={d.key} className="rounded-lg border bg-white p-3">
      <p className="font-medium">{d.title} <span className="text-xs text-stone-500">{({ done: '対応済み', hold: '保留', linked: '関連付け済み', reconsider: '再確認', cleared: '' })[d.status]}</span></p>
      <p className="mt-1 text-xs text-stone-600">{d.reason}{d.status === 'hold' && ` ／ ${d.trigger}${d.reviewAt ? ` ／ ${date(d.reviewAt)}に再確認` : ''}`}</p>
      <div className="mt-2 flex flex-wrap gap-2">{d.sources.map(s => { const item = context.sources[s.service].items.find(i => i.id === s.id); return item && /^https:\/\/(mail|chat)\.google\.com\//.test(item.url) ? <a key={`${s.service}:${s.id}`} href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">元の連絡を開く</a> : null; })}
      {d.related.map(r => { const t = view.snapshot.tasks.find(t => t.key === r.key); return t && <Link key={r.key} className="text-sm underline" href={`/projects/${encodeURIComponent(t.projectId)}/board?task=${encodeURIComponent(t.taskId)}`}>{t.title}</Link>; })}
      {onAction && <><Button size="sm" variant="ghost" disabled={disabled} onClick={() => act('undo', { decisionKey: d.key })}>戻す</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => act('correct', { decisionKey: d.key })}>再確認する</Button>{d.status !== 'hold' && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => act('forget', { decisionKey: d.key })}>記録を削除</Button>}</>}
      </div></div>)}</div></details>}
    <details className="text-xs text-stone-500"><summary className="cursor-pointer">連絡の取得範囲</summary><div className="mt-2 space-y-2">
      <p>取得した範囲からのAI確認候補です。対応状況は元の連絡で確認できます。未取得の連絡は未確認です。</p>
      {review && <p>最終整理：{date(review.reviewedAt)}</p>}
      {!hasUsable && <p><Link href="/settings/google" className="underline">Google連携</Link>で取得対象を確認し、Googleの情報を更新してください。</p>}
      {!!view.incomingStorage?.inactive && onAction && <div className="rounded border p-2"><p>取得対象外・取消済みの記録 {view.incomingStorage.inactive}件（保留 {view.incomingStorage.heldInactive}件）。本文は取得対象へ戻すと確認できます。</p><Button size="sm" variant="ghost" disabled={disabled} onClick={() => act('forget_inactive', {})}>取得対象外・取消済みの記録を削除（保留を含む）</Button></div>}
      <p>確認対象：{context.ownerName || context.email}</p>
      {INCOMING_SERVICES.map(service => {
        const s = context.sources[service];
        const usable = incomingSourceUsable(s, view.snapshot.checkedAt);
        const status = !s.connected ? '未接続' : s.status === 'selection_required' ? '取得対象未選択' : s.status === 'pending' ? '取得待ち' : s.status === 'error' ? '取得失敗・今回の整理対象外' : !usable ? '取得から3時間超・今回の整理対象外' : `${s.items.length}件取得${s.status === 'partial' ? '・一部取得' : ''}`;
        return <p key={service}>{service === 'gmail' ? 'Gmail' : 'Google Chat'}：{status}{review && ` ／ 整理対象 ${review.counts[service]}件`}{s.fetchedAt && ` ／ 取得 ${date(s.fetchedAt)}`}<br />対象：{context.selections[service].join('、') || '未選択'}</p>;
      })}
      <p>各サービスの新しい順に最大{MAX_INCOMING_ITEMS}件。Gmailは件名・本文抜粋、Chatはテキストのみ。送信済み・会話全体・添付・取得上限を超えた情報は未確認です。Chatのリンクは投稿元のスペースを開きます。引用と日時を手がかりに確認してください。</p>
    </div></details>
  </section>;
}
