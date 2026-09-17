'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { GoogleWorkspaceSummary } from '@/components/google/GoogleWorkspacePanel';
import { Bot, CheckCircle2, CircleHelp, ChevronRight, Clock3, ExternalLink, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSecretary } from '@/hooks/useSecretary';
import { blockers, buildSecretaryBoard, jstDay, hasCurrentEvidence } from '@/lib/secretary/engine';
import { isActionableProposal, proposalReadinessReason, proposalPresentation, proposalRefreshReason, proposalCardQuestion, proposalAttentionReason } from '@/lib/secretary/presentation';
import type { ActionRequest, Proposal, SecretaryTask, SecretaryView } from '@/lib/secretary/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SecretaryReschedule } from './SecretaryReschedule';
import { SecretaryRefreshSettings } from './SecretaryRefreshSettings';
import { IncomingCandidates, incomingCandidatesStatus } from './IncomingCandidates';
import { requestDescription, showScopedConversation } from '@/lib/ai/scopedConversationClient';
import { ProjectMark } from '@/components/project/ProjectMark';
import { availableWork, remainingWork, currentDecision } from '@/lib/secretary/now';
import { TaskAssignees, type TaskViewMember } from '@/components/board/TaskViewFields';
import { ControlHint } from '@/components/ui/control-hint';
import type { Project } from '@/types';

