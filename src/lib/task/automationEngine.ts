import { recognizePurchaseEvidence } from './purchase/evidence';
import { validPurchaseIdentity } from './purchase/types';
import type { Task } from '@/types';
import { recalculateDates } from '@/lib/utils/task';
import type { AutomationGrant, EvidenceResult, EvidenceStage, TaskEvidence, TaskEvidenceRule } from './automationTypes';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Match complete tokens for Latin identifiers/years, avoiding 2026 matching 20260 or order AB12 matching AB123.
export function containsIdentity(text: string, token: string) {
  const escaped = normalize(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const edge = /^[\x00-\x7F]+$/.test(token) ? '[a-z0-9]' : '[a-z0-9一-龠ぁ-んァ-ヶ]';
  return new RegExp(`(^|[^${edge.slice(1, -1)}])${escaped}($|[^${edge.slice(1, -1)}])`, 'u').test(normalize(text));
}
export function validRule(rule: TaskEvidenceRule) {
  return rule && typeof rule.enabled === 'boolean' && typeof rule.allowExpectedDate === 'boolean' &&
    ['projectId', 'taskId'].every(k => typeof rule[k as keyof TaskEvidenceRule] === 'string' && /^[^/]{1,200}$/.test(rule[k as 'taskId'])) &&
    (rule.order ? validPurchaseIdentity(rule.order) : ['subject', 'period', 'person'].every(k => typeof rule[k as keyof TaskEvidenceRule] === 'string' && (rule[k as 'subject']).trim().length >= 2 && (rule[k as 'subject']).length <= 200)) &&
    typeof rule.sender === 'string' && rule.sender.length <= 254 && (!!rule.order && rule.sender === '' || !rule.sources?.includes('gmail') || /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(rule.sender)) &&
    ['tracking', 'purchase', 'registration', 'receipt'].includes(rule.criterion) && Array.isArray(rule.sources) && rule.sources.length > 0 && rule.sources.length <= 2 &&
    new Set(rule.sources).size === rule.sources.length && rule.sources.every(s => s === 'gmail' || s === 'comment');
}
function senderEmail(sender: string) { return normalize(sender.match(/<([^<>]+)>/)?.[1] ?? sender); }
const rank: Record<EvidenceStage, number> = { in_production: 3.5, application: 0, registered: 1, ordered: 2, paid: 3, shipped: 4, expected: 4, received: 5, cancelled: 6, refunded: 6 };
export const evidenceRuleVersion = (rule: TaskEvidenceRule) => JSON.stringify([rule.subject, rule.period, rule.person, rule.criterion, ...(rule.order ? [rule.order] : [])]);

/** Conservative recognition from permitted, server-read source text. Unknown prose never becomes a completion. */
export function recognizeEvidence(rule: TaskEvidenceRule, uid: string, evidence: TaskEvidence): EvidenceResult | null {
  if (rule.order) return recognizePurchaseEvidence(rule, uid, evidence);
  if (!rule.sources.includes(evidence.source) || !Number.isFinite(Date.parse(evidence.at))) return null;
  if (evidence.source === 'comment' ? evidence.authorId !== uid : senderEmail(evidence.sender) !== normalize(rule.sender)) return null;
  const text = normalize(evidence.text);
  if (![rule.subject, rule.period, rule.person].every(term => containsIdentity(text, term))) return null;
  if (/[?？]|(?:ですか|ましたか|でしょうか|未確認|未確定|完了予定|済み予定|明日.*完了|したら|すれば|するまで|するには|の手順|の方法)/.test(text)) return null;
  if (/\b(?:not|pending|unconfirmed|will|would|should|please|unless|if)\b|(?:完了|済み).{0,15}(?:予定|待ち|待っています|確認中|不明|希望)/.test(text)) return null;
  // Quotes, forwarded prose, hypothetical/negative statements are not evidence of an achieved condition.
  if (/(?:未完了|未購入|未払い|未登録|未受取|まだ|する予定|予定しています|してください|お願いします|の場合|していない|していません|されていません|ではありません|できません|完了していない|完了していません|キャンセル待ち|返金待ち|キャンセル申請|返金申請|キャンセル予定|返金予定|転送|forwarded|^>)/m.test(text)) return null;
  let stage: EvidenceStage | null = null;
  if (/(?:返金完了|返金済み|返金しました|refund completed)/.test(text)) stage = 'refunded';
  else if (/(?:キャンセル完了|キャンセル済み|キャンセルされました|取消完了|取り消しました|order cancelled)/.test(text)) stage = 'cancelled';
  else if (/(?:受取完了|受取済み|受け取りました|受領しました|配達完了|delivery completed)/.test(text)) stage = 'received';
  else if (/(?:到着予定|お届け予定|配達予定|expected delivery)/.test(text)) stage = 'expected';
  else if (/(?:発送完了|発送しました|発送済み|出荷完了|shipped)/.test(text)) stage = 'shipped';
  else if (/(?:支払完了|支払い完了|決済完了|入金確認済み|入金を確認しました|購入完了|購入しました|購入済み|payment completed)/.test(text)) stage = 'paid';
  else if (/(?:注文完了|注文が確定|注文成立|order confirmed)/.test(text)) stage = 'ordered';
  else if (/(?:登録完了|登録が完了しました|登録しました|registration completed)/.test(text)) stage = 'registered';
  else if (/(?:申込受付|申込みを受け付け|お申し込みを受け付け|application received)/.test(text)) stage = 'application';
  if (!stage) return null;
  // A greeting to A followed by B's purchase is not evidence for A. The named
  // beneficiary and affirmative result must share a clause; uncertain templates stay unconfirmed.
  const stagePatterns: Record<EvidenceStage, RegExp> = {
    in_production: /印刷中|印刷を開始しました/,
    application: /申込受付|申込みを受け付け|お申し込みを受け付け|application received/,
    registered: /登録完了|登録が完了しました|登録しました|registration completed/,
    ordered: /注文完了|注文が確定|注文成立|order confirmed/,
    paid: /支払完了|支払い完了|決済完了|入金確認済み|入金を確認しました|購入完了|購入しました|購入済み|payment completed/,
    shipped: /発送完了|発送しました|発送済み|出荷完了|shipped/,
    expected: /到着予定|お届け予定|配達予定|expected delivery/,
    received: /受取完了|受取済み|受け取りました|受領しました|配達完了|delivery completed/,
    cancelled: /キャンセル完了|キャンセル済み|キャンセルされました|取消完了|取り消しました|order cancelled/,
    refunded: /返金完了|返金済み|返金しました|refund completed/,
  };
  if (!evidence.text.split(/[。\n!?！？]/).some(raw => {
    const clause = normalize(raw);
    if (!containsIdentity(clause, rule.person)) return false;
    const status = stagePatterns[stage!].exec(clause); if (!status) return false;
    const personAt = clause.indexOf(normalize(rule.person));
    let between = personAt < status.index ? clause.slice(personAt + normalize(rule.person).length, status.index) : clause.slice(status.index + status[0].length, personAt);
    // Only connective/subject words may separate the person and the result. A different
    // person's name or unknown subject cannot silently inherit this beneficiary.
    for (const token of [rule.subject, rule.period, '代理購入', 'チケット', 'お支払い', '支払い', 'ご注文', '対象者', '対象', 'さん', 'さま', '様', '氏', '本人分', 'の分', '分', 'の', 'は', 'が', 'を', 'に', '購入', '支払', '登録', '注文', '商品']) between = between.replaceAll(normalize(token), '');
    return /^[\s:：、・\-\[\]【】()（）]*$/.test(between);
  })) return null;
  let expectedDate: string | null = null;
  if (stage === 'expected') {
    // Never use the event's year or the AI check date as the delivery date. Require a full, attached calendar date.
    const matches = [...text.matchAll(/(?:到着予定|お届け予定|配達予定|expected delivery)[：:\s]*(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/g)];
    if (matches.length !== 1) return null;
    const [, y, m, d] = matches[0]; expectedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const date = new Date(`${expectedDate}T12:00:00+09:00`);
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== expectedDate) return null;
  }
  return { evidence, stage, expectedDate };
}
export function completesCriterion(criterion: TaskEvidenceRule['criterion'], stage: EvidenceStage) {
  // Shipping does not prove payment; delivery does not prove registration.
  return criterion === 'tracking' ? false : criterion === 'purchase' ? stage === 'paid' : criterion === 'registration' ? stage === 'registered' : stage === 'received';
}
export function selectEvidence(grant: AutomationGrant, evidence: TaskEvidence[], now: string): EvidenceResult | null {
  const records = grant.records.filter(r => !r.ruleVersion || r.ruleVersion === evidenceRuleVersion(grant.rule));
  const recognized = evidence.filter(e => Date.parse(e.at) >= Date.parse(grant.notBefore) && Date.parse(e.at) <= Date.parse(now) &&
    !records.some(r => r.sourceId === e.id && r.sourceVersion === e.version && r.source === e.source))
    .map(e => recognizeEvidence(grant.rule, grant.uid, e)).filter((e): e is EvidenceResult => e !== null)
    .filter(e => !grant.latestEvidenceAt || e.evidence.at > grant.latestEvidenceAt || e.evidence.at === grant.latestEvidenceAt &&
      (records.some(r => r.source === e.evidence.source && r.sourceId === e.evidence.id && r.sourceVersion !== e.evidence.version) ||
       !records.some(r => r.evidenceAt === e.evidence.at && r.stage !== e.stage)))
    .map(e => grant.rule.order && e.stage === 'expected' && grant.stage && !['cancelled','refunded','received'].includes(grant.stage) ? {...e,stage:grant.stage} : e)
    .filter(e => !grant.stage || rank[e.stage] >= rank[grant.stage])
    .sort((a, b) => a.evidence.at.localeCompare(b.evidence.at));
  if (!recognized.length) return null;
  const newest = recognized[0];
  if (recognized.some(e => e.evidence.at === newest.evidence.at && (e.stage !== newest.stage || e.expectedDate !== newest.expectedDate))) return null;
  return newest;
}
export function requiredChildrenState(parent: Pick<Task, 'completionPolicy'> & Partial<Pick<Task, 'id' | 'projectId'>>, tasks: Task[]) {
  const policy = parent.completionPolicy;
  if (!policy || policy.kind !== 'all_required_children' || !policy.condition.trim() || !policy.required.length) return null;
  const rows = policy.required.map(required => {
    const task = tasks.find(t => t.id === required.taskId);
    return { ...required, task, complete: !!task && (!parent.id || task.parentTaskId === parent.id) && (!parent.projectId || task.projectId === parent.projectId) && task.taskKind !== 'review_request' && !task.isArchived && !task.isAbandoned && task.assigneeIds.length === 1 && task.assigneeIds[0] === required.assigneeId && task.isCompleted };
  });
  return { rows, complete: rows.every(row => row.complete) };
}
export function reminderDue(due: string | null, now: string, snoozedUntil: string | null) {
  if (!due || !Number.isFinite(Date.parse(due))) return false;
  if (snoozedUntil && Date.parse(snoozedUntil) > Date.parse(now)) return false;
  const day = (v: string) => new Date(Date.parse(v) + 9 * 3600000).toISOString().slice(0, 10);
  return day(now) >= day(new Date(Date.parse(due) - 86400000).toISOString());
}

/** Keep an authorized delivery date fixed in the existing task scheduling model. */
export function expectedDateSchedule(task: {startDate: Date | string | null; dueDate: Date | string | null; durationDays: number | null; isDueDateFixed: boolean}, expectedDate: string):
  {ok: true; dueDate: string; isDueDateFixed: true; durationDays: number | null} | {ok: false; reason: string} {
  const invalid = {ok:false as const,reason:'開始日・到着予定の日付を確認できないため、自動更新を停止しています。'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) return invalid;
  const eta = new Date(`${expectedDate}T12:00:00+09:00`);
  const jstDay = (value: Date) => new Date(value.getTime() + 9 * 3600000).toISOString().slice(0,10);
  if (!Number.isFinite(eta.getTime()) || jstDay(eta) !== expectedDate) return invalid;
  const start = task.startDate === null ? null : new Date(task.startDate);
  if (start && !Number.isFinite(start.getTime())) return invalid;
  if (start && jstDay(start) > expectedDate) return {ok:false,reason:'到着予定が登録済みの開始日より前です。開始日・到着予定を確認するまで、自動更新を停止しています。'};
  // Task dates represent calendar days. Normalize both to day boundaries so the
  // server timezone or time-of-day cannot turn an inclusive duration into 0 days.
  const startDay = start ? new Date(`${jstDay(start)}T00:00:00.000Z`) : null;
  const dueDay = new Date(`${expectedDate}T00:00:00.000Z`);
  const dates = recalculateDates({startDate:startDay,dueDate:null,durationDays:task.durationDays,isDueDateFixed:task.isDueDateFixed} as Task,{dueDate:dueDay});
  return {ok:true,dueDate:eta.toISOString(),isDueDateFixed:true,durationDays:dates.durationDays};
}
