import type { GoogleItem, GoogleSource } from '@/lib/google/workspace/types';
import type { SecretarySnapshot, SecretaryState } from './types';

export const INCOMING_SERVICES = ['gmail', 'chat'] as const;
export type IncomingService = typeof INCOMING_SERVICES[number];
export const MAX_INCOMING_ITEMS = 60;
export interface IncomingContext {
  signature: string; email: string; ownerName?: string;
  accessScope?: string; connectionEpoch?: string; sourceVersions?: Record<string, string>;
  sources: Record<IncomingService, GoogleSource>;
  selections: Record<IncomingService, string[]>;
}
export interface IncomingEvidence extends Pick<GoogleItem, 'id' | 'title' | 'at' | 'url' | 'sourceName'> { service: IncomingService; quote: string }
export interface IncomingCandidate {
  id: string; title: string; kind: 'request' | 'reply' | 'deadline'; reason: string;
  uncertainties: string[]; evidence: IncomingEvidence[];
  // A literal expression in the cited text, never an inferred due date.
  deadline: string | null; matchedTaskKeys: string[];
}
export interface IncomingReview {
  signature: string; reviewedAt: string; candidates: IncomingCandidate[];
  counts: Record<IncomingService, number>;
}
export function incomingSourceUsable(source: GoogleSource, now: string) {
  const age = Date.parse(now) - Date.parse(source.fetchedAt ?? '');
  return source.connected && ['ready', 'partial'].includes(source.status) && Number.isFinite(age) && age >= -60000 && age <= 3 * 3600000;
}
export function incomingMessages(snapshot: SecretarySnapshot) {
  return INCOMING_SERVICES.flatMap(service => {
    const source = snapshot.incoming?.sources[service];
    if (!source || !incomingSourceUsable(source, snapshot.checkedAt)) return [];
    return [...new Map(source.items.map(item => [item.id, item])).values()]
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_INCOMING_ITEMS).map((item, index) => {
        const text = `${item.title}\n${item.text}`;
        // Exact, bounded server-owned excerpts. Model returns option IDs only.
        const options = (text.match(/[\s\S]{1,400}/g) ?? []).slice(0, 6).map((quote, i) => ({ id: `e${i + 1}`, quote }));
        const dates = [...new Set(options.flatMap(o => o.quote.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}月\d{1,2}日|(?:明日|明後日|今日|本日|今週|来週|今月|来月)(?:\s*\d{1,2}[:：]\d{2})?|\d{1,2}\/\d{1,2}/g) ?? []))];
        const dateOptions = dates.slice(0, 20).map((quote, i) => ({ id: `d${i + 1}`, quote }));
        return { ref: `${service === 'gmail' ? 'g' : 'c'}${index + 1}`, service, item, options, dateOptions };
      });
  });
}
export function currentIncomingReview(state: SecretaryState, snapshot: SecretarySnapshot) {
  return snapshot.incoming && state.incomingReview?.signature === snapshot.incoming.signature ? state.incomingReview : undefined;
}
export function incomingNeedsReview(state: SecretaryState, snapshot: SecretarySnapshot) {
  const review = currentIncomingReview(state, snapshot);
  const due = state.incomingDecisions?.some(d => d.scope === snapshot.incoming?.accessScope &&
    (d.status === 'reconsider' && (!review || review.reviewedAt < d.updatedAt) || d.reviewAt && d.reviewAt <= snapshot.checkedAt && (!review || review.reviewedAt < d.reviewAt)));
  return !!snapshot.incoming && INCOMING_SERVICES.some(service => incomingSourceUsable(snapshot.incoming!.sources[service], snapshot.checkedAt)) && (!review || !!due);
}

/** Narrow admission checks, not a completion classifier: don't reuse older mail
 * without the latest available reply, or convert explicit other-person mentions into my work. */
export function candidateHasCurrentPersonalSource(candidate: IncomingCandidate, snapshot: SecretarySnapshot) {
  const messages = incomingMessages(snapshot);
  const normalizeName = (s: string) => s.normalize('NFKC').replace(/[\s*＊]/g, '').toLowerCase();
  const owner = normalizeName(snapshot.incoming?.ownerName ?? '');
  const cited = messages.filter(m => candidate.evidence.some(e => e.service === m.service && e.id === m.item.id));
  const personallyRelevant = cited.every(m => {
    if (m.service !== 'chat' || !owner) return true;
    const hasMentions = /(?:^|\s)@\S/u.test(m.item.text);
    return !hasMentions || normalizeName(m.item.text).includes(`@${owner}`);
  });
  if (!personallyRelevant) return false;
  const gmail = cited.filter(m => m.service === 'gmail');
  if (gmail.length) {
    const conversation = (item: GoogleItem) => item.conversationId || item.url.split('#')[1];
    return gmail.some(m => !messages.some(later => later.service === 'gmail' && conversation(later.item) === conversation(m.item) && Date.parse(later.item.at) > Date.parse(m.item.at)));
  }
  return true;
}