type DisplayProject = Pick<Project, 'id' | 'name' | 'icon' | 'iconUrl' | 'color'>;
type People = { members?: readonly TaskViewMember[] };
type Requesters = Readonly<Record<string, { name: string | null; isSelf: boolean }>>;
const date = (v: string) => new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const reviewDate = (v: string) => new Date(v).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
function TaskProjectMark({ task, projects, size }: { task: SecretaryTask; projects: readonly DisplayProject[]; size?: 'small' | 'large' }) {
  const project = projects.find(project => project.id === task.projectId);
  return <ProjectMark name={project?.name || task.projectName} icon={project?.icon} iconUrl={project?.iconUrl} color={project?.color} size={size} />;
}
function TaskLink({ task, mock }: { task: SecretaryTask; mock: boolean }) {
  return mock ? <button className="text-left underline-offset-4 hover:underline" onClick={openMockTask}>{task.title}</button> : <Link className="underline-offset-4 hover:underline" href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.taskId)}`}>{task.title}</Link>;
}
function openMockTask() {
  const details = document.getElementById('mock-task-details') as HTMLDetailsElement | null;
  if (details) { details.open = true; const parent = details.parentElement?.closest('details'); if (parent) parent.open = true; details.scrollIntoView({ block: 'nearest' }); }
}
function OpenTask({ task, mock, showLabel = false }: { task: SecretaryTask; mock: boolean; showLabel?: boolean }) {
  const label = task.context?.taskKind === 'review_request' ? '確認依頼を開く' : 'タスクを開く';
  const content = <><ExternalLink className="h-4 w-4" aria-hidden="true" />{showLabel && label}</>;
  const size = showLabel ? 'sm' : 'icon';
  const className = showLabel ? '' : 'h-8 w-8';
  if (mock) return <ControlHint label={label}><Button size={size} variant="outline" className={className} aria-label={label} onClick={openMockTask}>{content}</Button></ControlHint>;
  return <ControlHint label={label}><Button size={size} variant="outline" className={className} asChild><Link aria-label={label} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.taskId)}`}>{content}</Link></Button></ControlHint>;
}
function GoalContext({ task, mock }: { task: SecretaryTask; mock: boolean }) {
  const context = task.context;
  if (!context) return null;
  return <div className="space-y-2">
    {context.projectDescription && <p>目的：{context.projectDescription}</p>}
    {context.parent && <p>親の仕事：{context.parent.title} — {context.parent.description}</p>}
    {context.milestone && <p>節目：{context.milestone.title} — {context.milestone.description}{context.milestone.dueDate && `（${date(context.milestone.dueDate)}）`}</p>}
    {context.sourceComment && !mock && <Link className="inline-block underline" href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(context.sourceComment.taskId)}&comment=${encodeURIComponent(context.sourceComment.commentId)}`}>元の確認依頼を開く</Link>}
  </div>;
}
function ProposalCard({ p, view, disabled, act, projects, onReview, reviewDisabled, requesterByTask }: { p: Proposal; view: SecretaryView; disabled: boolean; act: (r: ActionRequest) => void | Promise<boolean>; projects?: readonly DisplayProject[]; onReview: () => void; reviewDisabled: boolean; requesterByTask?: Requesters }) {
  const [correction, setCorrection] = useState('');
  const [shared, setShared] = useState<'complete' | 'cancel' | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const task = view.snapshot.tasks.find(t => t.key === p.key)!;
  const stale = !hasCurrentEvidence(p, view.snapshot);
  const refreshReason = proposalRefreshReason(p, view.snapshot);
  const reasons = blockers(task, view.snapshot, view.snapshot.checkedAt);
  const presentation = proposalPresentation(p, task, view.snapshot);
  const isReview = task.context?.taskKind === 'review_request';
  const requester = requesterByTask?.[task.key];
  const readinessReason = proposalReadinessReason(p, view.snapshot);
  const detail = p.decision ? p.decision.whyNow : isReview ? `${requester?.isSelf ? '自分で登録した確認依頼です。' : requester?.name ? `${requester.name}さんから確認依頼が来ています。` : '確認依頼が来ています。'}対応は終わっていますか？` : readinessReason ?? proposalCardQuestion(p, task, view.snapshot);
  const badge = stale ? '要再整理' : isReview ? '要確認' : ({ '状況確認が必要': '要状況確認', '着手できる': '着手可', '情報不足・未判断': '情報不足', '今やるか未判断': '未判断', '前提の確認が必要': '前提確認', '今は着手できない': '着手待ち', '条件待ち': '条件待ち', '保留の提案': '保留', '完了の提案': '完了候補', '不要の提案': '不要候補' }[presentation.label] ?? presentation.label);
  const BadgeIcon = stale ? RefreshCw : isReview || presentation.inspect ? CircleHelp : p.disposition === 'execute' ? CheckCircle2 : Clock3;
  const dueDay = task.dueDate && Number.isFinite(Date.parse(task.dueDate)) ? jstDay(task.dueDate) : null;
  const today = jstDay(view.snapshot.checkedAt);
  const attention = proposalAttentionReason(p, view.snapshot);
  const send = (action: ActionRequest['action']) => act({ action, proposalId: p.id, revision: view.state.revision, ...(action === 'correct' ? { correction } : {}) });
  return <article className="rounded-xl border border-stone-200 bg-white p-3" aria-label={`提案: ${task.title}`}>
    {projects === undefined && <p className="mb-2 text-xs text-stone-500">{task.projectName}</p>}
    <div className="flex flex-wrap items-start gap-2.5" data-testid="secretary-proposal-heading">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {projects !== undefined && <TaskProjectMark task={task} projects={projects} size="large" />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="min-w-0 break-words text-sm font-medium text-stone-900"><TaskLink task={task} mock={view.mode === 'mock'} /></h4>
        {dueDay && <time dateTime={dueDay} className={`shrink-0 whitespace-nowrap text-xs ${dueDay <= today ? 'text-rose-700' : 'text-stone-500'}`}>期限 {Number(dueDay.slice(5, 7))}/{Number(dueDay.slice(8))}{dueDay < today ? '・超過' : dueDay === today ? '・今日' : ''}</time>}
        {attention?.kind === 'urgent' && <span className="text-xs text-rose-700">{attention.label}</span>}
      <span className="inline-flex shrink-0 items-center gap-1.5">
      <span title={stale ? refreshReason?.detail || '現在の情報で再整理してください' : isReview ? '自分が担当する確認依頼' : presentation.label} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${presentation.inspect || stale || isReview ? 'border-amber-300 bg-amber-100 text-amber-950' : p.disposition === 'execute' ? 'border-emerald-300 bg-emerald-100 text-emerald-950' : 'border-stone-300 bg-stone-100 text-stone-800'}`}><BadgeIcon className="size-3.5" aria-hidden="true" />{badge}</span>
      {stale && refreshReason && <span role="status" title={refreshReason.detail} className="inline-flex shrink-0 items-center rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-600">{refreshReason.label}</span>}
      </span>
      </div>
      </div>
      {!stale && <div className="ml-auto flex shrink-0 items-center gap-1" data-testid="secretary-status-actions">
        <SecretaryReschedule title={task.title} dueDate={task.dueDate} startDate={task.startDate} disabled={disabled || !task.canWrite} onSave={dueDate => act({ action: 'reschedule', dueDate, proposalId: p.id, revision: view.state.revision })} />
        <ControlHint label="不要" description="自分の候補から外します。共有タスクの削除はタスク画面で行えます。"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label={`不要: ${task.title}`} disabled={disabled} onClick={() => send('unneeded')}>不要</Button></ControlHint>
      </div>}
      {stale && <ControlHint label="再整理" description="最新情報でAIの提案を見直します。"><Button size="icon" variant="ghost" className="ml-auto size-7 shrink-0" aria-label="再整理" disabled={reviewDisabled} onClick={onReview}><RefreshCw className="size-3.5" aria-hidden="true" /></Button></ControlHint>}
    </div>
    {!stale && !isReview && !presentation.inspect && p.disposition !== 'execute' && <div className="mt-2 flex justify-end">
      <Button size="sm" disabled={disabled} onClick={() => send('accept')}>{p.disposition === 'wait' || p.disposition === 'hold' ? 'この条件で預ける' : 'この判断を採用'}</Button>
    </div>}
    {detail && <p aria-label={readinessReason ? '着手可の理由' : undefined} className="mt-2 break-words text-sm leading-relaxed text-stone-600">{detail}</p>}
    {p.decision && <div className="mt-2 space-y-1 text-sm"><p className="font-medium">{p.decision.question}</p><p className="text-xs text-muted-foreground">{p.decision.consequence}</p><OpenTask task={task} mock={view.mode === 'mock'} showLabel /></div>}
    {!stale && !presentation.inspect && ['wait', 'hold'].includes(p.disposition) && <div className="mt-1 text-xs text-stone-500">{p.trigger && <p>見直す条件：{p.trigger}</p>}{p.reviewAt && <p>再確認 {reviewDate(p.reviewAt)}</p>}</div>}
    <details className="mt-3 text-xs text-stone-600"><summary className="cursor-pointer">根拠・訂正・共有への反映</summary>
      <div className="mt-3 space-y-3">
        {stale && refreshReason && <p>{refreshReason.detail}</p>}
        {!isReview && !presentation.inspect && p.disposition === 'execute' && <Button size="sm" variant="outline" disabled={disabled || stale} onClick={() => send('accept')}>今日の一歩に追加</Button>}
        <p className="whitespace-pre-wrap break-words leading-relaxed">{p.reason}</p>
        {p.trigger && <p>再検討のきっかけ：{p.trigger}</p>}
        {p.reviewAt && <p>何も変わらなければ {reviewDate(p.reviewAt)} に再確認</p>}
        {reasons.length > 0 && <p className="text-amber-800">{reasons.join(' ／ ')}</p>}
        {p.uncertainties.length > 0 && <p className="text-amber-800">判断材料：{p.uncertainties.join(' ／ ')}</p>}
        <GoalContext task={task} mock={view.mode === 'mock'} />
        <p>確認 {date(p.createdAt)} ／ {p.commitment === 'confirmed' ? '引受の根拠あり' : 'まだ引受は未確定'}</p>
        {p.evidence.map((e, i) => <blockquote key={i} className="border-l-2 border-stone-200 pl-3 break-words">「{e.quote}」{e.source === 'task' ? ' — タスク本文' : view.mode === 'mock' ? ' — 架空コメント' : <Link className="ml-2 underline" href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.taskId)}&comment=${encodeURIComponent(e.source)}`}>コメントを開く</Link>}</blockquote>)}
        {p.duplicateOf && <p>重複・代替の照合先：{view.snapshot.tasks.find(t => t.key === p.duplicateOf)?.title ?? '現在取得できません'}</p>}
        <p className="text-stone-500">整理の結果は自分だけに保存されます。</p>
        <label className="block">返答・訂正（自分用）<input aria-label={`訂正: ${task.title}`} value={correction} onChange={e => setCorrection(e.target.value)} maxLength={800} className="mt-1 block w-full rounded-md border bg-white p-2 text-sm" placeholder="例：相手の返事ではなく、素材を待っている" /></label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={disabled || stale || !correction.trim()} onClick={() => send('correct')}>返答・訂正を保存</Button>
          <Button size="sm" variant="ghost" disabled={disabled || stale} onClick={() => send('correct')}>この提案を却下</Button>
          {task.canWrite && <Button size="sm" variant="outline" disabled={disabled || opening} onClick={async () => {
            setOpening(true); setOpenError(null);
            try { const conversation = await requestDescription(view.snapshot.userId, { action: 'open', conversationId: crypto.randomUUID(), projectId: task.projectId, taskId: task.taskId }); showScopedConversation(view.snapshot.userId, conversation.conversationId, 'description'); }
            catch (error) { setOpenError(error instanceof Error ? error.message : '会話を開けませんでした。'); }
            finally { setOpening(false); }
          }}><Bot className="size-4" aria-hidden="true" />説明をAIで編集</Button>}
        </div>
        {openError && <p role="alert" className="text-sm text-rose-700">{openError}</p>}
        {task.canWrite && !presentation.inspect && ['complete', 'unneeded'].includes(p.disposition) && p.commitment === 'confirmed' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          {!shared ? <Button size="sm" variant="outline" disabled={disabled || stale} onClick={() => setShared(p.disposition === 'complete' ? 'complete' : 'cancel')}>共有タスクの{p.disposition === 'complete' ? '完了' : '中止'}も反映…</Button>
            : <><p className="mb-2">「{task.title}」をチーム全員に対して{shared === 'complete' ? '完了' : '中止'}にします。採用後は履歴から戻せます。</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled || stale} onClick={() => send(shared)}>共有の{shared === 'complete' ? '完了' : '中止'}を反映</Button><Button size="sm" variant="ghost" onClick={() => setShared(null)}>戻る</Button></div></>}
        </div>}
      </div>
    </details>
  </article>;
}

function WaitingSection({ compact, count, children }: { compact: boolean; count: number; children: ReactNode }) {
  const heading = <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700"><Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />待ち・保留 <span className="font-normal">{count}件</span></span>;
  return <section aria-label="待ち・保留" className="tf-secretary">{compact ? <details className="group/waiting rounded-2xl border bg-white p-4 shadow-sm"><summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"><ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open/waiting:rotate-90 motion-reduce:transition-none" aria-hidden="true" />{heading}</summary><div className="mt-3"><p className="mb-3 text-xs leading-relaxed text-stone-500">返事・素材の到着待ちや、あとで見直すと決めたタスクです。</p>{children}</div></details> : <><h3 className="mb-2">{heading}</h3>{children}</>}</section>;
}

function ReadySection({ count, children }: { count: number; children: ReactNode }) {
  return <section aria-label="着手可" className="tf-secretary">
    <details className="group/ready rounded-2xl border bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open/ready:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />着手可 <span className="font-normal">{count}件</span></span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  </section>;
}

function AvailableTaskCard({ task, view, projects, members = [], act, disabled }: { task: SecretaryTask; view: SecretaryView; projects?: readonly DisplayProject[]; act: (r: ActionRequest) => Promise<boolean>; disabled: boolean } & People) {
  const directAction = (action: 'reschedule' | 'unneeded', dueDate?: string) => act({ action, ...(dueDate ? { dueDate } : {}), proposalId: crypto.randomUUID(), taskKey: task.key, sourceVersion: task.version, revision: view.state.revision });
  const remaining = remainingWork(task, view.snapshot);
  const names = Object.fromEntries(members.map(member => [member.id, member.displayName]));
  const icons = Object.fromEntries(members.map(member => [member.id, member]));
  return <article className="rounded-xl border bg-white p-3" aria-label={`仕事: ${task.title}`}>
    <div className="flex flex-wrap items-center gap-2" data-testid="secretary-proposal-heading">
      {projects && <TaskProjectMark task={task} projects={projects} size="large" />}
      <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-medium"><TaskLink task={task} mock={view.mode === 'mock'} /></h4>
        {task.dueDate && <p className="mt-1 text-xs text-muted-foreground">期限 {reviewDate(task.dueDate)}</p>}
      </div>
      <TaskAssignees task={task} names={names} members={icons} compact maxVisible={3} />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SecretaryReschedule title={task.title} dueDate={task.dueDate} startDate={task.startDate} disabled={disabled || !task.canWrite} onSave={dueDate => directAction('reschedule', dueDate)} />
        <ControlHint label="不要" description="自分の候補から外します。共有タスクは残ります。"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label={`不要: ${task.title}`} disabled={disabled} onClick={() => void directAction('unneeded')}>不要</Button></ControlHint>
      </div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{task.context?.workProgress === 'started' ? '着手中' : '開始日・前工程・登録された待ち条件による制限はありません。'}</p>
    {remaining.checks.length > 0 && <div className="mt-2 text-sm"><p className="text-xs text-muted-foreground">残るチェック {remaining.checks.length}件</p><ul className="mt-1 space-y-1">{remaining.checks.slice(0, 3).map(item => <li key={`${item.listId}/${item.id}`} className="break-words">□ {item.text}</li>)}</ul>{remaining.checks.length > 3 && <p className="text-xs text-muted-foreground">ほか{remaining.checks.length - 3}件</p>}</div>}
    {remaining.children.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer">残る子作業 {remaining.children.length}件</summary><ul className="mt-2 space-y-2">{remaining.children.map(child => <li key={child.key}><TaskLink task={child} mock={view.mode === 'mock'} /></li>)}</ul></details>}
  </article>;
}

function SecretaryForUser({ userId, compact, projects, extraActionTarget, waitingTarget, requesterByTask, members }: People & { userId: string; compact: boolean; projects?: readonly DisplayProject[]; extraActionTarget?: HTMLElement | null; waitingTarget?: HTMLElement | null; requesterByTask?: Requesters }) {
  const secretary = useSecretary(userId);
  const { view, error, busy } = secretary;
  const [minutes, setMinutes] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const available = minutes ? Number(minutes) : null;
  const board = view && buildSecretaryBoard(view.state, view.snapshot, view.snapshot.checkedAt, available);
  const actionable = view && board ? board.decisions.filter(p => isActionableProposal(p, view.snapshot)) : [];
  const extraCandidates = actionable.filter(p => available === null || p.estimateMinutes === null || p.estimateMinutes <= available);
  const ready = view ? availableWork(view.state, view.snapshot) : [];
  const decisions = view && board ? board.decisions.filter(p => currentDecision(p, view.snapshot)) : [];
  const priorityCandidates = decisions;
  const waiting = board?.waiting.filter(d => d.disposition !== 'unneeded') ?? [];
  const partial = view?.snapshot.coverage.status === 'partial';
  const disabled = busy || !!error || !!partial;
  const showNoAcceptedCandidate = !!view && !!board && !board.first && !error && !partial && !!view.state.reviewedAt && view.snapshot.coverage.status !== 'empty';
  const taskFor = (key: string) => view!.snapshot.tasks.find(t => t.key === key)!;
  const canUndo = view?.state.history.filter(h => {
    const task = view.snapshot.tasks.find(t => t.key === h.key);
    return task && !h.undone && (h.action === 'reschedule' || view.state.proposals.some(p => p.id === h.proposalId))
      && view.state.decisions.find(d => d.key === h.key)?.nonce === h.afterNonce
      && (!h.afterTask || task.canWrite && task.version === h.afterVersion);
  }) ?? [];
  const waitingContent = view && board && <WaitingSection compact={compact} count={waiting.length}>
              {waiting.length === 0 ? <p className="text-sm text-stone-500">{view.state.reviewedAt ? '待ち・保留にしたタスクはありません。' : '待ち・保留にしたタスクをここに表示します。'}</p> : <div className="space-y-2">{waiting.slice(0, 3).map(d => <div key={d.key} className="rounded-lg border border-stone-200 bg-white p-3 text-sm"><p className="font-medium"><TaskLink task={taskFor(d.key)} mock={view.mode === 'mock'} /></p><p className="mt-1 text-xs text-stone-600">{d.correction ?? d.reason}</p><p className="mt-1 text-xs text-stone-500">{d.trigger || '関連情報が変わったら再検討'}{d.reviewAt && ` ／ ${reviewDate(d.reviewAt)} に再確認`}</p>{d.sourceVersion !== taskFor(d.key).version && <p className="mt-1 text-xs text-orange-800">再確認が必要です。条件が変わっても、自動で実行には戻しません。</p>}</div>)}{waiting.length > 3 && <details className="text-xs"><summary className="cursor-pointer">ほか{waiting.length - 3}件の保留</summary>{waiting.slice(3).map(d => <p key={d.key} className="mt-2">{taskFor(d.key).title} — {d.reason}{d.reviewAt ? ` ／ ${reviewDate(d.reviewAt)}` : ''}</p>)}</details>}</div>}
            </WaitingSection>;
  const personalContent = view && board && <div className="space-y-4">
    <ReadySection count={ready.length}>
      {ready.length ? ready.map(task => <AvailableTaskCard key={task.key} task={task} view={view} projects={projects} members={members} act={secretary.act} disabled={disabled} />)
        : <p className="text-sm text-stone-500">登録された条件に合う仕事はありません。一覧からも確認できます。</p>}
    </ReadySection>
    {waitingContent}
  </div>;
  const extraContent = view && board && <div className="space-y-3">
    {board.first && !error && !partial ? <><p className="text-sm text-stone-500">{projects !== undefined ? <TaskProjectMark task={taskFor(board.first.key)} projects={projects} /> : taskFor(board.first.key).projectName}</p><h3 className="text-base font-medium leading-relaxed"><TaskLink task={taskFor(board.first.key)} mock={view.mode === 'mock'} /></h3><p className="text-sm text-stone-600">{board.first.reason}</p><OpenTask task={taskFor(board.first.key)} mock={view.mode === 'mock'} /><p className="text-xs text-stone-500">所要時間 {board.first.estimateMinutes === null ? '未確認' : `約${board.first.estimateMinutes}分（AIの目安）`}</p></>
      : <p className="text-sm leading-relaxed text-stone-600">{showNoAcceptedCandidate ? extraCandidates.length ? '今日の一歩を候補から選べます。' : '今の条件で選べる候補はありません。' : error || partial ? '最新の情報を取得できません。タスク一覧から仕事を確認できます。' : !view.state.reviewedAt ? '「AIで整理」でタスクとコメントを照合し、採用した候補から選びます。' : '取得できた範囲に、未完了の自分の担当タスクはありません。'}</p>}
    {!error && !partial && extraCandidates.length > 0 && <details open={!board.first} className="text-xs text-stone-500"><summary className="cursor-pointer">候補を選ぶ</summary>
      <div className="mt-2 space-y-2">{extraCandidates.map(p => <article key={p.id} aria-label={`今日の一歩候補: ${taskFor(p.key).title}`} className="rounded-lg border bg-white p-3">
        <h4 className="break-words text-sm font-medium text-stone-800"><TaskLink task={taskFor(p.key)} mock={view.mode === 'mock'} /></h4>
        <p className="mt-1 break-words leading-relaxed">{p.reason}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span>{p.estimateMinutes === null ? '所要時間は未確認' : `約${p.estimateMinutes}分（AIの目安）`}</span><Button size="sm" disabled={disabled} onClick={() => secretary.act({ action: 'accept', proposalId: p.id, revision: view.state.revision })}>今日の一歩にする</Button></div>
      </article>)}</div>
    </details>}
    <details className="text-xs text-stone-500"><summary className="cursor-pointer">余裕の時間で絞る</summary><label className="mt-2 flex flex-wrap items-center gap-2">使える時間<input aria-label="使える時間" type="number" min={1} max={720} value={minutes} onChange={e => setMinutes(e.target.value === '' ? '' : String(Math.max(1, Math.min(720, Number(e.target.value)))))} placeholder="未設定" className="w-20 rounded border px-2 py-1 text-sm" />分</label>
      {board.unknownEstimates > 0 && <p className="mt-2">所要時間未確認 {board.unknownEstimates}件。時間内に収まるとはまだ判断していません。</p>}
    </details>
  </div>;
  return <>
    {waitingTarget && personalContent && createPortal(personalContent, waitingTarget)}
    {extraActionTarget && view && board && createPortal(<section aria-label="余裕があるとき">
      <Popover open={showExtra} onOpenChange={setShowExtra}>
        <PopoverTrigger asChild><Button size="sm" variant="outline" disabled={busy || !view || !!error || !!partial} aria-expanded={showExtra}>今日の一歩</Button></PopoverTrigger>
        <PopoverContent align="end" aria-label="余裕があるとき" className="tf-secretary max-h-[min(70dvh,600px)] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-xl">{extraContent}</PopoverContent>
      </Popover>
    </section>, extraActionTarget)}
    <section aria-label="Neo AI秘書" className="tf-secretary overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
      <div><h2 className="flex items-center gap-2 font-semibold text-stone-900"><Sparkles className="h-4 w-4 text-orange-700" />AI秘書</h2></div>
      <div className="flex flex-wrap items-center gap-2"><Button size="icon" variant="ghost" aria-label="情報を更新" title="最新情報を再取得（自動再整理が有効ならAIも見直します）" disabled={busy} onClick={secretary.refresh}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button><Button size="sm" disabled={busy || !!partial || !view} title="最新のタスク・コメントをAIで照合します" onClick={secretary.review}>{busy ? '確認中…' : 'AIで整理'}</Button></div>
    </div>
    <div className="space-y-4 p-4">
      {view?.mode === 'mock' && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">ローカル検証用・架空データ。AIの意味解釈は検証用の応答です。操作はこのブラウザだけに保存し、本番には送信しません。</p>}
      {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error} 自動再整理は停止しました。<Button size="sm" variant="ghost" disabled={busy} onClick={secretary.refresh}>再取得</Button>{secretary.failedIncoming && <Button size="sm" variant="ghost" disabled={busy} onClick={secretary.retryIncoming}>同じ操作を再試行</Button>}<p className="mt-1"><Link href="/my-dashboard" className="underline">タスク・予定の一覧を開く</Link></p></div>}
      {!view && !error && <p role="status" className="text-sm text-stone-500">タスク・コメント・保存した判断を読み込んでいます。</p>}
      {partial && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">一部の情報を取得できていません。「待ち・保留」と確定せず、採用を止めています。</p>}
      {view && board && <>
        {view.snapshot.coverage.excludedProjects > 0 && <p className="text-sm text-amber-900">AI対象外の{view.snapshot.coverage.excludedProjects}プロジェクトは期限・仕事量とも未確認です。<Link href="/my-dashboard" className="underline">一覧を開く</Link></p>}
        {!compact && board.due.length > 0 && <details className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900"><summary className="cursor-pointer">今日までの期限 {board.due.length}件{board.due.some(t => t.isDueDateFixed) ? '・固定期限を含む' : ''} — 保留中も確認できます</summary><ul className="mt-2 space-y-1">{board.due.map(t => <li key={t.key}><TaskLink task={t} mock={view.mode === 'mock'} />（{date(t.dueDate!)}）{blockers(t, view.snapshot, view.snapshot.checkedAt).length > 0 && '・着手条件あり'}</li>)}</ul></details>}
        <div className={compact ? 'space-y-5' : 'grid gap-4 lg:grid-cols-[1.1fr_1fr]'}>
          {(waitingTarget === undefined || extraActionTarget === undefined) && <div className="space-y-4">
            {waitingTarget === undefined && personalContent}
            {extraActionTarget === undefined && <section className="rounded-xl border border-stone-200 bg-white p-4" aria-label="余裕があるとき">
              <Button size="sm" variant="outline" disabled={busy || !view || !!error || !!partial} aria-expanded={showExtra} onClick={() => setShowExtra(value => !value)}>今日の一歩</Button>
              {showExtra && <div className="mt-3">{extraContent}</div>}
            </section>}
          </div>}
          <div className="space-y-5">
            <section aria-label="いま必要な判断"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-stone-700">いま必要な判断 <span className="font-normal">{priorityCandidates.length}件</span></h3>{view.needsReview && <span className="text-xs text-orange-800">最新情報で再整理できます</span>}</div>
              <p className="mb-3 text-xs leading-relaxed text-stone-500">返答や変更で次に進めるものを表示します。</p>
              <div className="space-y-3">{priorityCandidates.map(p => <ProposalCard key={p.id} p={p} view={view} disabled={disabled} act={secretary.act} projects={projects} onReview={secretary.review} reviewDisabled={busy || !!partial} requesterByTask={requesterByTask} />)}</div>
              {priorityCandidates.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-stone-500">{view.needsReview ? 'AIの提案は最新情報で整理すると表示されます。' : 'いま追加で判断することはありません。'}</p>}

            </section>

          </div>
        </div>
        <div className="space-y-2 border-t pt-3" aria-label="連携と設定">
        {view.mode !== 'mock' ? <GoogleWorkspaceSummary collapsible={compact} extraStatus={incomingCandidatesStatus(view, { includeCoverage: false })}>
          <IncomingCandidates embedded view={view} disabled={disabled} onAction={secretary.actIncoming} />
        </GoogleWorkspaceSummary> : <details className="rounded-xl border bg-white px-3 py-2 text-xs text-stone-500"><summary className="cursor-pointer">Google連携・取得状況<span className="ml-2">{incomingCandidatesStatus(view)}</span></summary><div className="mt-3"><IncomingCandidates embedded view={view} disabled={disabled} onAction={secretary.actIncoming} /></div></details>}
        <details className="text-xs text-stone-500"><summary className="cursor-pointer">AI秘書の履歴・設定</summary><div className="mt-3 space-y-3">
          <p>最終取得 {date(view.snapshot.checkedAt)} ／ タスク {view.snapshot.tasks.length}件・対象プロジェクト {view.snapshot.coverage.projects}件。AI設定・権限による除外 {view.snapshot.coverage.excludedProjects}件。対象は自分の担当タスク、照合には参加プロジェクトの既存タスクを使用します。</p>
          {view.snapshot.coverage.issues.map(issue => <p key={issue} className="text-amber-800">{issue}</p>)}
          <p>「情報を更新」は最新情報の再取得、「AIで整理」は内容を照合して提案を見直します。</p>
          <SecretaryRefreshSettings userId={userId} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={secretary.auto} onChange={e => secretary.setAuto(e.target.checked)} />この画面で情報が変わったら自動で再整理する</label>
          <p>画面が前面にある間、設定した間隔で取得します。画面に戻ったときも、その間隔を過ぎている場合だけ取得します。自動再整理は取得した情報に変更や再確認時点がある場合だけ。画面を閉じると停止します。</p>
          {canUndo.length > 0 && <div className="space-y-2"><p className="font-medium text-stone-700">変更を戻す</p>{canUndo.slice(-10).reverse().map(h => <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-2"><span>{taskFor(h.key).title} ／ {h.action === 'reschedule' ? '期限変更' : h.afterTask ? '共有状態も反映' : '自分の整理'} ／ {date(h.at)}</span><Button size="sm" variant="ghost" disabled={disabled} onClick={() => secretary.act({ action: 'undo', proposalId: h.proposalId, revision: view.state.revision })}><RotateCcw className="mr-1 h-3 w-3" />{h.action === 'reschedule' ? '期限変更を戻す' : '採用を戻す'}</Button></div>)}</div>}
        </div></details>
        </div>
        {view.mode === 'mock' && <details className="border-t pt-3 text-xs text-stone-500"><summary className="cursor-pointer">架空データを動かして検証</summary><div className="mt-3 flex flex-wrap gap-2">{([['arrival', '返信・画像到着'], ['policy', '会議で変更案'], ['finished', '完了報告'], ['failure', 'コメント取得失敗'], ['recover', '取得を回復'], ['reset', '架空データを初期化']] as const).map(([event, label]) => <Button key={event} size="sm" variant="outline" disabled={busy} onClick={() => secretary.testEvent(event)}>{label}</Button>)}</div><p className="mt-2">コメントが変わったら「AIで整理」、または自動再整理で提案を見直せます。</p><details id="mock-task-details" className="mt-3"><summary className="cursor-pointer">架空の実タスク状態</summary>{view.snapshot.tasks.map(t => <p key={t.key} className="mt-1">{t.title}：{t.isCompleted ? '完了' : t.isAbandoned ? '中止' : '未完了'} ／ コメント {t.comments.length}件</p>)}</details></details>}
      </>}
    </div>
  </section></>;
}
export function SecretaryPanel({ compact = false, projects, extraActionTarget, waitingTarget, requesterByTask, members }: People & { compact?: boolean; projects?: readonly DisplayProject[]; extraActionTarget?: HTMLElement | null; waitingTarget?: HTMLElement | null; requesterByTask?: Requesters }) {
  const userId = useAuthStore(s => s.user?.id);
  return userId ? <SecretaryForUser key={userId} userId={userId} compact={compact} projects={projects} extraActionTarget={extraActionTarget} waitingTarget={waitingTarget} requesterByTask={requesterByTask} members={members} /> : null;
}
