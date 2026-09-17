import { reviewResult } from './reviews';
import { completionBlockReason } from './completion';
import { canBeTaskParent } from './parentTask';
import { taskBlockers } from './status';
import type { CommentAttachment, Task } from '@/types';
import { validateCommentSubmission } from './commentSubmission';

export interface ReviewCycle {
  urgency?: 'urgent';
  policy: 'any' | 'all';
  round: number;
  request: string;
  attachments: CommentAttachment[];
  requestedAt: string;
  responses: Record<string, { outcome: 'approved' | 'changes_requested'; note: string; at: string }>;
  nextTaskId?: string | null;
  correctedApproval?: { by: string; note: string; at: string; previousResponse: ReviewCycle['responses'][string] };
  previousRound?: Pick<ReviewCycle, 'round' | 'request' | 'attachments' | 'responses' | 'requestedAt'>;
}
export type WorkflowAction = 'resume' | 'edit_subtask' | 'reparent' | 'configure' | 'start' | 'reset' | 'archive' | 'restore' | 'complete' | 'reopen' | 'approve' | 'request_changes' | 'resubmit' | 'correct_approval';
export interface WorkDetails { completionCriteria: string; primaryAssigneeId: string | null; taskKind: 'task' | 'decision'; milestoneId: string | null }
export interface WorkflowInput { id: string; action: WorkflowAction; expectedVersion: string; note?: string; details?: WorkDetails; attachments?: CommentAttachment[]; parentTaskId?: string | null; subtaskPatch?: { title?: string; dueDate?: string | null; assigneeIds?: string[] } }
export const workflowLabels: Record<WorkflowAction, string> = {
  resume: '保留・待ちを解除', edit_subtask: 'サブタスクを編集', reparent: '親タスクを変更',
  configure: '完了条件・役割・節目を変更', start: '作業を開始', complete: '仕事を完了', reopen: '仕事を再開', approve: '確認OK', request_changes: '修正を依頼', resubmit: '再確認を依頼',
  correct_approval: '確認OKを訂正', reset: '未着手に戻す', archive: '仕事をアーカイブ', restore: 'アーカイブから復元',
};
export function taskVersion(task: Pick<Task, 'updatedAt'>): string { return task.updatedAt?.toISOString() ?? ''; }
export function reviewOutcome(task: Pick<Task, 'review' | 'assigneeIds'>): 'pending' | 'approved' | 'changes_requested' {
  return reviewResult(task);
}
export function planWorkflow(task: Task, tasks: Task[], uid: string, input: WorkflowInput, now: Date) {
  if (!['resume','edit_subtask','reparent','configure','start','reset','archive','restore','complete','reopen','approve','request_changes','resubmit','correct_approval'].includes(input.action)
    || !/^[\w-]{1,200}$/.test(input.id) || typeof input.expectedVersion !== 'string'
    || input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 2000)) throw new Error('操作内容を確認してください。');
  if (input.attachments !== undefined) {
    if (input.action !== 'resubmit') throw new Error('添付は再提出のときだけ指定できます。');
    validateCommentSubmission({ id: input.id, projectId: task.projectId, taskId: task.id, authorId: uid, authorName: 'メンバー', content: input.note || '再提出', notifyIds: [], review: null, attachments: input.attachments });
  }
  if (taskVersion(task) !== input.expectedVersion) throw new Error('仕事の情報が変わりました。最新の内容を確認してください。');
  if (task.reviewRecordId && !['approve','request_changes','resubmit','correct_approval'].includes(input.action)) throw new Error('確認依頼は親タスクのやりとりから返答してください。');
  if (input.action === 'archive' || input.action === 'restore') {
    if (task.isArchived !== (input.action === 'restore')) throw new Error('アーカイブの状態が変わりました。最新の内容を確認してください。');
    const patch: Partial<Task> = input.action === 'archive'
      ? { isArchived: true, archivedAt: now, archivedBy: uid }
      : { isArchived: false, archivedAt: null, archivedBy: null };
    return { patch, recipients: [] as string[], nextTaskId: task.id, text: workflowLabels[input.action] };
  }
  if (task.isArchived || task.isAbandoned) throw new Error('アーカイブ・中止した仕事には反映できません。');
  if(task.parentTaskId && task.taskKind !== 'review_request' && ['resume','configure','start','reset'].includes(input.action))throw new Error('サブタスクは完了チェックで管理してください。');
  if (input.action === 'resume') {
    if(!task.workState || task.isCompleted || task.taskKind==='review_request')throw new Error('保留・待ちの状態が変わりました。');
    return {patch:{workState:null},recipients:[] as string[],nextTaskId:task.id,text:workflowLabels.resume};
  }
  if (input.action === 'reparent') {
    if (input.parentTaskId !== null && (typeof input.parentTaskId !== 'string' || !canBeTaskParent(task, input.parentTaskId, new Map(tasks.map(t => [t.id, t]))))) throw new Error('親タスクとサブタスクの二段までです。サブタスクを持つ仕事は親の下へ移せません。');
    return { patch: { parentTaskId: input.parentTaskId ?? '', ...(task.sourceCommentId && !task.sourceCommentTaskId && task.parentTaskId ? { sourceCommentTaskId: task.parentTaskId } : {}) }, recipients: [] as string[], nextTaskId: task.id, text: workflowLabels.reparent };
  }
  if (input.action === 'edit_subtask') {
    const parent = tasks.find(t => t.projectId === task.projectId && t.id === task.parentTaskId);
    const p = input.subtaskPatch;
    if (!parent || parent.parentTaskId || parent.isArchived || parent.isAbandoned || task.taskKind === 'review_request' || !p || !Object.keys(p).length || Object.keys(p).some(k => !['title','dueDate','assigneeIds'].includes(k))) throw new Error('親タスクからサブタスクを開き直してください。');
    if (p.title !== undefined && (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500)
      || p.assigneeIds !== undefined && (!Array.isArray(p.assigneeIds) || p.assigneeIds.length > 30 || !p.assigneeIds.every(id => /^[\w-]{1,200}$/.test(id)))
      || p.dueDate !== undefined && p.dueDate !== null && (typeof p.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) || !Number.isFinite(Date.parse(p.dueDate)) || new Date(p.dueDate).toISOString().slice(0,10) !== p.dueDate)) throw new Error('名前・担当者・期日を確認してください。');
    const patch: Partial<Task> = { ...(p.title !== undefined ? { title: p.title.trim() } : {}), ...(p.assigneeIds ? { assigneeIds: [...new Set(p.assigneeIds)] } : {}), ...(p.dueDate !== undefined ? { dueDate: p.dueDate ? new Date(p.dueDate + 'T00:00:00+09:00') : null } : {}) };
    return { patch, recipients: [] as string[], nextTaskId: parent.id, text: workflowLabels.edit_subtask };
  }
  if (input.action === 'configure') {
    const d = input.details;
    if (!d || Object.keys(d).some(k => !['completionCriteria','primaryAssigneeId','taskKind','milestoneId'].includes(k)) || typeof d.completionCriteria !== 'string' || d.completionCriteria.length > 2000
      || !['task','decision'].includes(d.taskKind) || d.primaryAssigneeId !== null && !task.assigneeIds.includes(d.primaryAssigneeId)
      || d.milestoneId !== null && !/^[\w-]{1,200}$/.test(d.milestoneId)) throw new Error('完了条件・主担当・節目を確認してください。');
    const patch: Partial<Task> = { completionCriteria: d.completionCriteria.trim(), primaryAssigneeId: d.primaryAssigneeId, milestoneId: d.milestoneId,
      ...(task.taskKind !== 'review_request' ? { taskKind: d.taskKind === 'decision' ? 'decision' as const : undefined } : {}) };
    // Firestore cannot store undefined; a normal task has no specialized kind.
    if (d.taskKind === 'task' && task.taskKind !== 'review_request') delete patch.taskKind;
    return { patch, clearTaskKind: d.taskKind === 'task' && task.taskKind === 'decision', recipients: [] as string[], nextTaskId: task.id, text: workflowLabels.configure };
  }
  const parent = tasks.find(t => t.projectId === task.projectId && t.id === task.parentTaskId);
  if (input.action === 'correct_approval') {
    if (task.taskKind !== 'review_request' || !task.review || !task.isCompleted || reviewOutcome(task) !== 'approved'
      || !task.assigneeIds.includes(uid) || task.review.responses[uid]?.outcome !== 'approved') throw new Error('今回の確認OKを返した本人だけが訂正できます。');
    if (!parent || parent.isArchived || parent.isAbandoned || parent.isCompleted) throw new Error('確認対象の仕事が完了・変更されています。詳細から現在の状況を確認してください。');
    if (!input.note?.trim()) throw new Error('訂正する理由を入力してください。');
    if (tasks.some(t => t.projectId === task.projectId && t.parentTaskId === parent.id && t.id !== task.id && t.taskKind === 'review_request' && !t.isArchived && !t.isAbandoned
      && (t.review?.requestedAt ?? t.createdAt.toISOString()) >= task.review!.requestedAt)) throw new Error('新しい確認依頼があります。最新の確認を開いてください。');
    const responses = { ...task.review.responses }; delete responses[uid];
    const review: ReviewCycle = { ...task.review, responses, correctedApproval: { by: uid, note: input.note.trim(), at: now.toISOString(), previousResponse: task.review.responses[uid] } };
    const downstream = tasks.find(t => t.projectId === task.projectId && t.id === review.nextTaskId);
    return { patch: { review, isCompleted: false, completedAt: null }, recipients: [...parent.assigneeIds, ...task.assigneeIds, ...(downstream?.assigneeIds ?? [])],
      nextTaskId: task.id, text: `確認OKを訂正（${review.round}回目）：${input.note.trim()}` };
  }
  const reviewAction = ['approve','request_changes','resubmit'].includes(input.action);
  const note = input.note?.trim() ?? '';
  if (reviewAction) {
    if (task.taskKind !== 'review_request') throw new Error('確認依頼を開いてください。');
    if (!parent || parent.isArchived || parent.isAbandoned || parent.isCompleted) throw new Error('確認対象の仕事を確認できません。');
    if (input.action === 'resubmit') {
      if (!parent.assigneeIds.includes(uid) && task.createdBy !== uid) throw new Error('作業担当または依頼者が再確認を依頼できます。');
      if (reviewOutcome(task) !== 'changes_requested') throw new Error('修正依頼のある仕事だけ再確認できます。');
      if (!note) throw new Error('修正内容と確認する成果物を入力してください。');
    } else {
      if (!task.assigneeIds.includes(uid)) throw new Error('確認する人だけが返答できます。');
      if (task.isCompleted || reviewOutcome(task) !== 'pending') throw new Error('この確認は返答済みです。最新の状態を確認してください。');
      if (task.review?.responses[uid]) throw new Error('あなたの返答は記録済みです。');
      if (input.action === 'request_changes' && !note) throw new Error('修正してほしいことを入力してください。');
    }
    const previous = task.review ?? { policy: 'any' as const, round: 1, request: task.description, attachments: [], requestedAt: task.createdAt?.toISOString() ?? now.toISOString(), responses: {} };
    const review: ReviewCycle = input.action === 'resubmit'
      ? { ...previous, round: previous.round + 1, request: note, attachments: input.attachments ?? [], requestedAt: now.toISOString(), responses: {},
        previousRound: { round: previous.round, request: previous.request, attachments: previous.attachments, responses: previous.responses, requestedAt: previous.requestedAt } }
      : { ...previous, responses: { ...previous.responses, [uid]: { outcome: input.action === 'approve' ? 'approved' : 'changes_requested', note, at: now.toISOString() } } };
    if (input.action === 'resubmit') delete review.correctedApproval;
    const approved = reviewOutcome({ review, assigneeIds: task.assigneeIds }) === 'approved';
    const next = approved && review.nextTaskId ? tasks.find(t => t.projectId === task.projectId && t.id === review.nextTaskId && !t.isArchived && !t.isAbandoned && !t.isCompleted) : null;
    return { patch: { review, isCompleted: approved, completedAt: approved ? now : null },
      recipients: input.action === 'resubmit' ? task.assigneeIds : approved ? [...parent.assigneeIds, ...(next?.assigneeIds ?? [])] : input.action === 'request_changes' ? parent.assigneeIds : [],
      nextTaskId: input.action === 'resubmit' || input.action === 'approve' && !approved ? task.id : next?.id ?? parent.id, text: `${workflowLabels[input.action]}（${review.round}回目）${note ? `：${note}` : ''}` };
  }
  if (task.taskKind === 'review_request') throw new Error('確認依頼は「確認OK」または「修正が必要」で返答してください。');
  if (input.action === 'start') {
    if (task.workState) throw new Error('完了・保留・待ちの状態を確認してください。');
    if (taskBlockers(task, tasks).length) throw new Error('前提の仕事が未完了、または未取得です。');
    if (tasks.some(t => t.parentTaskId === task.id && t.taskKind === 'review_request' && !t.isCompleted && !t.isArchived && !t.isAbandoned && reviewOutcome(t) !== 'changes_requested')) throw new Error('確認・修正の返答が残っています。');
  }
  if (input.action === 'complete') { const reason = completionBlockReason(task, tasks); if (reason) throw new Error(reason); }
  if (input.action === 'reopen' && !task.isCompleted) throw new Error('この仕事は未完了です。');
  const patch: Partial<Task> = input.action === 'reset' ? { workProgress: 'not_started', isCompleted: false, completedAt: null }
    : input.action === 'start' ? { workProgress: 'started', ...(task.isCompleted ? { isCompleted: false, completedAt: null } : {}) }
    : { isCompleted: input.action === 'complete', completedAt: input.action === 'complete' ? now : null };
  return { patch, recipients: [] as string[], nextTaskId: task.id, text: workflowLabels[input.action] };
}


