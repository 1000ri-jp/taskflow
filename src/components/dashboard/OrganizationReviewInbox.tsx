'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, Clock3, RefreshCw, Sparkles } from 'lucide-react';
import { useAISettings } from '@/hooks/useAISettings';
import { useOrganizationRecords } from '@/hooks/useOrganizationRecords';
import { OrganizationProposalCard } from './OrganizationProposalCard';
import { TaskOrganizer } from '@/components/task/TaskOrganizer';
import { Button } from '@/components/ui/button';
import { Card, CardDescription } from '@/components/ui/card';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { requestOrganization } from '@/lib/task/organizationClient';
import { type OrganizationContext, type OrganizationPreview } from '@/lib/task/organizationTypes';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { organizationAttention, orderReviewItems, reviewPosition } from '@/lib/dashboard/review-queue';

interface Props { userId: string | null; projects: { id: string; name: string; isArchived?: boolean }[]; tasks: DashboardTask[]; disabled?: boolean }
const recordKey = (record: OrganizationPreview) => JSON.stringify([record.projectId, record.id]);
const statusLabels = { pending: '未反映', held: '今は決めない', applied: '反映済み', skipped: '見送り', undone: '反映を取消済み' };
export function OrganizationReviewInbox(props: Props) {
  return isE2EMockAuthEnabled() ? <ReviewInbox {...props} /> : <ConnectedReviewInbox {...props} />;
}
function ConnectedReviewInbox(props: Props) {
  const { allowedProjectIds, projectAccessLoaded, projectAccessError, refreshProjectAccess } = useAISettings();
  return <ReviewInbox {...props} projects={props.projects.filter(project => !project.isArchived && (allowedProjectIds === null || allowedProjectIds.includes(project.id)))} disabled={props.disabled || !projectAccessLoaded || !!projectAccessError} accessError={!!projectAccessError} onRetryAccess={refreshProjectAccess} />;
}
function ReviewInbox({ userId, projects, tasks, disabled = false, accessError = false, onRetryAccess }: Props & { accessError?: boolean; onRetryAccess?: () => Promise<void> }) {
  const { records, failed, loading, refresh } = useOrganizationRecords(userId, projects.map(project => project.id), !disabled);
  const [selected, setSelected] = useState<OrganizationPreview | null>(null);
  const [results, setResults] = useState<Record<string, OrganizationPreview>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = useMemo(() => new Set(projects.map(project => project.id)), [projects]);
  const visible = useMemo(() => records.filter(record => allowed.has(record.projectId)).map(record => {
    const result = results[recordKey(record)];
    return result?.createdAt === record.createdAt ? result : record;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [allowed, records, results]);
  const pending = useMemo(() => visible.filter(record => record.status === 'pending' && record.aiSuggested === true), [visible]);
  const history = useMemo(() => visible.filter(record => record.status !== 'pending' || record.aiSuggested !== true), [visible]);
  const orderedPending = useMemo(() => orderReviewItems(pending, `organization:${userId ?? 'anonymous'}`, recordKey, record => organizationAttention(record)), [pending, userId]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const selectedPosition = reviewPosition(orderedPending, selectedKey, recordKey);
  const selectedPending = orderedPending[selectedPosition] ?? null;
  const displayedPending = showAll ? orderedPending : selectedPending ? [selectedPending] : [];
  const scope = JSON.stringify([userId, disabled ? [] : [...new Set(pending.map(record => record.projectId))].sort()]);
  const [contextState, setContextState] = useState<{ scope: string; values: Record<string, OrganizationContext> } | null>(null);
  useEffect(() => {
    const [, ids] = JSON.parse(scope) as [string | null, string[]];
    let active = true;
    void Promise.allSettled(ids.map(projectId => requestOrganization<OrganizationContext>({ action: 'context', projectId }))).then(values => {
      if (active) setContextState({ scope, values: Object.fromEntries(values.flatMap((value, index) => value.status === 'fulfilled' ? [[ids[index], value.value]] : [])) });
    });
    return () => { active = false; };
  }, [scope]);
  const contexts = contextState?.scope === scope ? contextState.values : {};
  // Keep editing stable during refresh, but never retain access after a scope change.
  const current = !disabled && selected && allowed.has(selected.projectId) ? selected : null;
  const moveSelection = (offset: number) => {
    if (!orderedPending.length) return;
    const next = (selectedPosition + offset + orderedPending.length) % orderedPending.length;
    setSelectedKey(recordKey(orderedPending[next]));
    setShowAll(false);
  };
  const act = async (record: OrganizationPreview, action: 'apply' | 'hold' | 'skip' | 'defer', followUp?: unknown) => {
    if (submitting.current || disabled || !allowed.has(record.projectId) || action === 'apply' && (!contexts[record.projectId] || record.canApply !== true)) return;
    submitting.current = true;
    const key = recordKey(record);
    setBusy(key); setNotice(''); setErrors(previous => ({ ...previous, [key]: '' }));
    try {
      const result = await requestOrganization<OrganizationPreview>({ action, projectId: record.projectId, id: record.id, ...(followUp ? { followUp } : {}) });
      if (!mounted.current) return;
      setResults(previous => ({ ...previous, [key]: { ...record, ...result } }));
      setNotice(`「${record.changes[0]?.title ?? record.sourceTitle}」${action === 'apply' ? 'に反映しました。' : action === 'hold' ? 'は一覧に残しました。' : action === 'defer' ? 'の再表示条件を記録しました。' : 'の提案を見送りました。'}`);
      const next = orderedPending.find((candidate, index) => index > selectedPosition && candidate.id !== record.id) ?? orderedPending.find(candidate => candidate.id !== record.id);
      setSelectedKey(next ? recordKey(next) : null);
      refresh();
    } catch (error) {
      if (mounted.current) setErrors(previous => ({ ...previous, [key]: error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。' }));
    } finally { submitting.current = false; if (mounted.current) setBusy(null); }
  };
  return <section aria-label="モアイの提案" className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div><h1 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" aria-hidden="true" />モアイの提案</h1></div>
      <TaskOrganizer projects={projects} tasks={tasks} disabled={disabled || !!busy || !userId || projects.length === 0} label="メモから提案を作る" />
    </header>
    <div className="space-y-4 p-5">
      {notice && <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{notice}</p>}
      {orderedPending.length > 0 && <div className="flex flex-wrap items-center border" aria-label="提案案件の移動">
        <span className="tabular-nums">{selectedPosition + 1} / {orderedPending.length}{failed ? '件以上' : '件'}</span>
        <span>{organizationAttention(selectedPending ?? orderedPending[0]).label}</span>
        <span className="min-w-0 break-words">{organizationAttention(selectedPending ?? orderedPending[0]).reason}</span>
        <div className="ml-auto flex flex-wrap">
          <Button type="button" variant="ghost" size="sm" onClick={() => moveSelection(-1)} aria-label="前へ"><ChevronLeft className="size-3.5" />前へ</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => moveSelection(1)} aria-label="次の件"><ChevronRight className="size-3.5" />次の件</Button>
          <Button type="button" variant="outline" size="sm" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? '提案を一件ずつ見る' : 'ほかの件を見る（一覧）'}</Button>
        </div>
      </div>}
      {(failed || accessError) && <p role="alert" className="text-sm text-amber-800">{accessError ? 'AIの参照範囲を取得できません。' : '一部の提案を取得できません。取得できた分を表示しています。'}<Button variant="ghost" size="sm" onClick={() => { if (accessError && onRetryAccess) void onRetryAccess(); else refresh(); }} aria-label="提案を再取得"><RefreshCw className="mr-1 size-3.5" />再取得</Button></p>}
      {(loading || disabled) && !accessError ? <p role="status" className="py-6 text-sm text-muted-foreground">提案を読み込み中…</p> : pending.length === 0 && !failed && !accessError ? <div role="status" className="py-8 text-center"><Sparkles className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" /><p className="text-sm font-medium">いま判断が必要な提案はありません。</p></div> : null}
      {displayedPending.map(record => {
        const key = recordKey(record); const context = contexts[record.projectId];
        const relevantTasks = tasks.filter(task => task.projectId === record.projectId);
        const locations = [...new Set(record.changes.map(change => relevantTasks.find(task => task.id === change.taskId)?.listName).filter(Boolean))];
        return <div key={key}>{record.reappearedReason && <p role="status" className="flex items-start"><Clock3 className="size-4 shrink-0" />{record.reappearedReason}</p>}<OrganizationProposalCard record={record} projectName={projects.find(project => project.id === record.projectId)?.name}
          locations={locations as string[]} tasks={relevantTasks} context={context} contextSettled={contextState?.scope === scope}
          disabled={disabled || !!busy && busy !== key} busy={busy === key} error={errors[key]}
          attention={organizationAttention(record)} onApply={() => void act(record, 'apply')} onHold={() => void act(record, 'hold')} onSkip={() => void act(record, 'skip')} onDefer={followUp => void act(record, 'defer', followUp)} onAdjust={() => setSelected(record)} /></div>;
      })}
      {history.length > 0 && <section aria-label="これまでの判断・記録" className="border-t pt-4">
        <details>
          <summary className="cursor-pointer"><small><strong>これまでの判断・記録（{history.length}件）</strong></small></summary>
          <ul className="mt-3 space-y-3">
            {history.map(item => <li key={recordKey(item)}>
              <Card density="compact">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong>{statusLabels[item.status]}</strong><CardDescription>{projects.find(project => project.id === item.projectId)?.name}</CardDescription><button type="button" disabled={!!busy || disabled} className="break-words text-left hover:underline" onClick={() => setSelected(item)}>{item.changes[0]?.title ?? item.sourceTitle}</button></div>
                {item.status === 'applied'
                  ? <CardDescription><strong>🗿 モアイのコメント：</strong>{item.changes.map(change => change.summary).join('・')}</CardDescription>
                  : <CardDescription>{item.changes.map(change => change.summary).join('・')}</CardDescription>}
                <CardDescription>資料：{item.sourceTitle}</CardDescription>
                {item.followUp?.kind === 'at' && <CardDescription>{item.followUp.triggeredAt ? '指定した日時になりました' : `指定日時：${new Date(item.followUp.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`}</CardDescription>}
                {item.followUp?.kind === 'when' && <CardDescription>条件を記録：{item.followUp.condition}（自動検知なし）</CardDescription>}
                {item.status === 'applied' && <CardDescription>{[...new Map(item.changes.map(change => [change.taskId, change])).values()].map((change, index) => <span key={change.taskId}>{index > 0 && <span aria-hidden="true"> ・ </span>}<Link prefetch={false} className="text-primary underline" href={`/projects/${encodeURIComponent(item.projectId)}/board?task=${encodeURIComponent(change.taskId)}`}>反映した仕事を開く{item.changes.length > 1 ? `：${change.title}` : ''}</Link></span>)}</CardDescription>}
              </Card>
            </li>)}
          </ul>
        </details>
      </section>}
    </div>
    {current && <TaskOrganizer key={JSON.stringify([userId, current.projectId, current.id])} projectId={current.projectId} projectName={projects.find(project => project.id === current.projectId)?.name} tasks={tasks.filter(task => task.projectId === current.projectId)} initialRecord={current} open onOpenChange={open => { if (!open) { setSelected(null); setResults({}); refresh(); } }} disabled={disabled} />}
  </section>;
}
