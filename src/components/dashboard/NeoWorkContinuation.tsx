'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TaskAssignees } from '@/components/board/TaskViewFields';
import { AISupportAdjust } from '@/components/ai/AISupportAdjust';
import { WorkSupportPreparation } from '@/components/ai/WorkSupportPreparation';
import { supportQueryKey } from '@/components/ai/AISupportSettings';
import { requestAISupport } from '@/lib/ai/support/client';
import { DEFAULT_AI_SUPPORT, presentationFor } from '@/lib/ai/support/profile';
import { workSupportContext } from '@/lib/ai/support/workContext';
import { format } from 'date-fns';
import { ArrowRight, List, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { useProject } from '@/hooks/useProjects';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { useTaskDetails } from '@/hooks/useTaskDetails';
import type { MyTask, ProjectTaskStatus } from '@/hooks/useMyTasks';
import { continuationContext, continuationTasks, uniqueMaterials } from '@/lib/task/continuation';
import { taskSituation } from '@/lib/task/history/presentation';
import { taskBlockers, TASK_STATUSES, taskStatus } from '@/lib/task/status';
import { reviewOutcome, taskVersion, workflowReceiptMessage, type WorkflowReceipt } from '@/lib/task/workflow';
import { TaskWorkflow } from '@/components/task/TaskWorkflow';
import { CommentComposer } from '@/components/task/CommentComposer';
import { TaskMaterials } from '@/components/task/TaskMaterials';
import type { Task } from '@/types';

const href = (task: Task) => '/projects/' + encodeURIComponent(task.projectId) + '/board?task=' + encodeURIComponent(task.id);
const identity = (task: Task) => JSON.stringify([task.projectId, task.id]);

export function NeoWorkContinuation({ tasks, userId, isLoading, error, projectTaskStatus, onList, initialTaskKey, preferStarted = false }: {
  tasks: readonly MyTask[]; userId: string | null; isLoading: boolean; error: Error | null;
  projectTaskStatus: ReadonlyMap<string, ProjectTaskStatus>; onList: () => void; initialTaskKey?: string | null; preferStarted?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(initialTaskKey ?? null);
  const ready = tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready');
  const candidates = userId ? continuationTasks(ready, userId) : [];
  if (preferStarted) candidates.sort((a, b) => Number(b.workProgress === 'started' && b.taskKind !== 'review_request') - Number(a.workProgress === 'started' && a.taskKind !== 'review_request'));
  const initialTask = preferStarted ? candidates.find(task => task.workProgress === 'started' && task.taskKind !== 'review_request') : candidates[0];
  const firstId = initialTask ? identity(initialTask) : null;
  useEffect(() => {
    if (selected || !firstId) return;
    let active = true;
    Promise.resolve().then(() => { if (active) setSelected(value => value ?? firstId); });
    return () => { active = false; };
  }, [selected, firstId]);
  // Preserve the current card when its operation finishes. Never jump to another job mid-reply.
  const selectedTask = selected ? ready.find(task => identity(task) === selected) : initialTask;
  const choices = selectedTask && !candidates.some(task => identity(task) === identity(selectedTask)) ? [selectedTask, ...candidates] : candidates;
  const failed = Boolean(error) || [...projectTaskStatus.values()].some(status => status.status === 'error');
  const loading = !userId || isLoading || [...projectTaskStatus.values()].some(status => status.status === 'loading');
  return <div data-testid="neo-work-continuation">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <h2 className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold"><ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />仕事の続き</h2>
      <label className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1"><span className="sr-only">続ける仕事</span><select aria-label="続ける仕事" className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={selectedTask ? identity(selectedTask) : ''} onChange={e => setSelected(e.target.value)} disabled={!choices.length}>
        {!selected && !selectedTask && choices.length > 0 && <option value="">進行中の仕事はありません。続ける仕事を選べます。</option>}
        {selected && !selectedTask && choices.length > 0 && <option value="">最新情報を取得できません。仕事を選び直してください。</option>}
        {!choices.length && <option value="">{loading ? '読み込み中…' : failed ? '取得できた仕事はありません' : '続ける仕事はありません'}</option>}
        {choices.map(task => <option key={identity(task)} value={identity(task)}>{task.projectName} / {task.title}</option>)}
      </select></label>
      <Button size="sm" variant="ghost" className="order-2 sm:order-3" onClick={onList}><List className="h-4 w-4" />一覧</Button>
    </div>
    {(loading || failed) && <p role={failed ? 'alert' : 'status'} className="px-5 py-3 text-xs text-muted-foreground">{failed ? '一部の仕事を取得できません。取得できたプロジェクトだけ表示しています。' : '仕事を読み込み中…'}</p>}
    {selectedTask && userId ? <ActiveWork key={JSON.stringify([userId, selectedTask.projectId, selectedTask.id])} task={selectedTask} tasks={ready.filter(task => task.projectId === selectedTask.projectId)} userId={userId} />
      : <p className="p-5 text-sm text-muted-foreground">{selected ? 'この仕事の最新情報を取得できません。選び直すか、一覧で確認してください。' : !loading && !failed ? 'いま続ける担当の仕事はありません。一覧からも確認できます。' : '状況を確認してから、次の操作を表示します。'}</p>}
  </div>;
}

function ActiveWork({ task, tasks, userId }: { task: MyTask; tasks: MyTask[]; userId: string }) {
  const user = useAuthStore(state => state.user);
  const scope = useProject(task.projectId);
  const members = useMeetingMembers(scope.project ? [scope.project] : [], Boolean(scope.project));
  const memberIcons = Object.fromEntries(members.users.map(member => [member.id, member]));
  const names = Object.fromEntries(members.users.map(member => [member.id, member.displayName]));
  const context = continuationContext(task, tasks, userId);
  const sourceId = context.parent?.id ?? task.id;
  const details = useTaskDetails(task.projectId, sourceId);
  const previous = context.previousReview;
  const submissionKey = previous?.id ?? '';
  const [submissionFor, setSubmissionFor] = useState<string | null>(null);
  const submitting = submissionFor === submissionKey;
  const support = useQuery({ queryKey: supportQueryKey(userId), queryFn: () => requestAISupport(userId), staleTime: 30000 });
  const [supportOnce, setSupportOnce] = useState({ display: '', instruction: '', revision: 0 });
  const profile = support.data ?? DEFAULT_AI_SUPPORT;
  const presentation = presentationFor(profile, supportOnce.display);
  const [moreContext, setMoreContext] = useState<boolean | null>(null);
  const showContext = moreContext ?? presentation === 'overview';
  const [checking, setChecking] = useState<string | null>(null);
  const [checkError, setCheckError] = useState('');
  const [submissionResult, setSubmissionResult] = useState('');
  const [receipt, setReceipt] = useState<WorkflowReceipt | null>(null);
  const recorded = (value: WorkflowReceipt | null) => { setReceipt(value); setSubmissionResult(''); };
  const detailsReady = !details.isLoading && !details.detailsError && details.task?.id === sourceId;
  const canEdit = Boolean(scope.project && !scope.error && !scope.isLoading && !scope.project.isArchived
    && (scope.project.ownerId === userId || scope.members.some(member => member.userId === userId && ['admin','editor'].includes(member.role))));
  const materials = uniqueMaterials([...details.attachments, ...(details.commentStatus === 'ready' ? [...details.comments].sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()).flatMap(comment => comment.attachments ?? []) : [])]);
  const situation = taskSituation(task, tasks, names, details.checklists);
  const status = TASK_STATUSES.find(option => option.id === taskStatus(task, tasks))!;
  const base = context.parent ?? task;
  const showBaseAssignees = !situation.nextSteps.some(step => step.assigneeIds && [...step.assigneeIds].sort().join(',') === [...base.assigneeIds].sort().join(','));
  const blockers = taskBlockers(task, tasks);
  const closed = task.isCompleted || task.isArchived || task.isAbandoned;
  const checklistItems = details.checklists.flatMap(list => list.items.map(item => ({ list, item })));
  const unfinishedItems = checklistItems.filter(({ item }) => !item.isChecked);
  const completedItems = checklistItems.filter(({ item }) => item.isChecked);
  const checklistRows = (entries: typeof checklistItems) => entries.map(({ list, item }) => <label key={JSON.stringify([list.id, item.id])} className="flex items-start gap-2 text-sm">
    <input type="checkbox" className="mt-1 shrink-0" checked={item.isChecked} onChange={async () => {
      if (checking) return;
      setChecking(item.id); setCheckError('');
      try { await details.toggleChecklistItem(list.id, item.id); }
      catch (error) { setCheckError(error instanceof Error ? error.message : 'チェックを保存できませんでした。'); }
      finally { setChecking(null); }
    }} />
    <span className="min-w-0">{details.checklists.length > 1 && <span className="block text-xs text-muted-foreground">{list.title}</span>}<span className={item.isChecked ? 'break-words text-muted-foreground line-through' : 'break-words'}>{item.text}</span></span>
  </label>);
  const pendingReview = context.review && !context.review.isCompleted;
  const handoff = context.handoffs[0];
  const focus = workSupportContext(task, tasks, userId, scope.project?.description ?? '');
  const title = context.canResubmit ? `${base.title}の修正をお願いします` : context.canReview ? `${base.title}を確認してください`
    : closed ? 'この仕事の結果を記録しました' : handoff ? '確認結果が届いています'
      : pendingReview ? '確認の返答を待っています' : task.workState ? '再開の条件を確認しましょう' : task.workProgress === 'started' ? '作業の続きから進められます' : 'この仕事から始められます';
  const request = previous?.review?.request || (base.completionCriteria ? '次の完了条件を確認してください。\n' + base.completionCriteria : '');
  if (task.parentTaskId && task.taskKind !== 'review_request') return <section className="rounded-xl border p-4"><p className="mb-2 text-sm">{task.title}</p><Link className="text-sm underline" href={href(task)}>親タスクで確認・編集</Link></section>;
  return <section aria-label="選んだ仕事の続き" className="space-y-3 px-5 py-3">
    <div>
      {context.parent && <p className="mb-1 break-words text-xs text-muted-foreground">{task.projectName} / {base.title}</p>}
      <h3 className={context.canResubmit || context.canReview || closed || handoff || pendingReview || task.workState ? 'mb-2 text-sm font-semibold' : 'sr-only'}>{title}</h3>

      {context.review && <p className="mt-1 text-xs text-muted-foreground">{focus.role} · {focus.intent}</p>}
      <div className="flex items-start gap-3 text-sm" aria-label="現在の状況と次の担当">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2 py-0.5 text-xs font-medium ${status.color}`}><span className={`size-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />{situation.situation}</span>
          {situation.nextSteps.map((step, index) => <span key={index} className="inline-flex min-w-0 items-center gap-1.5">
            {step.assigneeIds !== null && (step.assigneeIds.length ? <TaskAssignees task={{ ...task, assigneeIds: step.assigneeIds }} names={names} members={memberIcons} iconOnly /> : <span className="text-xs text-muted-foreground">担当未設定</span>)}
            <span className="break-words">{step.text}</span>
          </span>)}
        </div>
        {task.dueDate && <span className="ml-auto shrink-0 py-1 text-xs tabular-nums text-muted-foreground">期限 {format(task.dueDate, 'M/d')}</span>}
      </div>
      {showBaseAssignees && <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">作業：<TaskAssignees task={base} names={names} members={memberIcons} iconOnly /></div>}
    </div>
    {base.completionCriteria && <p className="border-l-2 border-primary/50 pl-3 text-sm"><span className="mb-1 block text-xs text-muted-foreground">終わる条件</span>{base.completionCriteria}</p>}
    {!detailsReady && <p role={details.detailsError ? 'alert' : 'status'} className="text-xs text-amber-800">{details.detailsError || '資料と仕事の情報を確認しています…'}</p>}
    {details.commentStatus === 'error' && <p role="alert" className="text-xs text-amber-800">コメント内の資料を取得できません。確認依頼に保存された資料だけ表示します。</p>}
    {handoff && <div className="space-y-2 rounded-lg border p-3"><p className="text-xs font-medium">引き継いだ確認結果 · {handoff.review?.round ?? 1}回目</p><p className="whitespace-pre-wrap break-words text-sm">{handoff.review?.request}</p><div className="flex items-center gap-2 text-xs text-muted-foreground"><TaskAssignees task={{ assigneeIds: Object.entries(handoff.review?.responses ?? {}).filter(([, response]) => response.outcome === 'approved').map(([id]) => id) }} names={names} members={memberIcons} compact />確認OK</div><TaskMaterials files={handoff.review?.attachments ?? []} label="引き継いだ資料" /><Link href={href(handoff)} className="text-xs text-primary">確認の記録を見る</Link></div>}
    {detailsReady && !context.review && checklistItems.length > 0 && <section aria-label="この仕事のチェックリスト" className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><h4 className="font-medium">{details.checklists.length === 1 ? details.checklists[0].title : 'チェックリスト'}</h4><span className="text-muted-foreground">残り{unfinishedItems.length}件 · {completedItems.length}/{checklistItems.length}完了</span></div>
      <fieldset disabled={!canEdit || closed || checking !== null} className="space-y-2" aria-label="チェック項目">
        {checklistRows(unfinishedItems.slice(0, 3))}
        {unfinishedItems.length > 3 && <details><summary className="cursor-pointer py-1 text-xs text-primary">ほかの未完了 {unfinishedItems.length - 3}件</summary><div className="mt-2 space-y-2">{checklistRows(unfinishedItems.slice(3))}</div></details>}
        {completedItems.length > 0 && <details><summary className="cursor-pointer py-1 text-xs text-muted-foreground">完了済み {completedItems.length}件</summary><div className="mt-2 space-y-2">{checklistRows(completedItems)}</div></details>}
      </fieldset>
      {checkError && <p role="alert" className="text-xs text-destructive">{checkError}</p>}
    </section>}
    <WorkSupportPreparation checklists={detailsReady ? details.checklists : undefined} task={task} tasks={tasks} userId={userId} purpose={scope.project?.description ?? ''} preferenceKey={JSON.stringify([profile, supportOnce.revision])} once={supportOnce.instruction} onConsumed={() => setSupportOnce(value => ({ ...value, instruction: '' }))} disabled={!detailsReady || !canEdit || !support.isSuccess} actions={!context.review && !closed && !task.workState && !blockers.length ? <fieldset disabled={!canEdit || !detailsReady} className="flex min-w-0 flex-wrap items-start gap-2"><TaskWorkflow task={task} tasks={tasks} userId={userId} names={names} continuation compact onRecorded={recorded} />{task.workProgress === 'started' && !submitting && <Button size="sm" onClick={() => setSubmissionFor(submissionKey)}><ArrowRight className="h-4 w-4" />資料を送って確認してもらう</Button>}</fieldset> : null} />
    {context.review && !context.review.review && detailsReady && details.commentStatus === 'ready' && <TaskMaterials files={details.comments.find(comment => comment.id === context.review?.sourceCommentId)?.attachments ?? []} label="元の確認依頼の資料" />}
    {context.review && <fieldset disabled={!canEdit || !detailsReady} className="min-w-0"><TaskWorkflow key={context.review.id} task={context.review} tasks={tasks} userId={userId} names={names} continuation availableAttachments={materials} onRecorded={recorded} /></fieldset>}
    {!context.review && previous?.isCompleted && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">確認結果を見る・訂正する</summary><fieldset disabled={!canEdit || !detailsReady} className="mt-3 min-w-0"><TaskWorkflow key={previous.id} task={previous} tasks={tasks} userId={userId} names={names} continuation availableAttachments={materials} onRecorded={recorded} /></fieldset></details>}
    {!context.review && !handoff && detailsReady && materials.length > 0 && !submitting && <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-xs text-muted-foreground">資料 {materials.length}件</summary><div className="mt-2"><TaskMaterials files={materials} label="この仕事に登録された資料" /></div></details>}
    {!context.review && !closed && blockers.length > 0 && <div className="text-sm"><p>先に確認する仕事</p>{blockers.map(blocker => blocker.task ? <Link key={blocker.id} href={href(blocker.task)} className="mt-1 block text-primary">{blocker.task.title}</Link> : <p key={blocker.id} className="text-amber-800">前提の仕事を取得できません。</p>)}</div>}
    {!context.review && !closed && !task.workState && !blockers.length && task.workProgress === 'started' && submitting && <fieldset disabled={!canEdit || !detailsReady} className="min-w-0 space-y-3">
      <CommentComposer onSubmitted={message => { setSubmissionResult(message); setReceipt(null); }} projectId={task.projectId} taskId={task.id} authorId={userId} authorName={user?.displayName || 'メンバー'} members={members} tasks={tasks} availableAttachments={materials} reviewContext={{ request, assigneeIds: previous?.assigneeIds.filter(id => scope.project?.memberIds.includes(id)) ?? [], nextTaskId: previous?.review?.nextTaskId ?? '', policy: previous?.review?.policy ?? 'any', sourceLabel: previous ? '前回の確認先と依頼内容を引き継ぎました。変更できます。' : request ? '完了条件から確認内容を用意しました。確認する人を選んでください。' : '確認してほしいことと、確認する人を指定してください。', expectedVersion: taskVersion(task) }} />
    </fieldset>}
    {submissionResult && <p role="status" className="rounded-md border p-3 text-sm text-emerald-800">{submissionResult}</p>}
    {receipt && <div role="status" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-sm text-emerald-900"><p>{workflowReceiptMessage(receipt, names)}</p><p className="text-xs">{format(new Date(receipt.at), 'M/d HH:mm')}の操作記録</p><Link href={href(task)} className="text-xs underline">記録・現在の状況を見る</Link></div>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
      <button type="button" className="py-1 text-xs text-primary hover:underline" aria-expanded={showContext} onClick={() => setMoreContext(!showContext)}>{showContext ? '説明を短くする' : '目的・依頼の詳細を見る'}</button>
      <Link prefetch={false} href={`/projects/${encodeURIComponent(task.projectId)}/board?taskView=progress&view=progress`} className="py-1 text-xs text-primary">カンバン進捗</Link>
      <Link prefetch={false} href={href(task)} className="inline-flex items-center gap-1 py-1 text-xs text-primary">詳細<ExternalLink className="h-3 w-3" /></Link>
      <AISupportAdjust inline userId={userId} surface="work" disabled={!support.isSuccess} pendingInstruction={supportOnce.instruction} displayInstruction={supportOnce.display} onApplyOnce={instruction => { setSupportOnce(value => ({ display: ['全体を見たい', 'もっと短く', '次の一歩を先に'].includes(instruction) ? instruction : '', instruction, revision: value.revision + 1 })); setMoreContext(null); }} />
    </div>
    {showContext && <div className="space-y-2 whitespace-pre-wrap break-words text-sm"><p>{scope.project?.description || 'プロジェクトの目的は未登録です。'}</p><p>{base.description || '依頼の補足はありません。'}</p></div>}
    {support.isError && <p className="text-xs text-muted-foreground">手伝い方を取得できません。標準の表示で開いています。<button type="button" className="ml-2 underline" onClick={() => support.refetch()}>再取得</button></p>}
    {task.workState && <p className="text-xs text-muted-foreground">{task.workState.reason} ／ 再開の条件：{task.workState.resumeCondition || '要確認'}</p>}
    {!canEdit && !scope.isLoading && <p className="text-xs text-muted-foreground">編集権限を確認できないため、資料の閲覧のみ利用できます。</p>}
    {closed && <p className="text-xs text-emerald-700">一覧や詳細にも同じ結果が反映されます。</p>}
    {context.review && reviewOutcome(context.review) === 'approved' && <p className="text-xs text-muted-foreground">確認OKを記録しました。作業そのものの完了は、完了条件を確認して記録してください。</p>}
  </section>;
}
