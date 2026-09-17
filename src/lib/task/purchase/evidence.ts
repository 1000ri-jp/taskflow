import type { EvidenceResult, EvidenceStage, TaskEvidence, TaskEvidenceRule } from '../automationTypes';
import { calendarDate, validPurchaseIdentity } from './types';
const norm = (text: string) => text.normalize('NFKC').toLowerCase();
const token = (text: string, value: string) => new RegExp(`(^|[^a-z0-9])${norm(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`).test(norm(text));
/** Source dates disambiguate month/day. Task deadlines are never used as the year. */
export function deliveryDate(text: string, sourceAt: string): string | null {
  const source = new Date(sourceAt); if (!Number.isFinite(source.getTime())) return null;
  const matches = [...norm(text).matchAll(/(?:到着予定(?:日)?|お届け予定(?:日)?|配達予定(?:日)?|expected delivery)\s*[:：]?\s*(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?/g)];
  const dates = matches.map(([,year,month,day]) => {
    const years = year ? [+year] : [source.getUTCFullYear()-1,source.getUTCFullYear(),source.getUTCFullYear()+1];
    const candidates = years.map(y=>`${y}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`).filter(calendarDate).filter(date=>year || (Date.parse(date)-source.getTime())/86400000 >= -7 && (Date.parse(date)-source.getTime())/86400000 <= 180);
    return candidates.length === 1 ? candidates[0] : null;
  });
  return dates.length && dates.every(d=>d && d===dates[0]) ? dates[0] : null;
}
export function recognizePurchaseEvidence(rule: TaskEvidenceRule, uid: string, evidence: TaskEvidence): EvidenceResult | null {
  const order = rule.order;
  if (!order || !validPurchaseIdentity(order) || !rule.sources.includes(evidence.source) || !Number.isFinite(Date.parse(evidence.at))) return null;
  if (evidence.source === 'comment' && evidence.authorId !== uid) return null;
  if (evidence.source === 'gmail' && rule.sender && norm(evidence.sender.match(/<([^<>]+)>/)?.[1] ?? evidence.sender).trim() !== norm(rule.sender).trim()) return null;
  // Ignore quoted/forwarded history; these messages are evidence, never instructions to execute.
  const text = norm(evidence.text.split(/\n(?:-{2,}.*(?:forwarded|original)|On .+wrote:)/i)[0].split('\n').filter(line=>!/^\s*>/.test(line)).join('\n'));
  if (!token(text,order.orderNumber) || !text.includes(norm(order.merchant))) return null;
  const clauses = (text.match(/[^。\n!?！？]+[。!?！？]?/g)??[]).filter(c=>!/[?？]\s*$/.test(c)&&!/(ではありません|未定|未確定|未完了|未発送|未受取|まだ|していない|していません|されていません|キャンセル申請|返金申請|してください|お願いします|したら|すれば|する予定|発送予定|出荷予定|発送待ち|未確認|ですか|しましたか|でしょうか|not shipped|の場合)/.test(c));
  const patterns: [EvidenceStage,RegExp][] = [
    ['refunded',/返金完了|返金済み|返金しました|refund completed/],
    ['cancelled',/キャンセル完了|キャンセル済み|キャンセルされました|取消完了|order cancelled/],
    ['received',/受取完了|受取済み|受け取りました|受領しました|配達完了|delivery completed/],
    ['shipped',/発送完了|発送しました|発送済み|発送いたしました|出荷完了|出荷しました|shipped/],
    ['in_production',/印刷中|印刷を開始しました|印刷工程に入りました|製造中/],
    ['paid',/支払完了|支払い完了|決済完了|入金確認済み|入金を確認しました|購入完了|購入しました|payment completed/],
    ['ordered',/注文完了|注文が確定|注文成立|ご注文を承りました|order confirmed/],
  ];
  const expectedDate = deliveryDate(clauses.join('\n'),evidence.at);
  const stage = patterns.find(([,pattern])=>clauses.some(c=>pattern.test(c)))?.[0] ?? (expectedDate ? 'expected' : null);
  return stage ? {evidence,stage,expectedDate} : null;
}
