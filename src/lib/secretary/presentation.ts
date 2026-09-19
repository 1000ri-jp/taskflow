import { blockers, hasCurrentEvidence, requiresClarification, jstDay } from './engine';
import { reviewResult } from '@/lib/task/reviews';
import type { Proposal, SecretarySnapshot, SecretaryTask } from './types';

/** A reason to surface a candidate first, not proof that the user must decide today. */
export function proposalAttentionReason(p: Proposal, snapshot: SecretarySnapshot): { kind: 'urgent' | 'due'; label: string } | null {
  const task = snapshot.tasks.find(t => t.key === p.key);
  if (!task || p.status !== 'pending' || !task.assigneeIds.includes(snapshot.userId)
    || task.isCompleted || task.isAbandoned || task.isArchived) return null;
  const review = task.context?.review;
  if (task.context?.taskKind === 'review_request' && review?.urgency === 'urgent'
    && !review.responses[snapshot.userId] && reviewResult({ review, assigneeIds: task.assigneeIds }) === 'pending') {
    return { kind: 'urgent', label: '至急の確認依頼' };
  }
  const today = jstDay(snapshot.checkedAt);
  if (task.dueDate && Number.isFinite(Date.parse(task.dueDate)) && jstDay(task.dueDate) <= today) {
    return { kind: 'due', label: jstDay(task.dueDate) === today ? '期限が今日' : '期限超過' };
  }
  // Revisit-date alerts are suspended until their presentation is redesigned.
  return null;
}

/** Group the same current, resolved work shown with the ready-to-start badge. */
export function isReadyToStartProposal(p: Proposal, snapshot: SecretarySnapshot) {
  const task = snapshot.tasks.find(task => task.key === p.key);
  return !!task && task.context?.taskKind !== 'review_request' && p.status === 'pending'
    && p.disposition === 'execute' && hasCurrentEvidence(p, snapshot)
    && !proposalPresentation(p, task, snapshot).inspect;
}

/** Explain the registered conditions behind the badge, without inventing material readiness. */
export function proposalReadinessReason(p: Proposal, snapshot: SecretarySnapshot): string | null {
  if (!isReadyToStartProposal(p, snapshot)) return null;
  const task = snapshot.tasks.find(task => task.key === p.key)!;
  const conditions = ['登録上、自分の担当です。'];
  if (task.startDate) {
    const day = jstDay(task.startDate);
    conditions.push(`開始日（${Number(day.slice(5, 7))}/${Number(day.slice(8))}）を迎えています。`);
  } else {
    conditions.push('開始日の指定はありません。');
  }
  if (task.dependsOn.length) {
    const titles = task.dependsOn.map(key => snapshot.tasks.find(task => task.key === key)!.title);
    conditions.push(`前工程「${titles.join('」「')}」が完了しています。`);
  } else {
    conditions.push('前工程の登録はありません。');
  }
  conditions.push('待ち・保留の登録はありません。');
  return conditions.join('');
}

/** Selecting a next step also requires the complete snapshot used by the proposal. */
export function isActionableProposal(p: Proposal, snapshot: SecretarySnapshot) {
  return p.snapshotSignature === snapshot.signature && isReadyToStartProposal(p, snapshot);
}

/** Add a checking action without inferring facts, recipients, or execution timing. */
function clarificationAction(value: string) {
  const text = value.trim();
  const subject = text.replace(/[。?？]+$/u, '').trim();
  if (subject.endsWith('確認する')) return text;
  // Keep questions with polite or unspecified grammar intact instead of guessing verb forms.
  if (/(?:です|ます)か$/u.test(subject) || (/[?？]$/u.test(text) && !subject.endsWith('か')) || /[。?？]/u.test(subject)) {
    return `「${text}」を確認する`;
  }
  return `${subject}を確認する`;
}

/** Describe what the current evidence supports, independently of the registered deadline. */
export function proposalPresentation(p: Proposal, task: SecretaryTask, snapshot: SecretarySnapshot) {
  const conditions = blockers(task, snapshot, snapshot.checkedAt);
  if (!task.complete || snapshot.coverage.status === 'partial') {
    return { label: '情報不足・未判断', detail: '取得できていない情報があります。', inspect: true };
  }
  if (requiresClarification(p)) {
    return {
      label: p.uncertainties.length || p.speech === 'question' ? '状況確認が必要' : '今やるか未判断',
      detail: p.uncertainties[0] ? clarificationAction(p.uncertainties[0]) : p.reason,
      inspect: true,
    };
  }
  if (task.dependsOn.some(key => !snapshot.tasks.find(dependency => dependency.key === key)?.complete)) {
    return { label: '前提の確認が必要', detail: '前工程の状況を取得できていません。', inspect: true };
  }
  if (conditions.length && p.disposition === 'execute') {
    return { label: '今は着手できない', detail: conditions.join(' ／ '), inspect: true };
  }
  const labels = { execute: '着手できる', candidate: '今やるか未判断', wait: '条件待ち', hold: '保留の提案', complete: '完了の提案', unneeded: '不要の提案' };
  return { label: labels[p.disposition], detail: p.reason, inspect: false };
}


export function proposalRefreshReason(p: Proposal, snapshot: SecretarySnapshot): { label: string; detail: string } | null {
  const task = snapshot.tasks.find(task => task.key === p.key);
  if (!task || !task.complete || snapshot.coverage.status === 'partial') return { label: '情報未取得', detail: '最新情報を取得できていません。' };
  if (p.sourceVersion !== task.version) return { label: '情報更新', detail: 'このタスクの情報が、前回のAI整理後に変わっています。' };
  const changed = p.relatedVersions.filter(v => (snapshot.tasks.find(task => task.key === v.key)?.version ?? null) !== v.version);
  if (!changed.length) return null;
  const related = changed.map(v => snapshot.tasks.find(task => task.key === v.key));
  if (related.some(task => !task?.complete)) return { label: '関連未取得', detail: '関連する仕事の最新情報を取得できていません。' };
  return { label: '関連変更', detail: `関連する仕事「${related.map(task => task!.title).join('」「')}」の情報が変わっています。` };
}

export function proposalCardQuestion(p: Proposal, task: SecretaryTask, snapshot: SecretarySnapshot): string {
  if (!task.complete || snapshot.coverage.status === 'partial') return '最新情報を取得してから確認してください。';
  if (!hasCurrentEvidence(p, snapshot)) {
    const overdue = task.dueDate && Number.isFinite(Date.parse(task.dueDate)) && jstDay(task.dueDate) < jstDay(snapshot.checkedAt);
    if (overdue && !task.isCompleted && !task.isAbandoned && !task.isArchived && !task.workState && (!task.startDate || jstDay(task.startDate) <= jstDay(snapshot.checkedAt))) {
      return '完了済みですか？ 未完了なら期限を見直しますか？';
    }
    return ''; // The card shows the refresh reason once; old questions stay in its evidence details.
  }
  const detail = proposalPresentation(p, task, snapshot).detail.trim();
  // Turn an existing checking action into a question, preserving its subject and qualifiers.
  if (/[?？]$/u.test(detail)) return detail;
  if (/か(?:を)?確認する[。]?$/u.test(detail)) return detail.replace(/か(?:を)?確認する[。]?$/u, 'か？');
  return detail;
}
