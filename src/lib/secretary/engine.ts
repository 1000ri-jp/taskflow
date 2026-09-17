import type { Task } from '@/types';
import { recalculateDates } from '@/lib/utils/task';
import type { ActionRequest, Disposition, Interpretation, PersonalDecision, Proposal, SecretarySnapshot, SecretaryState, SecretaryTask, SecretaryTaskPatch, TaskSchedulePatch, TaskStatusPatch } from './types';

export class SecretaryError extends Error {
  constructor(public code: 'INVALID' | 'CONFLICT' | 'FORBIDDEN' | 'INCOMPLETE' | 'AI_UNAVAILABLE', message: string) { super(message); }
}
export const REVIEW_POLICY_VERSION = 2;
const dispositions: Disposition[] = ['execute', 'candidate', 'hold', 'wait', 'unneeded', 'complete'];
function invalid(message = 'AIの提案形式または根拠を確認できませんでした。再整理してください。'): never { throw new SecretaryError('INVALID', message); }
export function jstDay(date: string) { return new Date(new Date(date).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function atJstMorning(day: string) { return new Date(`${day}T09:00:00+09:00`).toISOString(); }
export function isValidSecretaryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function nextWeek(now: string) {
  const day = new Date(`${jstDay(now)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + (8 - day.getUTCDay()) % 7);
  // Always the next Monday, including when today is Monday.
  if (day.toISOString().slice(0, 10) <= jstDay(now)) day.setUTCDate(day.getUTCDate() + 7);
  return atJstMorning(day.toISOString().slice(0, 10));
}
export function nextMonth(now: string) {
  const day = new Date(`${jstDay(now)}T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + 1, 1);
  return atJstMorning(day.toISOString().slice(0, 10));
}
function text(value: unknown, max = 800): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function taskText(task: SecretaryTask) {
  return `${task.title}\n${task.description}\n列: ${task.listName}\n期限: ${task.dueDate ? jstDay(task.dueDate) : '未設定'}\n開始: ${task.startDate ? jstDay(task.startDate) : '未設定'}\n完了: ${task.isCompleted}\n中止: ${task.isAbandoned}`;
}
function reviewDate(value: Interpretation['review'], task: SecretaryTask): string | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return invalid();
  if (value.kind === 'due_date') {
    if (!task.dueDate || !Number.isInteger(value.leadDays) || value.leadDays < 0 || value.leadDays > 14) return invalid('期限に基づく再確認日が不正です。');
    const date = new Date(atJstMorning(jstDay(task.dueDate)));
    date.setUTCDate(date.getUTCDate() - value.leadDays);
    return date.toISOString();
  }
  if (value.kind === 'comment_date') {
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return invalid();
    const date = new Date(`${value.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) return invalid();
    // Relative or ambiguous dates are left unset; exact source date is required.
    if (!task.comments.find(c => c.id === value.commentId)?.content.includes(value.date)) return invalid('コメントに明記された日付を確認できませんでした。');
    return atJstMorning(value.date);
  }
  return invalid();
}

/** Accept untrusted model output only with exact, in-scope evidence. No executable tools. */
export function validateInterpretations(raw: unknown, snapshot: SecretarySnapshot): Interpretation[] {
  if (!Array.isArray(raw) || raw.length > 60) return invalid();
  const seen = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const p = value as Interpretation;
    const task = snapshot.tasks.find(t => t.key === p.key);
    // An explicit null means no known trigger. Keep it unset rather than inventing a condition.
    // Missing fields and all other non-string values still fail validation.
    const trigger = p.trigger === null ? '' : p.trigger;
    if (!task || !task.complete || !task.assigneeIds.includes(snapshot.userId) || task.isArchived || seen.has(p.key)) return invalid();
    seen.add(p.key);
    if (!['request', 'progress', 'question', 'idea', 'hold', 'reference'].includes(p.speech) ||
      !['confirmed', 'considering', 'unknown'].includes(p.commitment) || !dispositions.includes(p.disposition) ||
      !text(p.reason) || typeof trigger !== 'string' || trigger.length > 500 ||
      !Array.isArray(p.uncertainties) || p.uncertainties.length > 6 || p.uncertainties.some(v => !text(v, 300)) ||
      !Array.isArray(p.evidence) || p.evidence.length < 1 || p.evidence.length > 5 ||
      (p.duplicateOf !== null && (p.duplicateOf === p.key || !snapshot.tasks.some(t => t.key === p.duplicateOf))) ||
      (p.estimateMinutes !== null && (!Number.isInteger(p.estimateMinutes) || p.estimateMinutes < 1 || p.estimateMinutes > 480))) return invalid();
    for (const e of p.evidence) {
      if (!e || !text(e.quote, 600) || typeof e.source !== 'string') return invalid();
      const source = e.source === 'task' ? taskText(task) : task.comments.find(c => c.id === e.source)?.content;
      if (!source?.includes(e.quote)) return invalid('提案の引用が元のタスク・コメントと一致しませんでした。');
    }
    if (p.decision !== undefined) {
      if (!p.decision || !text(p.decision.question, 300) || !text(p.decision.whyNow, 500) || !text(p.decision.consequence, 500)) return invalid();
      // Dates, titles and missing metadata alone cannot justify asking a person.
      const substantive = p.evidence.some(e => e.source === 'task'
        ? task.description.trim().length > 0 && task.description.includes(e.quote)
        : task.comments.some(c => c.id === e.source && c.content.includes(e.quote)));
      if (!substantive) return invalid('判断が必要な理由を裏付ける本文・返答の根拠がありません。');
      if (/明日|明後日|昨日/.test(Object.values(p.decision).join(' '))) return invalid('判断には相対日付ではなく具体的な日付を使ってください。');
    }
    reviewDate(p.review, task);
    // Considering / question / ideas cannot become execution or shared terminal changes.
    const disposition = p.commitment !== 'confirmed' || ['idea', 'question', 'reference'].includes(p.speech)
      ? (['execute', 'complete', 'unneeded'].includes(p.disposition) ? 'candidate' : p.disposition) : p.disposition;
    return { ...(p.decision ? { decision: { question: p.decision.question, whyNow: p.decision.whyNow, consequence: p.decision.consequence } } : {}), key: p.key, speech: p.speech, commitment: p.commitment, disposition, reason: p.reason, trigger,
      review: p.review, uncertainties: p.uncertainties, evidence: p.evidence.map(e => ({ source: e.source, quote: e.quote })),
      duplicateOf: p.duplicateOf, estimateMinutes: p.estimateMinutes };
  });
}

export function needsReview(state: SecretaryState, snapshot: SecretarySnapshot, now: string): boolean {
  return state.reviewPolicyVersion !== REVIEW_POLICY_VERSION || !state.reviewedAt || jstDay(state.reviewedAt) !== jstDay(now) || state.observedSignature !== snapshot.signature || state.decisions.some(d => d.correctionPending || d.reviewAt && d.reviewAt <= now && (!state.reviewedAt || d.reviewAt > state.reviewedAt));
}
export function hasCurrentEvidence(p: Proposal, snapshot: SecretarySnapshot): boolean {
  return p.sourceVersion === snapshot.tasks.find(t => t.key === p.key)?.version && p.relatedVersions.every(v => (snapshot.tasks.find(t => t.key === v.key)?.version ?? null) === v.version);
}
export function mergeReview(state: SecretaryState, snapshot: SecretarySnapshot, raw: unknown, now: string, runId: string): SecretaryState {
  if (snapshot.coverage.status === 'partial') throw new SecretaryError('INCOMPLETE', '取得が一部未完了です。情報を更新してから整理してください。');
  const parsed = validateInterpretations(raw, snapshot);
  const proposals = parsed.map((p, index): Proposal => {
    const task = snapshot.tasks.find(t => t.key === p.key)!;
    const previous = state.proposals.find(v => v.key === p.key);
    const decision = state.decisions.find(v => v.key === p.key);
    const due = !!decision?.reviewAt && decision.reviewAt <= now && (!state.reviewedAt || decision.reviewAt > state.reviewedAt);
    // Keep explicit corrections / decisions on unchanged evidence. A one-day hold is not permanent.
    if (previous && !['pending', 'undone'].includes(previous.status) && hasCurrentEvidence(previous, snapshot) && !due && !decision?.correctionPending) return { ...previous, snapshotSignature: snapshot.signature };
    return { ...p, policyVersion: REVIEW_POLICY_VERSION, id: `${runId}-${index}`, createdAt: now, sourceVersion: task.version,
      snapshotSignature: snapshot.signature, reviewAt: reviewDate(p.review, task), status: 'pending',
      relatedVersions: [...new Set([...task.dependsOn, ...snapshot.tasks.filter(other => other.projectId === task.projectId && (other.context?.parent?.taskId === task.taskId || other.taskId === task.context?.parent?.taskId)).map(other => other.key), ...(p.duplicateOf ? [p.duplicateOf] : [])])].map(key => ({ key, version: snapshot.tasks.find(t => t.key === key)?.version ?? null })) };
  });
  const retained = state.proposals.filter(p => p.status !== 'pending' && !proposals.some(v => v.key === p.key) && snapshot.tasks.some(t => t.key === p.key));
  return { ...state, reviewPolicyVersion: REVIEW_POLICY_VERSION, decisions: state.decisions.map(d => ({ ...d, correctionPending: false })), proposals: [...proposals, ...retained].slice(0, 100), revision: state.revision + 1, observedSignature: snapshot.signature, reviewedAt: now };
}

export function blockers(task: SecretaryTask, snapshot: SecretarySnapshot, now: string): string[] {
  const reasons: string[] = [];
  if (task.workState) reasons.push(`共有タスクは${task.workState.status === 'hold' ? '保留' : '待ち'}：${task.workState.resumeCondition || '再開条件を確認'}`);
  if (!task.complete || snapshot.coverage.status === 'partial') reasons.push('取得範囲を確認');
  if (!task.assigneeIds.includes(snapshot.userId)) reasons.push('自分の担当ではない');
  if (task.startDate && jstDay(task.startDate) > jstDay(now)) reasons.push('開始日前');
  if (task.isCompleted || task.isAbandoned || task.isArchived) reasons.push('完了・中止・アーカイブ済み');
  for (const key of task.dependsOn) {
    const dep = snapshot.tasks.find(t => t.key === key);
    if (!dep || dep.isArchived || !dep.isCompleted) reasons.push(dep ? `前工程待ち: ${dep.title}` : '前工程が未取得');
  }
  return reasons;
}
export function requiresClarification(p: Interpretation): boolean {
  return p.disposition === 'candidate' || p.uncertainties.length > 0 || p.commitment !== 'confirmed' || ['question', 'idea', 'reference'].includes(p.speech);
}
const taskStatus = (t: SecretaryTask): TaskStatusPatch => ({ isCompleted: t.isCompleted, isAbandoned: t.isAbandoned, completedAt: t.completedAt });
const taskSchedule = (t: SecretaryTask): TaskSchedulePatch => ({ dueDate: t.dueDate, durationDays: t.durationDays ?? null, isDueDateFixed: t.isDueDateFixed });
function rescheduledTask(task: SecretaryTask, dueDate: string): TaskSchedulePatch {
  if (task.startDate && jstDay(task.startDate) > dueDate) return invalid('期限が登録済みの開始日より前です。タスクで開始日も確認してください。');
  // Compare JST calendar days so server timezone cannot change the inclusive
  // duration, and never move the start date to fit a newly requested deadline.
  const startDate = task.startDate ? new Date(`${jstDay(task.startDate)}T00:00:00.000Z`) : null;
  const result = recalculateDates({ startDate, dueDate: null, durationDays: task.durationDays ?? null, isDueDateFixed: task.isDueDateFixed } as Task,
    { dueDate: new Date(`${dueDate}T00:00:00.000Z`) });
  return { dueDate: atJstMorning(dueDate), durationDays: result.durationDays, isDueDateFixed: true };
}

/** Pure transition shared by Firestore transactions and the isolated local workbench. */
export function applyAction(state: SecretaryState, snapshot: SecretarySnapshot, request: ActionRequest, now: string, nonce: string) {
  if (request.revision !== state.revision) throw new SecretaryError('CONFLICT', '別の操作が反映されています。最新情報を確認してください。');
  let p = state.proposals.find(v => v.id === request.proposalId);
  if (request.taskKey !== undefined || request.sourceVersion !== undefined) {
    // A person can edit a registered task without asking AI to generate a proposal first.
    if (!['reschedule', 'unneeded'].includes(request.action) || p || state.history.some(h => h.proposalId === request.proposalId)) return invalid('操作内容を確認してください。');
    const direct = snapshot.tasks.find(t => t.key === request.taskKey);
    if (!direct || !direct.assigneeIds.includes(snapshot.userId) || direct.isArchived || direct.isCompleted || direct.isAbandoned || direct.context?.taskKind === 'review_request') throw new SecretaryError('FORBIDDEN', 'この仕事はここから変更できません。');
    if (direct.version !== request.sourceVersion) throw new SecretaryError('CONFLICT', '仕事の情報が変わりました。最新情報を確認してください。');
    p = { key: direct.key, id: request.proposalId, status: 'pending', sourceVersion: direct.version, relatedVersions: [], snapshotSignature: snapshot.signature,
      createdAt: now, policyVersion: REVIEW_POLICY_VERSION, speech: 'request', commitment: 'confirmed', disposition: 'candidate', reason: '本人が仕事の一覧から操作しました。', trigger: '', review: null, reviewAt: null, uncertainties: [], evidence: [], duplicateOf: null, estimateMinutes: null };
  }
  const undoRecord = request.action === 'undo' ? [...state.history].reverse().find(h => h.proposalId === request.proposalId && !h.undone) : undefined;
  const task = snapshot.tasks.find(v => v.key === (p?.key ?? undoRecord?.key));
  if ((!p && !undoRecord) || !task) throw new SecretaryError('FORBIDDEN', 'この提案へのアクセスを確認できません。');
  const previous = state.decisions.find(d => d.key === task.key) ?? null;
  let patch: SecretaryTaskPatch | null = null;
  let beforePatch: SecretaryTaskPatch | null = null;
  if (request.action === 'undo') {
    const h = [...state.history].reverse().find(v => v.key === task.key && !v.undone);
    if (!h || h.proposalId !== request.proposalId || previous?.nonce !== h.afterNonce || (h.afterVersion && h.afterVersion !== task.version)) throw new SecretaryError('CONFLICT', '採用後に情報が変わったため自動で戻せません。タスクを確認してください。');
    if (h.beforeTask && !task.canWrite) throw new SecretaryError('FORBIDDEN', '共有タスクを戻す編集権限がありません。');
    patch = h.beforeTask;
    return { state: { ...state, revision: state.revision + 1,
      decisions: [...state.decisions.filter(d => d.key !== task.key), ...(h.beforeDecision ? [h.beforeDecision] : [])],
      proposals: state.proposals.map(v => v.key === task.key ? { ...v, status: 'undone' as const } : v),
      history: state.history.map(v => v.id === h.id ? { ...v, undone: true } : v) }, patch, key: task.key };
  }
  if (!p) throw new SecretaryError('FORBIDDEN', 'この提案へのアクセスを確認できません。');
  if (snapshot.coverage.status === 'partial' || !task.complete) throw new SecretaryError('INCOMPLETE', '最新のタスクとコメントを取得できるまで採用できません。');
  if (!hasCurrentEvidence(p, snapshot)) throw new SecretaryError('CONFLICT', '根拠に更新があります。最新情報で再整理してください。');
  if (p.status !== 'pending') throw new SecretaryError('CONFLICT', 'この提案は処理済みです。必要なら採用を戻してください。');
  let disposition = p.disposition;
  let reviewAt = p.reviewAt;
  let correction: string | null = null;
  if (request.action === 'next_week') { disposition = 'hold'; reviewAt = nextWeek(now); correction = '来週まで個人表示で保留。共有の約束は変更しない。'; }
  else if (request.action === 'next_month') { disposition = 'hold'; reviewAt = nextMonth(now); correction = '来月1日まで個人表示で保留。共有の約束は変更しない。'; }
  else if (request.action === 'unneeded') { disposition = 'unneeded'; correction = '個人の実行候補から外す。共有タスクの中止は未指示。'; }
  else if (request.action === 'correct') { disposition = 'candidate'; correction = request.correction?.trim() || 'この提案は違う。今の根拠で繰り返さず、情報が変わったら再検討。'; if (correction.length > 800) return invalid(); reviewAt = null; }
  else if (request.action === 'reschedule') {
    if (!task.canWrite) throw new SecretaryError('FORBIDDEN', '共有タスクの期限を変更する編集権限がありません。');
    if (!isValidSecretaryDate(request.dueDate)) return invalid('期限は実在する日付（YYYY-MM-DD）で指定してください。');
    if(task.context?.taskKind==='review_request')return invalid('確認依頼は親タスクのやりとりから操作してください。');
    if(task.context?.parentState==='ready'){patch={dueDate:request.dueDate};beforePatch={dueDate:task.dueDate};}
    else {patch = rescheduledTask(task, request.dueDate); beforePatch = taskSchedule(task);}
    disposition = 'candidate'; reviewAt = null; correction = `共有タスクの期限を${request.dueDate}に変更。今着手するかは改めて確認する。`;
  }
  else if (request.action === 'complete' || request.action === 'cancel') {
    if (request.action === 'cancel' && task.context?.parentState==='ready') return invalid('サブタスクは親タスクで完了チェックまたは削除を操作してください。');
    if (task.context?.taskKind === 'review_request') return invalid('確認依頼は確認する人が返答してください。');
    if (!task.canWrite) throw new SecretaryError('FORBIDDEN', '共有タスクの編集権限がありません。');
    if (p.commitment !== 'confirmed' || (request.action === 'complete' ? p.disposition !== 'complete' : p.disposition !== 'unneeded')) return invalid('共有の変更は対応する根拠付き提案から行ってください。');
    patch = { isCompleted: request.action === 'complete', isAbandoned: request.action === 'cancel', completedAt: request.action === 'complete' ? now : null };
    beforePatch = taskStatus(task);
    disposition = request.action === 'complete' ? 'complete' : 'unneeded';
  } else if (request.action !== 'accept') return invalid();
  if (disposition === 'execute' && (p.commitment !== 'confirmed' || blockers(task, snapshot, now).length)) {
    disposition = 'wait';
  }
  const decision: PersonalDecision = { key: p.key, disposition, reviewAt, correction, reason: p.reason, trigger: p.trigger,
    updatedAt: now, sourceVersion: task.version, nonce, correctionPending: request.action === 'reschedule' || request.action === 'correct' && !!request.correction?.trim() };
  return { key: task.key, patch, state: { ...state, revision: state.revision + 1,
    decisions: [...state.decisions.filter(d => d.key !== p.key), decision],
    proposals: state.proposals.map(v => v.id === p.id ? { ...v, status: patch ? 'applied' as const : request.action === 'correct' ? 'rejected' as const : 'accepted' as const } : v),
    history: [...state.history, { id: nonce, key: p.key, proposalId: p.id, action: request.action, at: now,
      beforeDecision: previous, afterNonce: nonce, beforeTask: beforePatch,
      afterTask: patch, afterVersion: null, undone: false }].slice(-40) } };
}

export function buildSecretaryBoard(state: SecretaryState, snapshot: SecretarySnapshot, now: string, availableMinutes: number | null) {
  const activeTasks = snapshot.tasks.filter(t => t.assigneeIds.includes(snapshot.userId) && !t.isCompleted && !t.isAbandoned && !t.isArchived);
  const due = activeTasks.filter(t => t.dueDate && jstDay(t.dueDate) <= jstDay(now)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const current = (p: Proposal) => hasCurrentEvidence(p, snapshot);
  const waiting = state.decisions.filter(d => ['hold', 'wait', 'unneeded'].includes(d.disposition) && activeTasks.some(t => t.key === d.key) &&
    !state.proposals.some(p => p.key === d.key && p.status === 'pending'));
  const ready = state.proposals.filter(p => p.status === 'accepted' && p.disposition === 'execute' && !requiresClarification(p) && current(p) &&
    state.decisions.some(d => d.key === p.key && d.disposition === 'execute') && !blockers(snapshot.tasks.find(t => t.key === p.key)!, snapshot, now).length);
  ready.sort((a, b) => {
    const ta = snapshot.tasks.find(t => t.key === a.key)!; const tb = snapshot.tasks.find(t => t.key === b.key)!;
    return (ta.dueDate ?? '9999').localeCompare(tb.dueDate ?? '9999') || Number(tb.priority === 'high') - Number(ta.priority === 'high');
  });
  const fitting = availableMinutes === null ? ready : ready.filter(p => p.estimateMinutes === null || p.estimateMinutes <= availableMinutes);
  const estimates = ready.reduce((n, p) => n + (p.estimateMinutes ?? 0), 0);
  const decisions = state.proposals.filter(p => p.status === 'pending' && activeTasks.some(t => t.key === p.key));
  decisions.sort((a, b) => {
    const ta = snapshot.tasks.find(t => t.key === a.key)!; const tb = snapshot.tasks.find(t => t.key === b.key)!;
    const urgency = (p: Proposal, t: SecretaryTask) => (t.dueDate && jstDay(t.dueDate) <= jstDay(now) ? 100 : 0) + (p.uncertainties.length ? 30 : 0) + (p.disposition === 'execute' ? 20 : 0) + (p.disposition === 'complete' ? 10 : 0);
    return urgency(b, tb) - urgency(a, ta);
  });
  return { first: fitting[0] ?? null, next: fitting.slice(1, 3), decisions, waiting, due, estimates,
    unknownEstimates: ready.filter(p => p.estimateMinutes === null).length,
    overCapacity: availableMinutes !== null && estimates > availableMinutes,
    completedToday: snapshot.tasks.filter(t => t.assigneeIds.includes(snapshot.userId) && t.isCompleted && t.completedAt && jstDay(t.completedAt) === jstDay(now)).length };
}
