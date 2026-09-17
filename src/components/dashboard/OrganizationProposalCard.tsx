'use client';
import { useState } from 'react';
import { CircleAlert, Clock3, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PreviewChanges } from '@/components/task/PreviewChanges';
import type { OrganizationTaskOption } from '@/components/task/OrganizationDraftEditor';
import { organizationLabels, type OrganizationContext, type OrganizationFollowUp, type OrganizationKind, type OrganizationPreview } from '@/lib/task/organizationTypes';
import type { ReviewAttention } from '@/lib/dashboard/review-queue';

export function OrganizationProposalCard({ record, projectName, locations = [], tasks, context, contextSettled = false, busy = false, disabled = false, error, attention, onApply, onHold, onSkip, onDefer, onAdjust }: {
  record: OrganizationPreview; projectName?: string; locations?: string[]; tasks: OrganizationTaskOption[]; context?: OrganizationContext;
  contextSettled?: boolean; busy?: boolean; disabled?: boolean; error?: string;
  attention?: ReviewAttention; onApply: () => void; onHold: () => void; onSkip: () => void; onDefer?: (followUp: OrganizationFollowUp) => void; onAdjust: () => void;
}) {
  const title = record.changes[0]?.title ?? record.sourceTitle;
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [at, setAt] = useState('');
  const [condition, setCondition] = useState('');
  const levelClass = attention?.level === 'now' ? 'border-rose-200 bg-rose-50' : attention?.level === 'soon' ? 'border-amber-200 bg-amber-50' : 'border-border';
const structureSuggestions: Partial<Record<OrganizationKind, string>> = {
  create: '担当・期限・完了確認を個別に追う仕事は、独立したタスクとして分けます。',
  parent_child: 'ひとつの成果に含まれる工程を個別に追うなら、親タスクとサブタスクにします。',
  new_parent: 'ひとつの成果に向けた複数の工程は、親タスクにまとめます。',
  checklist: '同じ担当が進める細かな手順は、チェックリストにまとめます。',
};
  const AttentionIcon = attention?.level === 'now' ? CircleAlert : attention?.level === 'soon' ? Clock3 : Info;
  const heading = record.kind === 'update' ? `${title}を更新する` : record.kind === 'merge' ? `${title}をまとめる` : `${organizationLabels[record.kind]}：${title}`;
  const defer = onDefer ?? (() => undefined);
  const structureSuggestion = record.aiSuggested ? structureSuggestions[record.kind] : undefined;
  return <article aria-label={`提案: ${title}`} className={`space-y-3 rounded-xl border p-4 ${levelClass}`}>
    <div><p className="text-xs text-muted-foreground">{projectName}{locations.length > 0 && ` / ${locations.join('・')}`}</p><h2 className="mt-1 break-words text-base font-semibold">{heading}</h2><p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary"><AttentionIcon className="size-3.5" aria-hidden="true" />{attention?.label ?? '通常の提案'} · {attention?.reason ?? '都合のよいときに確認'}</p><p className="mt-1 text-xs text-muted-foreground">{organizationLabels[record.kind]}</p>{structureSuggestion && <p className="mt-2 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-foreground"><span className="font-medium">モアイの使い分け提案：</span>{structureSuggestion}</p>}</div>
    <p className="whitespace-pre-wrap break-words text-sm">{record.reason}</p>
    <p className="text-xs text-muted-foreground">対象：{record.changes.map(change => change.title).join('・') || '対象を確認'}。担当・期限などの変更は下の内容を確認してから反映します。</p>
    <div className="rounded-lg bg-muted/40 p-3"><PreviewChanges preview={record} tasks={tasks} context={context ?? { members: [], lists: [] }} expanded /></div>
    <div className="text-xs text-muted-foreground"><p className="break-words">資料：{record.sourceTitle}</p>{record.quote && <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 pl-3">{record.quote}</blockquote>}</div>
    {!!record.clarifications?.length && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">{record.clarifications.map((point, index) => <li key={index}>{point}</li>)}</ul>}
    {!context && !disabled && <p role="status" className="text-xs text-muted-foreground">{contextSettled ? '担当者などの情報を取得できません。「内容を調整」から再取得できます。' : '担当者などの情報を照合中…'}</p>}
    {error && <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" aria-label="採用して反映" title={record.kind === 'merge' ? 'まとめて反映' : 'この変更を反映'} disabled={disabled || busy || !context || record.canApply !== true} onClick={onApply}>{busy ? '保存中…' : record.kind === 'merge' ? 'まとめて反映' : 'この変更を反映'}</Button><Button size="sm" variant="outline" aria-label="保留" title="今は決めない。仕事の期限や進捗は変わりません。" disabled={disabled || busy} onClick={onHold}>今は決めない</Button><Button size="sm" variant="ghost" disabled={disabled || busy} onClick={onSkip}>見送る</Button><Button size="sm" variant="ghost" disabled={disabled || busy} onClick={onAdjust}>内容を調整</Button><Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => setExplainOpen(value => !value)} aria-expanded={explainOpen}>どういうこと？</Button><Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => setFollowUpOpen(value => !value)} aria-expanded={followUpOpen}>あとで知らせる</Button></div>
    {explainOpen && <div className="rounded-lg border bg-background p-3 text-sm" role="status"><p>「{title}」について、{record.reason}</p><p className="mt-2 text-xs text-muted-foreground">対象と担当・期限への影響を確認してから反映できます。詳しい根拠は下の資料と変更前後にあります。</p></div>}
    {followUpOpen && <div className="space-y-3 rounded-lg border bg-background p-3" aria-label="提案の再表示設定"><p className="text-xs text-muted-foreground">仕事の期限や進捗は変えません。本人が選んだ日時・条件だけを、この提案の再表示に使います。</p><div className="flex flex-wrap items-end gap-2"><label className="min-w-[12rem] flex-1 text-xs"><span className="mb-1 block font-medium">日時を決めて知らせる</span><input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2" /></label><Button type="button" size="sm" disabled={disabled || busy || !at} onClick={() => defer({ kind: 'at', at: new Date(at).toISOString() })}>日時を記録</Button></div><div className="flex flex-wrap items-end gap-2"><label className="min-w-[12rem] flex-1 text-xs"><span className="mb-1 block font-medium">動きがあったら知らせる</span><input value={condition} onChange={event => setCondition(event.target.value)} maxLength={500} placeholder="例：見積もりが届いた" className="h-8 w-full rounded-md border bg-background px-2" /></label><Button type="button" size="sm" disabled={disabled || busy || !condition.trim()} onClick={() => defer({ kind: 'when', condition: condition.trim() })}>条件を記録</Button></div><p className="text-[11px] text-muted-foreground">条件の自動検知が接続されていない場合は、通知せず一覧から確認できます。</p></div>}
  </article>;
}
