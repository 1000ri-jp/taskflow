import type { IncomingCandidate, IncomingService } from './incoming';
import { currentIncomingReview, incomingMessages } from './incoming';
import { SecretaryError } from './engine';
import type { SecretarySnapshot, SecretaryState } from './types';

export const MAX_INCOMING_DECISIONS = 80;
export interface IncomingDecisionValue {
  key: string; scope: string; title: string;
  sources: { service: IncomingService; id: string; version: string }[];
  related: { key: string; version: string }[];
  status: 'done' | 'hold' | 'linked' | 'reconsider' | 'cleared';
  reason: string; trigger: string; reviewAt: string | null; updatedAt: string;
  operationId: string; fingerprint: string;
  draft?: { conversationId: string; messageId: string };
}
export interface IncomingDecision extends IncomingDecisionValue { before: IncomingDecisionValue | null }
export interface IncomingActionRequest {
  kind: 'incoming'; action: 'done' | 'hold' | 'link' | 'correct' | 'undo' | 'forget' | 'forget_inactive';
  revision: number; requestId: string; connectionEpoch?: string; candidateId?: string; decisionKey?: string; taskKey?: string; reason?: string;
}
export const incomingKey = (snapshot: SecretarySnapshot, candidate: Pick<IncomingCandidate, 'evidence'>) => JSON.stringify([
  snapshot.userId, snapshot.incoming?.email, [...new Set(candidate.evidence.map(e => `${e.service}:${e.id}`))].sort(),
]);
export function visibleIncomingDecisions(state: SecretaryState, snapshot: SecretarySnapshot) {
  const messages = incomingMessages(snapshot);
  return (state.incomingDecisions ?? []).filter(d => d.scope === snapshot.incoming?.accessScope &&
    d.sources.every(s => messages.some(m => m.service === s.service && m.item.id === s.id)) &&
    d.related.every(r => snapshot.tasks.some(t => t.key === r.key)));
}
export function incomingDecisionDue(d: IncomingDecision, snapshot: SecretarySnapshot) {
  return d.status === 'reconsider' || d.sources.some(s => snapshot.incoming?.sourceVersions?.[`${s.service}:${s.id}`] !== s.version) ||
    d.related.some(r => snapshot.tasks.find(t => t.key === r.key)?.version !== r.version) || !!d.reviewAt && d.reviewAt <= snapshot.checkedAt;
}
export function pendingIncomingCandidates(state: SecretaryState, snapshot: SecretarySnapshot) {
  const decisions = visibleIncomingDecisions(state, snapshot);
  const review = currentIncomingReview(state, snapshot);
  return review?.candidates.filter(p => {
    const d = decisions.find(v => v.key === incomingKey(snapshot, p));
    if (!d || !['done', 'hold'].includes(d.status)) return true;
    // A changed source or check date asks the system to review, not the person.
    // Never revive a candidate from before their saved decision or check date.
    return incomingDecisionDue(d, snapshot) && review.reviewedAt > d.updatedAt &&
      (!d.reviewAt || d.reviewAt > snapshot.checkedAt || review.reviewedAt >= d.reviewAt);
  }) ?? [];
}
export function applyIncomingAction(state: SecretaryState, snapshot: SecretarySnapshot, request: IncomingActionRequest): SecretaryState {
  const invalid = () => { throw new SecretaryError('INVALID', '連絡の操作内容を確認してください。'); };
  if (!request || request.kind !== 'incoming' || !['done', 'hold', 'link', 'correct', 'undo', 'forget', 'forget_inactive'].includes(request.action) ||
    !Number.isSafeInteger(request.revision) || typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(request.requestId) ||
    request.reason !== undefined && (typeof request.reason !== 'string' || request.reason.length > 500)) return invalid();
  const records = state.incomingDecisions ?? [];
  const candidate = currentIncomingReview(state, snapshot)?.candidates.find(c => c.id === request.candidateId);
  const visible = visibleIncomingDecisions(state, snapshot);
  const replay = visible.find(d => d.operationId === request.requestId);
  const key = candidate ? incomingKey(snapshot, candidate) : request.decisionKey ?? replay?.key;
  const previous = visible.find(d => d.key === key);
  const fingerprint = JSON.stringify([request.action, key, request.taskKey ?? null, request.reason ?? null]);
  if (previous?.operationId === request.requestId) {
    if (previous.fingerprint !== fingerprint) return invalid();
    return state;
  }
  if (request.revision !== state.revision) throw new SecretaryError('CONFLICT', '別の操作が反映されています。情報を更新してください。');
  if (request.connectionEpoch !== snapshot.incoming?.connectionEpoch) throw new SecretaryError('CONFLICT', 'Googleの接続が変わりました。情報を更新してください。');
  if (request.action === 'forget_inactive') return { ...state, revision: state.revision + 1, incomingDecisions: records.filter(d => visible.some(v => v.key === d.key) && d.status !== 'cleared') };
  if (!snapshot.incoming?.accessScope || !candidate && !previous) throw new SecretaryError('FORBIDDEN', '現在の取得範囲にこの連絡がありません。');
  if (request.action === 'forget') {
    if (!previous || previous.status === 'hold') return invalid();
    return { ...state, revision: state.revision + 1, incomingDecisions: records.filter(d => d.key !== key) };
  }
  if (request.action === 'undo') {
    if (!previous || previous.status === 'cleared') return invalid();
    const restored = previous.before ?? { ...previous, status: 'cleared' as const, reason: '', trigger: '', reviewAt: null };
    return { ...state, revision: state.revision + 1, incomingDecisions: records.map(d => d.key === key ? { ...restored, before: null, operationId: request.requestId, fingerprint, updatedAt: snapshot.checkedAt } : d) };
  }
  if (snapshot.coverage.status === 'partial') throw new SecretaryError('INCOMPLETE', '関連する仕事の取得が一部未完了です。情報を更新してください。');
  const sources = [...new Map((candidate?.evidence ?? previous!.sources).map(e => [`${e.service}:${e.id}`, { service: e.service, id: e.id, version: snapshot.incoming!.sourceVersions?.[`${e.service}:${e.id}`] ?? '' }])).values()];
  if (!sources.length || sources.some(s => !s.version)) throw new SecretaryError('CONFLICT', '連絡の版を確認できません。情報を更新してください。');
  if (request.action === 'link' && !snapshot.tasks.some(t => t.key === request.taskKey)) return invalid();
  const taskKeys = request.action === 'link' ? [request.taskKey!] : previous?.related.map(r => r.key) ?? candidate?.matchedTaskKeys ?? [];
  const related = taskKeys.map(k => snapshot.tasks.find(t => t.key === k)).filter(t => !!t).map(t => ({ key: t.key, version: t.version }));
  const before = previous ? Object.fromEntries(Object.entries(previous).filter(([field]) => field !== 'before')) as unknown as IncomingDecisionValue : null;
  const next: IncomingDecision = { key: key!, scope: snapshot.incoming.accessScope, title: candidate?.title ?? previous!.title,
    sources, related, status: request.action === 'link' ? 'linked' : request.action === 'correct' ? 'reconsider' : request.action,
    reason: request.reason?.trim() || candidate?.reason || previous?.reason || '', trigger: '新しい情報を照合し、判断が必要になったとき',
    reviewAt: null, updatedAt: snapshot.checkedAt,
    operationId: request.requestId, fingerprint, before,
    ...(previous?.draft ? { draft: previous.draft } : {}) };
  const retained = records.filter(d => d.key !== key && d.status !== 'cleared');
  if (retained.length >= MAX_INCOMING_DECISIONS) throw new SecretaryError('INCOMPLETE', '連絡の記録が80件になりました。連絡欄から不要な記録を削除してください。保留は保持しています。');
  const result = { ...state, revision: state.revision + 1, incomingDecisions: [...retained, next] };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 800000) throw new SecretaryError('INCOMPLETE', '保存容量に近づいています。不要になった対応済みの記録を削除してください。');
  return result;
}