export interface WorkflowReceipt {
  action: WorkflowAction;
  taskId: string;
  taskTitle: string;
  at: string;
  nextTaskId: string;
  nextTaskTitle: string;
  nextAssigneeIds: string[];
  notifiedUserIds: string[];
  reviewOutcome: ReturnType<typeof reviewOutcome> | null;
  downstreamStarted: boolean;
}
export function workflowReceipt(task: Task, tasks: Task[], input: WorkflowInput, now: Date,
  plan: ReturnType<typeof planWorkflow>, notifiedUserIds: string[]): WorkflowReceipt {
  const updated = { ...task, ...plan.patch };
  const next = plan.nextTaskId === task.id ? updated : tasks.find(t => t.projectId === task.projectId && t.id === plan.nextTaskId);
  const outcome = updated.taskKind === 'review_request' ? reviewOutcome(updated) : null;
  const downstream = tasks.find(t => t.projectId === task.projectId && t.id === updated.review?.nextTaskId);
  return { action: input.action, taskId: task.id, taskTitle: task.title, at: now.toISOString(), nextTaskId: plan.nextTaskId,
    nextTaskTitle: next?.title ?? '', nextAssigneeIds: next?.taskKind === 'review_request' && outcome === 'pending'
      ? next.assigneeIds.filter(id => next.review?.responses[id]?.outcome !== 'approved') : next?.assigneeIds ?? [],
    notifiedUserIds, reviewOutcome: outcome, downstreamStarted: Boolean(downstream?.workProgress === 'started' || downstream?.isCompleted) };
}
export function workflowReceiptMessage(receipt: WorkflowReceipt, names: Record<string, string>): string {
  const people = receipt.nextAssigneeIds.map(id => names[id] ?? 'メンバー').join('、') || '担当者未設定';
  const next = receipt.nextTaskTitle ? `次は${people}の「${receipt.nextTaskTitle}」です。` : '次の仕事は詳細で確認できます。';
  const message = receipt.action === 'approve' ? receipt.reviewOutcome === 'approved' ? `確認OKを記録しました。${next}` : `あなたの確認OKを記録しました。${people}の確認を待っています。`
    : receipt.action === 'request_changes' ? `修正依頼を記録しました。${next}`
      : receipt.action === 'resubmit' ? `修正版を送りました。${people}の確認を待っています。`
        : receipt.action === 'correct_approval' ? `確認OKの訂正を記録しました。${people}が再確認します。${receipt.downstreamStarted ? '後続の作業はすでに進んでいます。作業の状態は戻していません。' : '後続の作業は自動で戻しません。'}`
          : receipt.action === 'start' ? '着手を記録しました。この仕事から提出まで進められます。' : `${workflowLabels[receipt.action]}を記録しました。`;
  const notified = receipt.notifiedUserIds.map(id => names[id] ?? 'メンバー').join('、');
  return message + (notified ? ` ${notified}の通知に追加しました。既読はまだ確認していません。` : '');
}
