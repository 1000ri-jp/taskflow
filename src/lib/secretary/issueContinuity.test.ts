import proResult from './fixtures/pro-now-2026-09-15.json';
import { describe, expect, it } from 'vitest';
import { answerDelivery, deliveryDifference, needsDeliveryAnswer, reconcileDelivery, resolveDeliveryFacts, type DeliveryFact, type DeliverySource, type IssueLedger } from './issueContinuity';
const target = { parentKey: 'project/cards', orderId: 'DEMO-001', eventId: 'expo' };
const scope = { userId: 'person', accessScope: 'allowed-project-and-sources', allowedParentKeys: [target.parentKey] };
const now = '2026-09-15T01:00:00Z';
const source = (id: string, medium: DeliverySource['medium'], text: string, occurredAt: string): DeliverySource => ({ id, medium, text, occurredAt, ingestedAt: now, access: 'allowed', status: 'ready' });
const sources = [
  source('M1', 'meeting', '展示会用の名刺。DEMO-001を使うexpoでの必要日 2026-09-20', '2026-09-10T01:00:00Z'),
  source('I1', 'image', '注文DEMO-001、expo用の名刺。到着予定 2026-09-16', '2026-09-11T05:00:00Z'),
  source('E1', 'email', '注文DEMO-001、expo用名刺の到着予定が2026-09-21に変更されました。\n前回の到着予定2026-09-16', '2026-09-14T00:00:00Z'),
  source('C1', 'comment', '注文DEMO-001の名刺の受取はAさん。', '2026-09-14T01:00:00Z'),
];
const facts = sources.flatMap(s => resolveDeliveryFacts(proResult.facts[s.id as keyof typeof proResult.facts], s, [target]));
const issue = (ss = sources, ff = facts) => reconcileDelivery(scope, target, ss, ff)!;
const empty = (): IssueLedger => ({ revision: 0, answers: [] });
const request = (premise: string) => ({ revision: 0, premise, operationId: 'hold-cards-001', action: 'hold' as const, answer: '9/17まで待つ。到着予定が変わったら見直す。', reviewAt: '2026-09-17T00:00:00Z' });
function permutations<T>(items: T[]): T[][] { return items.length ? items.flatMap((v, i) => permutations(items.filter((_, j) => j !== i)).map(t => [v, ...t])) : [[]]; }
describe('One delivery issue across media', () => {
  it('converges for all 24 ingestion orders; duplicate source delivery adds no question', () => {
    const expected = issue(); expect(expected.status).toBe('decision'); expect(expected.arrival).toBe('2026-09-21');
    for (const order of permutations(sources)) expect(issue(order.map((s, i) => ({ ...s, ingestedAt: `2026-09-15T0${i}:00:00Z` })))).toEqual(expected);
    expect(issue([...sources, sources[2]], [...facts, facts[2]])).toEqual(expected);
    expect(needsDeliveryAnswer(expected, empty(), scope, now)).toBe(true);
  });
  it('holds one premise across a new source ID, word changes and another client; retries save once', () => {
    const current = issue(); const input = request(current.premise); const held = answerDelivery(empty(), current, scope, input, now);
    const duplicate = source('E1-forwarded', 'email', 'DEMO-001 expoの名刺は2026-09-21到着。', '2026-09-14T01:00:00Z');
    const extra = resolveDeliveryFacts([{ target: 0, field: 'arrival', role: 'assertion', option: 'l1d1' }], duplicate, [target]);
    const repeated = issue([...sources, duplicate], [...facts, ...extra]);
    expect(needsDeliveryAnswer(repeated, JSON.parse(JSON.stringify(held)), scope, now)).toBe(false);
    expect(answerDelivery(held, repeated, scope, input, now)).toEqual(held);
    expect(needsDeliveryAnswer(repeated, held, scope, '2026-09-17T00:00:00Z')).toBe(true);
    expect(() => answerDelivery(held, repeated, scope, { ...input, answer: 'different' }, now)).toThrow('異なる');
  });
  it('reopens only a material premise change and shows the difference; early arrival resolves it', () => {
    const current = issue(); const held = answerDelivery(empty(), current, scope, request(current.premise), now);
    const change = source('E2', 'email', 'DEMO-001 expoの到着予定 2026-09-22', now);
    const changedFact = resolveDeliveryFacts([{ target: 0, field: 'arrival', role: 'assertion', option: 'l1d1' }], change, [target]);
    const changed = issue([...sources, change], [...facts, ...changedFact]);
    expect(needsDeliveryAnswer(changed, held, scope, now)).toBe(true);
    expect(deliveryDifference(changed, held.answers[0])).toContain('2026-09-21 → 2026-09-22');
    const early = { ...change, text: 'DEMO-001 expoの到着予定 2026-09-19' };
    const corrected = issue([...sources, early], [...facts, ...resolveDeliveryFacts([{ target: 0, field: 'arrival', role: 'assertion', option: 'l1d1' }], early, [target])]);
    expect(corrected.status).toBe('resolved'); expect(needsDeliveryAnswer(corrected, held, scope, now)).toBe(false);
    expect(held.answers[0].answer).toContain('9/17');
  });
  it('does not reinterpret quoted old mail as a new decision, or incomplete reads as approval', () => {
    const quoted = source('quote', 'email', '> 前の到着予定 2026-09-16', now);
    expect(resolveDeliveryFacts([{ target: 0, field: 'arrival', role: 'quoted', option: 'l1d1' }], quoted, [target])).toEqual([]);
    for (const partial of [sources.slice(1), sources.map(s => s.id === 'E1' ? { ...s, status: 'unavailable' as const } : s), sources.map(s => ({ ...s, access: 'revoked' as const }))]) {
      const missing = issue(partial); expect(missing.status).toBe('unavailable'); expect(needsDeliveryAnswer(missing, empty(), scope, now)).toBe(false);
    }
    expect(reconcileDelivery({ ...scope, allowedParentKeys: [] }, target, sources, facts)).toBeNull();
  });
  it('separates orders, scopes and simultaneous conflicting facts; corrections remain personal', () => {
    const other: DeliveryFact = { ...facts[2], orderId: 'DEMO-002' };
    expect(issue(sources, [...facts, other])).toEqual(issue());
    const current = issue(); const correction = answerDelivery(empty(), current, scope, { ...request(current.premise), action: 'correct', answer: 'この展示会では使用しない。予定との対応を見直す。', reviewAt: null }, now);
    expect(needsDeliveryAnswer(current, correction, scope, now)).toBe(true);
    expect(correction.answers[0].answer).toContain('使用しない'); expect(correction).not.toHaveProperty('taskPatch');
    expect(() => answerDelivery(correction, current, { ...scope, accessScope: 'revoked-and-reconnected' }, request(current.premise), now)).toThrow();
    const conflicting = source('conflict', 'email', '到着予定 2026-09-23', sources[2].occurredAt);
    expect(issue([...sources, conflicting], [...facts, { ...facts[2], sourceId: conflicting.id, quote: conflicting.text, date: '2026-09-23' }]).status).toBe('unavailable');
  });
});

it('replays the independent Pro semantic result through the isolated issue engine', () => {
 expect(proResult.taskQuestions.A).toEqual([]);expect(proResult.taskQuestions.B).toEqual([]);expect(proResult.taskQuestions.C).toEqual([]);expect(proResult.taskQuestions.D).toHaveLength(1);
 const current=issue();const held=answerDelivery(empty(),current,scope,request(current.premise),now);
 expect(needsDeliveryAnswer(current,empty(),scope,now)).toBe(proResult.askAgain.initial);
 expect(needsDeliveryAnswer(current,held,scope,now)).toBe(proResult.askAgain.heldDuplicate);
 const corrected=source('E2','email','注文DEMO-001、expo用名刺の到着予定を2026-09-19に訂正。','2026-09-16T00:00:00Z');
 const resolved=issue([...sources,corrected],[...facts,...resolveDeliveryFacts(proResult.facts.E2,corrected,[target])]);
 expect(resolved.status).toBe('resolved');expect(needsDeliveryAnswer(resolved,held,scope,'2026-09-16T01:00:00Z')).toBe(proResult.askAgain.correctedArrival);
 const missing=issue(sources.map(s=>s.id==='M1'?{...s,access:'revoked'}:s));
 expect(missing.status).toBe('unavailable');expect(needsDeliveryAnswer(missing,held,scope,now)).toBe(proResult.askAgain.sourceUnavailable);
});
