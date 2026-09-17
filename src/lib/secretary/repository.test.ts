// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actOnSecretary, actOnIncoming, readSecretary, saveReview } from './repository';
import { pendingIncomingCandidates } from './incomingDecisions';
import { incomingNeedsReview } from './incoming';
import type { Interpretation, SecretaryState } from './types';
import { openDescriptionConversation, prepareDescription, actOnDescription, readDescriptionConversation } from '@/lib/ai/descriptionOperations';
import { openReplyDraft, prepareReplyDraft, readReplyDraft } from '@/lib/ai/replyDrafts';
import { explicitDescription } from '@/lib/ai/descriptionOperationTypes';
import { emptyGoogleSource } from '@/lib/google/workspace/types';

const fake = vi.hoisted(() => ({ db: null as unknown, google: false, aiText: '短くした説明', aiHook: null as null | (() => void), aiOptions: null as unknown, failReplyCommit: false, aiCalls: 0, aiTool: false }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getUserAIApiKey: async () => 'test-key' }));
vi.mock('@/lib/google/workspace/security', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/google/workspace/security')>(), isGoogleConfigured: () => fake.google }));
vi.mock('@/lib/google/workspace/oauth', () => ({ connectionRef: (uid: string) => (fake.db as { doc: (s: string) => unknown }).doc(`google/connections/users/${uid}`), cacheRef: (uid: string) => (fake.db as { doc: (s: string) => unknown }).doc(`google/cache/users/${uid}`) }));
vi.mock('@/lib/ai/providers', () => ({ getProvider: () => ({ sendMessage: async function* (_m: unknown, _c: unknown, _k: unknown, _model: unknown, options: unknown) { fake.aiCalls++; fake.aiOptions = options; if (fake.aiTool) { yield { type: 'tool_calls', toolCalls: [] }; return; } fake.aiHook?.(); yield { type: 'text', content: fake.aiText }; } }) }));
type Data = Record<string, unknown>;
let documents: Map<string, Data>;
let serial: Promise<unknown>;
let sequence = 0;
class Ref {
  constructor(public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  get parent(): Collection { return new Collection(this.path.split('/').slice(0, -1).join('/')); }
  collection(name: string) { return new Collection(`${this.path}/${name}`); }
  async get() {
    const data = documents.get(this.path);
    return { id: this.id, ref: this, exists: !!data, data: () => data ? structuredClone(data) : undefined, updateTime: { toMillis: () => Number(data?._version ?? 1) } };
  }
}
class Collection {
  filters: [string, string, unknown][] = [];
  maximum = Infinity;
  constructor(public path: string) {}
  get parent() { return new Ref(this.path.split('/').slice(0, -1).join('/')); }
  doc(id = `generated-${++sequence}`) { return new Ref(`${this.path}/${id}`); }
  where(field: string, operator: string, value: unknown) { this.filters.push([field, operator, value]); return this; }
  limit(count: number) { this.maximum = count; return this; }
  orderBy() { return this; }
  async get() {
    const paths = [...documents.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1)
      .filter(path => this.filters.every(([field, operator, value]) => operator === 'array-contains' ? (documents.get(path)![field] as unknown[])?.includes(value) : documents.get(path)![field] === value)).sort().slice(0, this.maximum);
    const docs = await Promise.all(paths.map(path => new Ref(path).get()));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}
beforeEach(() => {
  documents = new Map(); serial = Promise.resolve(); sequence = 0; fake.google = false; fake.aiText = '短くした説明'; fake.aiHook = null; fake.aiOptions = null; fake.failReplyCommit = false; fake.aiCalls = 0; fake.aiTool = false;
  fake.db = {
    doc: (path: string) => new Ref(path), collection: (path: string) => new Collection(path),
    runTransaction: (fn: (tx: unknown) => Promise<void>) => {
      const operation = serial.then(async () => {
        const writes: { ref: Ref; data: Data; merge: boolean }[] = [];
        const result = await fn({ get: (ref: Ref | Collection) => { if (writes.length) throw new Error('Read after write'); return ref.get(); },
          set: (ref: Ref, data: Data) => writes.push({ ref, data, merge: false }), update: (ref: Ref, data: Data) => writes.push({ ref, data, merge: true }) });
        if (fake.failReplyCommit && writes.some(w => w.ref.path.includes('/messages/reply-'))) { fake.failReplyCommit = false; throw new Error('Reply transaction unavailable'); }
        for (const w of writes) documents.set(w.ref.path, structuredClone(w.merge ? { ...documents.get(w.ref.path), ...w.data } : w.data));
        return result;
      });
      serial = operation.catch(() => undefined);
      return operation;
    },
  };
  documents.set('projects/p', { name: 'Synthetic project', memberIds: ['u', 'v'], isArchived: false });
  documents.set('projects/p/members/u', { userId: 'u', role: 'editor' });
  documents.set('projects/p/members/v', { userId: 'v', role: 'viewer' });
  documents.set('projects/p/lists/work', { name: '作業中' });
  documents.set('projects/p/tasks/t', { title: '架空の原稿', description: '引き受けた原稿です。', listId: 'work', assigneeIds: ['u', 'v'], isCompleted: false, isAbandoned: false, completedAt: null, updatedAt: new Date('2026-09-09T01:00:00Z') });
  documents.set('projects/p/tasks/t/comments/c', { content: '原稿は完成しました。確認済みです。', authorId: 'u', createdAt: new Date('2026-09-10T01:00:00Z') });
});

function addIncoming() {
  fake.google = true;
  documents.set('google/connections/users/u', { epoch: 'e1', email: 'synthetic@1000ri.jp', scopes: [], enabled: ['gmail'], selectedSpaces: [], gmailLabels: [{ id: 'INBOX', name: '受信トレイ' }] });
  documents.set('google/cache/users/u', { epoch: 'e1', sources: { gmail: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: new Date().toISOString(), items: [
    { id: 'm1', title: '原稿', text: '原稿の確認をお願いします', sourceName: '架空の送信者', at: new Date().toISOString(), url: 'https://mail.google.com/mail/#all/t1' },
  ] } } });
}
const incomingOutput = [{ title: '原稿の確認', kind: 'request', reason: '確認依頼が来ています', uncertainties: [], evidence: [{ ref: 'g1', id: 'e1' }], deadline: null, matchedTaskKeys: ['t1'] }];
describe('Incoming review transactional scope', () => {
  async function reviewedIncoming() {
    addIncoming(); const view = await readSecretary('u');
    return saveReview('u', { revision: view.state.revision, signature: view.snapshot.signature }, output, { signature: view.snapshot.incoming!.signature, raw: incomingOutput });
  }
  it('remembers a handled message across candidate regeneration, retries and timestamp refreshes', async () => {
    const view = await reviewedIncoming(); const task = structuredClone(documents.get('projects/p/tasks/t'));
    const request = { kind: 'incoming' as const, action: 'done' as const, revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'incoming-operation-1' };
    const done = await actOnIncoming('u', request);
    expect(pendingIncomingCandidates(done.state, done.snapshot)).toHaveLength(0);
    expect((await actOnIncoming('u', request)).state.revision).toBe(done.state.revision);
    expect(documents.get('projects/p/tasks/t')).toEqual(task);
    const again = await saveReview('u', { revision: done.state.revision, signature: done.snapshot.signature }, undefined, { signature: done.snapshot.incoming!.signature, raw: incomingOutput });
    expect(pendingIncomingCandidates(again.state, again.snapshot)).toHaveLength(0);
    expect(again.state.incomingDecisions).toHaveLength(1);
    const raw = documents.get('users/u/secretary/state') as unknown as SecretaryState;
    raw.incomingReview!.candidates[0].id = 'regenerated-candidate';
    expect((await actOnIncoming('u', request)).state.revision).toBe(again.state.revision);
    documents.get('google/connections/users/u')!.epoch = 'calendar-only-change';
    documents.get('google/cache/users/u')!.epoch = 'calendar-only-change';
    expect((await readSecretary('u')).state.incomingDecisions).toHaveLength(1);
  });
  it('does not silently remove held records at the capacity limit', async () => {
    const view = await reviewedIncoming();
    const held = await actOnIncoming('u', { kind: 'incoming', action: 'hold', revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'capacity-incoming-1' });
    const raw = documents.get('users/u/secretary/state') as unknown as SecretaryState;
    raw.incomingDecisions = Array.from({ length: 80 }, (_, i) => ({ ...held.state.incomingDecisions![0], key: `older-${i}`, scope: `old-scope-${i}` }));
    await expect(actOnIncoming('u', { kind: 'incoming', action: 'done', revision: raw.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'capacity-incoming-2' })).rejects.toThrow('80件');
    expect(raw.incomingDecisions).toHaveLength(80); expect(raw.incomingDecisions.every(d => d.status === 'hold')).toBe(true);
  });
  it('does not apply a previous account decision to the same message ID', async () => {
    const view = await reviewedIncoming();
    await actOnIncoming('u', { kind: 'incoming', action: 'done', revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'account-incoming-1' });
    documents.get('google/connections/users/u')!.email = 'another@1000ri.jp';
    expect((await readSecretary('u')).state.incomingDecisions).toHaveLength(0);
  });
  it('reviews a held message before asking again at a saved check date', async () => {
    const view = await reviewedIncoming();
    await actOnIncoming('u', { kind: 'incoming', action: 'hold', revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'hold-date-incoming-1', reason: '返事が来るまで保留' });
    const raw = documents.get('users/u/secretary/state') as unknown as SecretaryState;
    expect(raw.incomingDecisions![0]).toMatchObject({ status: 'hold', reason: '返事が来るまで保留', reviewAt: null });
    raw.incomingReview!.reviewedAt = new Date(Date.now() - 3000).toISOString();
    raw.incomingDecisions![0].updatedAt = new Date(Date.now() - 2000).toISOString();
    raw.incomingDecisions![0].reviewAt = new Date(Date.now() - 1000).toISOString();
    const due = await readSecretary('u');
    expect(incomingNeedsReview(due.state, due.snapshot)).toBe(true);
    expect(pendingIncomingCandidates(due.state, due.snapshot)).toHaveLength(0);
    const reviewed = await saveReview('u', { revision: due.state.revision, signature: due.snapshot.signature }, undefined, { signature: due.snapshot.incoming!.signature, raw: [] });
    expect(pendingIncomingCandidates(reviewed.state, reviewed.snapshot)).toHaveLength(0);
    expect(incomingNeedsReview(reviewed.state, reviewed.snapshot)).toBe(false);
    expect(reviewed.state.incomingDecisions![0].reason).toBe('返事が来るまで保留');
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(false);
  });
  it('keeps the hold through refreshes and a shared task save; a reviewed new reply can surface only the remaining decision', async () => {
    const view = await reviewedIncoming();
    const held = await actOnIncoming('u', { kind: 'incoming', action: 'hold', revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'hold-reply-incoming-1', reason: '返事が来るまで保留' });
    const original = structuredClone(held.state.incomingDecisions);
    for (let count = 0; count < 3; count++) {
      const refreshed = await readSecretary('u');
      expect(pendingIncomingCandidates(refreshed.state, refreshed.snapshot)).toHaveLength(0);
      expect(refreshed.state.incomingDecisions).toEqual(original);
    }
    documents.get('projects/p/tasks/t')!._version = 2;
    const changed = await readSecretary('u');
    expect(pendingIncomingCandidates(changed.state, changed.snapshot)).toHaveLength(0);
    const reviewed = await saveReview('u', { revision: changed.state.revision, signature: changed.snapshot.signature }, undefined, { signature: changed.snapshot.incoming!.signature, raw: [] });
    expect(pendingIncomingCandidates(reviewed.state, reviewed.snapshot)).toHaveLength(0);
    const cache = documents.get('google/cache/users/u') as { sources: { gmail: { items: { id: string; text: string; at: string }[] } } };
    cache.sources.gmail.items[0] = { ...cache.sources.gmail.items[0], text: '原稿の確認は済みました。公開日を9月20日へ変更してよいですか？', at: new Date().toISOString() };
    const reply = await readSecretary('u');
    expect(pendingIncomingCandidates(reply.state, reply.snapshot)).toHaveLength(0);
    const result = await saveReview('u', { revision: reply.state.revision, signature: reply.snapshot.signature }, undefined, { signature: reply.snapshot.incoming!.signature, raw: [{ ...incomingOutput[0], title: '公開日の変更', reason: '原稿の確認は完了。公開日を9月20日へ変更する判断だけが残っています。' }] });
    expect(pendingIncomingCandidates(result.state, result.snapshot).map(candidate => candidate.title)).toEqual(['公開日の変更']);
    expect(result.state.incomingDecisions).toEqual(original);
  });
  it('hides decisions after revocation without deleting them during another saved review', async () => {
    const view = await reviewedIncoming();
    await actOnIncoming('u', { kind: 'incoming', action: 'hold', revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'incoming-operation-2' });
    const connection = structuredClone(documents.get('google/connections/users/u'))!;
    documents.delete('google/connections/users/u');
    const hidden = await readSecretary('u'); expect(hidden.state.incomingDecisions).toHaveLength(0);
    await saveReview('u', { revision: hidden.state.revision, signature: hidden.snapshot.signature }, output);
    expect((documents.get('users/u/secretary/state') as unknown as SecretaryState).incomingDecisions).toHaveLength(1);
    documents.set('google/connections/users/u', connection);
    expect((await readSecretary('u')).state.incomingDecisions).toHaveLength(1);
    documents.delete('google/connections/users/u');
    const disconnected = await readSecretary('u');
    expect(disconnected.incomingStorage?.heldInactive).toBe(1);
    await actOnIncoming('u', { kind: 'incoming', action: 'forget_inactive', revision: disconnected.state.revision, requestId: 'forget-inactive-1' });
    expect((documents.get('users/u/secretary/state') as unknown as SecretaryState).incomingDecisions).toHaveLength(0);
  });
  it('rejects stale concurrent decisions and supports undo without changing shared work', async () => {
    const view = await reviewedIncoming(); const request = { kind: 'incoming' as const, action: 'hold' as const, revision: view.state.revision, candidateId: view.state.incomingReview!.candidates[0].id, connectionEpoch: 'e1', requestId: 'incoming-operation-3' };
    const saved = await actOnIncoming('u', request);
    await expect(actOnIncoming('u', { ...request, action: 'done', connectionEpoch: 'e1', requestId: 'incoming-operation-4' })).rejects.toThrow('別の操作');
    const restored = await actOnIncoming('u', { kind: 'incoming', action: 'undo', revision: saved.state.revision, decisionKey: saved.state.incomingDecisions![0].key, connectionEpoch: 'e1', requestId: 'incoming-operation-5' });
    expect(pendingIncomingCandidates(restored.state, restored.snapshot)).toHaveLength(1);
  });
  it('saves only personal candidates and preserves real tasks and existing decisions', async () => {
    const initial = await review();
    await actOnSecretary('u', { action: 'next_month', proposalId: initial.state.proposals[0].id, revision: initial.state.revision });
    addIncoming(); const before = await readSecretary('u'); const task = structuredClone(documents.get('projects/p/tasks/t'));
    const after = await saveReview('u', { revision: before.state.revision, signature: before.snapshot.signature }, output, { signature: before.snapshot.incoming!.signature, raw: incomingOutput });
    expect(after.state.incomingReview?.candidates).toHaveLength(1);
    expect(after.state.decisions[0].disposition).toBe('hold');
    expect(documents.get('projects/p/tasks/t')).toEqual(task);
    expect([...documents.keys()].some(k => k.includes('activityLogs/'))).toBe(false);
    expect((await readSecretary('v')).state.incomingReview).toBeUndefined();
  });
  it('rejects a selection change during generation and hides old candidates after permission removal', async () => {
    addIncoming(); const before = await readSecretary('u');
    const saved = await saveReview('u', { revision: before.state.revision, signature: before.snapshot.signature }, output, { signature: before.snapshot.incoming!.signature, raw: incomingOutput });
    const connection = documents.get('google/connections/users/u')!;
    documents.set('google/connections/users/u', { ...connection, epoch: 'e2', gmailLabels: [] });
    await expect(saveReview('u', { revision: saved.state.revision, signature: saved.snapshot.signature }, output, { signature: saved.snapshot.incoming!.signature, raw: incomingOutput })).rejects.toThrow('取得範囲');
    expect((await readSecretary('u')).state.incomingReview).toBeUndefined();
    documents.set('google/connections/users/u', connection);
    expect((await readSecretary('u')).state.incomingReview?.candidates).toHaveLength(1);
    documents.delete('projects/p/members/u');
    expect((await readSecretary('u')).state.incomingReview).toBeUndefined();
  });
  it('a timestamp-only refresh reuses candidates; changed text invalidates them', async () => {
    addIncoming(); const before = await readSecretary('u');
    const saved = await saveReview('u', { revision: before.state.revision, signature: before.snapshot.signature }, output, { signature: before.snapshot.incoming!.signature, raw: incomingOutput });
    const cache = documents.get('google/cache/users/u') as { sources: { gmail: { fetchedAt: string; items: { text: string }[] } } };
    cache.sources.gmail.fetchedAt = new Date(Date.now() - 60000).toISOString();
    expect((await readSecretary('u')).state.incomingReview?.signature).toBe(saved.state.incomingReview?.signature);
    cache.sources.gmail.items[0].text = '確認は済みました';
    expect((await readSecretary('u')).state.incomingReview).toBeUndefined();
  });
  it('can persist incoming alone without marking task review successful or replacing proposals', async () => {
    await review(); addIncoming(); const before = await readSecretary('u');
    const after = await saveReview('u', { revision: before.state.revision, signature: before.snapshot.signature }, undefined, { signature: before.snapshot.incoming!.signature, raw: incomingOutput });
    expect(after.state.incomingReview?.candidates).toHaveLength(1);
    expect(after.state.proposals).toEqual(before.state.proposals);
    expect(after.state.observedSignature).toBe(before.state.observedSignature);
    expect(after.state.reviewedAt).toBe(before.state.reviewedAt);
  });
});
const output: Interpretation[] = [{ key: 'p/t', speech: 'progress', commitment: 'confirmed', disposition: 'complete', reason: '完成したとの報告があります。', trigger: '', review: null, uncertainties: [], evidence: [{ source: 'c', quote: '原稿は完成しました。確認済みです。' }], duplicateOf: null, estimateMinutes: null }];
async function review(uid = 'u') {
  const view = await readSecretary(uid);
  return saveReview(uid, { revision: view.state.revision, signature: view.snapshot.signature }, output);
}
describe('Secretary shared deadline changes', () => {
  it('does not write a deadline before the registered start or move that start', async () => {
    documents.get('projects/p/tasks/t')!.startDate = new Date('2026-09-15T00:00:00Z');
    const view = await review(); const before = structuredClone([...documents]);
    await expect(actOnSecretary('u', { action: 'reschedule', proposalId: view.state.proposals[0].id, revision: view.state.revision, dueDate: '2026-09-12' })).rejects.toMatchObject({ code: 'INVALID', message: expect.stringContaining('開始日より前') });
    expect([...documents]).toEqual(before);
  });
  it('atomically changes the schedule and records the dated change without altering completion, comments or other data', async () => {
    Object.assign(documents.get('projects/p/tasks/t')!, { startDate: new Date('2026-09-14T14:00:00Z'), dueDate: new Date('2026-09-17T00:00:00Z'), durationDays: 4, isDueDateFixed: false, customField: 'preserved' });
    const view = await review(); const beforeTask = structuredClone(documents.get('projects/p/tasks/t'))!;
    const beforeComment = structuredClone(documents.get('projects/p/tasks/t/comments/c'));
    const saved = await actOnSecretary('u', { action: 'reschedule', proposalId: view.state.proposals[0].id, revision: view.state.revision, dueDate: '2026-09-21' });
    expect(documents.get('projects/p/tasks/t')).toEqual({ ...beforeTask, dueDate: new Date('2026-09-21T00:00:00Z'), durationDays: 8, isDueDateFixed: true,
      updatedAt: expect.any(Date), secretaryMutationId: expect.any(String) });
    expect(documents.get('projects/p/tasks/t/comments/c')).toEqual(beforeComment);
    expect(saved.snapshot.tasks[0]).toMatchObject({ dueDate: '2026-09-21T00:00:00.000Z', durationDays: 8, isDueDateFixed: true, isCompleted: false });
    const log = [...documents].find(([key]) => key.includes('/activityLogs/'))![1];
    expect(log.changes).toContainEqual({ field: 'dueDate', oldValue: '2026-09-17T00:00:00.000Z', newValue: '2026-09-21T00:00:00.000Z' });
    expect(saved.state.history.at(-1)).toMatchObject({ action: 'reschedule', beforeTask: { dueDate: '2026-09-17T00:00:00.000Z', durationDays: 4, isDueDateFixed: false } });
    expect(fake.aiCalls).toBe(0);
  });
  it('undoes a date change after re-review without clearing or rewriting completion fields', async () => {
    Object.assign(documents.get('projects/p/tasks/t')!, { dueDate: new Date('2026-09-10T00:00:00Z'), durationDays: 4, isDueDateFixed: false });
    const view = await review(); const p = view.state.proposals[0];
    const saved = await actOnSecretary('u', { action: 'reschedule', proposalId: p.id, revision: view.state.revision, dueDate: '2026-10-01' });
    const reviewed = await saveReview('u', { revision: saved.state.revision, signature: saved.snapshot.signature }, output);
    expect(reviewed.state.proposals[0].id).not.toBe(p.id);
    const restored = await actOnSecretary('u', { action: 'undo', proposalId: p.id, revision: reviewed.state.revision });
    expect(documents.get('projects/p/tasks/t')).toMatchObject({ dueDate: new Date('2026-09-10T00:00:00Z'), durationDays: 4, isDueDateFixed: false, isCompleted: false, completedAt: null });
    expect(restored.state.history.at(-1)!.undone).toBe(true);
    expect(restored.state.decisions).toEqual([]);
  });
  it.each(['description', 'dueDate', 'comment', 'permission'])('does not undo over a later %s change', async field => {
    const view = await review(); const p = view.state.proposals[0];
    const saved = await actOnSecretary('u', { action: 'reschedule', proposalId: p.id, revision: view.state.revision, dueDate: '2026-09-21' });
    if (field === 'comment') documents.get('projects/p/tasks/t/comments/c')!.content = '後から追記しました。';
    else if (field === 'permission') documents.get('projects/p/members/u')!.role = 'viewer';
    else documents.get('projects/p/tasks/t')![field] = field === 'dueDate' ? new Date('2026-10-10T00:00:00Z') : '別の人が編集';
    const before = structuredClone([...documents]);
    await expect(actOnSecretary('u', { action: 'undo', proposalId: p.id, revision: saved.state.revision })).rejects.toThrow('採用後');
    expect([...documents]).toEqual(before);
  });
  it('rejects rescheduling for a viewer and after source, permission or allowed-project changes', async () => {
    const viewer = await review('v');
    await expect(actOnSecretary('v', { action: 'reschedule', proposalId: viewer.state.proposals[0].id, revision: viewer.state.revision, dueDate: '2026-09-21' })).rejects.toThrow('編集権限');
    const view = await review(); const request = { action: 'reschedule' as const, proposalId: view.state.proposals[0].id, revision: view.state.revision, dueDate: '2026-09-21' };
    const before = structuredClone(documents.get('projects/p/tasks/t'))!;
    documents.get('projects/p/tasks/t')!.description = '後から編集';
    await expect(actOnSecretary('u', request)).rejects.toThrow('更新');
    documents.set('projects/p/tasks/t', before);
    documents.get('projects/p/members/u')!.role = 'viewer';
    await expect(actOnSecretary('u', request)).rejects.toThrow();
    documents.get('projects/p/members/u')!.role = 'editor';
    documents.set('users/u/settings/aiSettings', { allowedProjectIds: [] });
    await expect(actOnSecretary('u', request)).rejects.toThrow('アクセス');
    expect(documents.get('projects/p/tasks/t')).toEqual(before);
  });
});
describe('Goal context and freshness', () => {
  function goals() {
    documents.get('projects/p')!.description = '公開申込を受け付ける';
    Object.assign(documents.get('projects/p/tasks/t')!, { parentTaskId: 'parent', milestoneId: 'launch', taskKind: 'review_request', sourceCommentTaskId: 'parent', sourceCommentId: 'request' });
    documents.set('projects/p/tasks/parent', { title: '公開準備', description: '原稿を確認して公開', assigneeIds: [], isCompleted: false });
    documents.set('projects/p/milestones/launch', { title: '申込公開', description: '申込ページが利用できる', status: 'planned', dueDate: null });
  }
  it('keeps unset goals valid and resolves only direct references', async () => {
    expect((await readSecretary('u')).snapshot.tasks[0].context?.milestoneState).toBe('unset');
    goals(); const view = await readSecretary('u'); const task = view.snapshot.tasks.find(t => t.taskId === 't')!;
    expect(view.snapshot.coverage.status).toBe('ready');
    expect(task.context).toMatchObject({ projectDescription: '公開申込を受け付ける', parentState: 'ready', milestoneState: 'ready', taskKind: 'review_request', sourceComment: { taskId: 'parent', commentId: 'request' } });
  });
  it.each(['project', 'parent', 'milestone'])('invalidates a proposal when only %s context changes', async kind => {
    goals(); const before = await review(); const task = before.snapshot.tasks.find(t => t.taskId === 't')!;
    const path = kind === 'project' ? 'projects/p' : kind === 'parent' ? 'projects/p/tasks/parent' : 'projects/p/milestones/launch';
    documents.get(path)!.description = '達成条件を変更';
    const after = await readSecretary('u'); expect(after.snapshot.tasks.find(t => t.taskId === 't')!.version).not.toBe(task.version);
    await expect(actOnSecretary('u', { action: 'accept', proposalId: before.state.proposals[0].id, revision: before.state.revision })).rejects.toThrow('更新');
    await expect(saveReview('u', { revision: before.state.revision, signature: before.snapshot.signature }, output)).rejects.toThrow('変わりました');
  });
  it('does not invalidate on an unrelated milestone and reports missing references', async () => {
    goals(); const before = await readSecretary('u');
    documents.set('projects/p/milestones/other', { description: '別の節目' });
    expect((await readSecretary('u')).snapshot.signature).toBe(before.snapshot.signature);
    documents.delete('projects/p/milestones/launch');
    const missing = await readSecretary('u'); expect(missing.snapshot.coverage.status).toBe('partial');
    expect(missing.snapshot.tasks.find(t => t.taskId === 't')!.context?.milestoneState).toBe('missing');
  });
  it('does not spend the milestone read budget on other people\'s work', async () => {
    goals();
    for (let i = 0; i < 61; i++) documents.set(`projects/p/tasks/other-${i}`, { title: '他の仕事', assigneeIds: [], milestoneId: `other-${i}` });
    const view = await readSecretary('u');
    expect(view.snapshot.coverage.status).toBe('ready');
    expect(view.snapshot.tasks.find(t => t.taskId === 't')!.context?.milestoneState).toBe('ready');
  });
});
describe('Secretary Firestore adapter with isolated transactional store', () => {
  it('persists a proposal without mutating the task, then atomically applies and restores it', async () => {
    let view = await review();
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(false);
    expect(documents.has('users/u/secretary/state')).toBe(true);
    const id = view.state.proposals[0].id;
    view = await actOnSecretary('u', { action: 'complete', proposalId: id, revision: view.state.revision });
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(true);
    expect(view.state.history[0].afterVersion).toBe(view.snapshot.tasks[0].version);
    expect([...documents.keys()].filter(k => k.includes('activityLogs/'))).toHaveLength(1);
    await actOnSecretary('u', { action: 'undo', proposalId: id, revision: view.state.revision });
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(false);
    expect(documents.get('projects/p/tasks/t')!.completedAt).toBeNull();
  });
  it('two concurrent adoptions produce exactly one shared transition and one conflict', async () => {
    const view = await review(); const req = { action: 'complete' as const, proposalId: view.state.proposals[0].id, revision: view.state.revision };
    const results = await Promise.allSettled([actOnSecretary('u', req), actOnSecretary('u', req)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([...documents.keys()].filter(k => k.includes('activityLogs/'))).toHaveLength(1);
  });
  it('rejects stale evidence when a reply arrives during model generation', async () => {
    const before = await readSecretary('u');
    documents.set('projects/p/tasks/t/comments/new', { content: '追加修正が必要です。', createdAt: new Date(), authorId: 'u' });
    await expect(saveReview('u', { revision: 0, signature: before.snapshot.signature }, output)).rejects.toThrow('整理中');
    expect(documents.has('users/u/secretary/state')).toBe(false);
  });
  it('requires both membership sources and enforces project-specific AI grants', async () => {
    await review();
    documents.set('users/u/settings/aiSettings', { allowedProjectIds: [] });
    let view = await readSecretary('u'); expect(view.snapshot.tasks).toHaveLength(0); expect(view.state.proposals).toHaveLength(0);
    documents.delete('users/u/settings/aiSettings'); documents.delete('projects/p/members/u');
    view = await readSecretary('u'); expect(view.snapshot.tasks).toHaveLength(0); expect(view.state.history).toHaveLength(0);
  });
  it('does not leak another user proposals or accept a viewer shared change', async () => {
    const owner = await review(); const viewer = await readSecretary('v');
    expect(viewer.state.proposals).toHaveLength(0);
    await expect(actOnSecretary('v', { action: 'complete', proposalId: owner.state.proposals[0].id, revision: 0 })).rejects.toThrow('アクセス');
    const proposed = await review('v');
    await expect(actOnSecretary('v', { action: 'complete', proposalId: proposed.state.proposals[0].id, revision: proposed.state.revision })).rejects.toThrow('編集権限');
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(false);
  });
  it('undo rejects edits even in unrelated task fields and preserves that edit', async () => {
    const view = await review(); const id = view.state.proposals[0].id;
    const applied = await actOnSecretary('u', { action: 'complete', proposalId: id, revision: view.state.revision });
    documents.set('projects/p/tasks/t', { ...documents.get('projects/p/tasks/t'), labelIds: ['new-label'] });
    await expect(actOnSecretary('u', { action: 'undo', proposalId: id, revision: applied.state.revision })).rejects.toThrow('採用後');
    expect(documents.get('projects/p/tasks/t')!.labelIds).toEqual(['new-label']);
  });
  it('fails closed on corrupt grants rather than broadening AI access', async () => {
    documents.set('users/u/settings/aiSettings', { allowedProjectIds: 'all' });
    await expect(readSecretary('u')).rejects.toThrow('AIアクセス');
  });
  it('retains personal holds separately from the original task and isolates revisions by user', async () => {
    const view = await review();
    await actOnSecretary('u', { action: 'next_week', proposalId: view.state.proposals[0].id, revision: view.state.revision });
    const state = documents.get('users/u/secretary/state') as unknown as SecretaryState;
    expect(state.decisions[0].disposition).toBe('hold');
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(false);
    expect((await readSecretary('v')).state.revision).toBe(0);
  });
});


describe('Single description server operation', () => {
  it('only accepts a whole exact instruction for automatic approval', () => {
    expect(explicitDescription('説明を「そのまま\n保存」に変更して')).toBe('そのまま\n保存');
    expect(explicitDescription('説明を「」に変更して')).toBe('');
    for (const text of ['引用: 説明を「内容」に変更して', '説明を「内容」に変更して。完了にもして', '説明を「内容」に変更して\n別の仕事も変更して', '説明を短くして']) expect(explicitDescription(text)).toBeNull();
  });
  it('saves exact instruction, recovers the same result and never reapplies after undo', async () => {
    await openDescriptionConversation('u', 'p', 't', 'conversation-1');
    const view = await prepareDescription('u', 'conversation-1', 'input-1', '説明を「確定した説明」に変更して', 'gemini');
    const op = view.messages.find(m => m.operation)!.operation!;
    expect(op.state).toBe('applied'); expect(fake.aiOptions).toBeNull();
    expect(documents.get('projects/p/tasks/t')!.description).toBe('確定した説明');
    const logCount = [...documents.keys()].filter(k => k.includes('/activityLogs/')).length;
    await prepareDescription('u', 'conversation-1', 'input-1', '説明を「確定した説明」に変更して', 'gemini');
    expect([...documents.keys()].filter(k => k.includes('/activityLogs/')).length).toBe(logCount);
    await actOnDescription('u', 'p', 't', op.id, 'undo');
    await actOnDescription('u', 'p', 't', op.id, 'undo');
    expect((await actOnDescription('u', 'p', 't', op.id, 'apply')).state).toBe('undone');
    expect(documents.get('projects/p/tasks/t')!.description).toBe('引き受けた原稿です。');
  });
  it('requires confirmation for generated text, preserves other fields, and blocks stale undo', async () => {
    await openDescriptionConversation('u', 'p', 't', 'conversation-1');
    const before = structuredClone(documents.get('projects/p/tasks/t'))!;
    const view = await prepareDescription('u', 'conversation-1', 'input-1', '説明を短く整理して', 'gemini');
    const op = view.messages.find(m => m.operation)!.operation!;
    expect(documents.get('projects/p/tasks/t')).toEqual(before);
    expect(fake.aiOptions).toMatchObject({ enableTools: false });
    await expect(actOnDescription('u', 'p', 't', op.id, 'apply')).rejects.toThrow('変更前後');
    await actOnDescription('u', 'p', 't', op.id, 'confirm');
    expect(documents.get('projects/p/tasks/t')!.isCompleted).toBe(before.isCompleted);
    documents.get('projects/p/tasks/t')!.title = '後続の編集';
    await expect(actOnDescription('u', 'p', 't', op.id, 'undo')).rejects.toThrow('更新');
    await expect(prepareDescription('u', 'conversation-1', 'input-1', '違う入力', 'gemini')).rejects.toThrow('内容');
  });
  it('checks membership, AI permission, stored source and changes during generation', async () => {
    await expect(openDescriptionConversation('v', 'p', 't', 'viewer')).rejects.toThrow('権限');
    await openDescriptionConversation('u', 'p', 't', 'conversation-1');
    fake.aiHook = () => { documents.get('projects/p/tasks/t')!.description = '他者の編集'; };
    await expect(prepareDescription('u', 'conversation-1', 'input-1', '説明を短くして', 'gemini')).rejects.toThrow('生成中');
    expect(documents.get('projects/p/tasks/t')!.description).toBe('他者の編集');
    fake.aiHook = null;
    await expect(prepareDescription('u', 'conversation-1', 'input-1', '説明を短くして', 'gemini')).rejects.toThrow('新しい依頼');
    documents.set('users/u/settings/aiSettings', { allowedProjectIds: [] });
    await expect(readDescriptionConversation('u', 'conversation-1')).rejects.toThrow('権限');
    documents.set('users/u/settings/aiSettings', { allowedProjectIds: 'p' });
    await expect(readDescriptionConversation('u', 'conversation-1')).rejects.toThrow('設定');
  });
});


describe('Internal Gmail reply drafts', () => {
  async function reviewedMail() {
    addIncoming(); const view = await readSecretary('u');
    return saveReview('u', { revision: view.state.revision, signature: view.snapshot.signature }, undefined, { signature: view.snapshot.incoming!.signature, raw: incomingOutput });
  }
  async function openMail() {
    const view = await reviewedMail();
    return openReplyDraft('u', 'm1', view.state.incomingReview!.candidates[0].id, view.snapshot.incoming!.signature, 'gemini');
  }
  it('saves actual draft, source and dates together, reopens without regeneration and never marks handled', async () => {
    const view = await openMail();
    expect(view.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    expect(view.sourceUrl).toBe('https://mail.google.com/mail/#all/t1');
    expect(fake.aiOptions).toMatchObject({ enableTools: false });
    const before = structuredClone(documents.get('projects/p/tasks/t'));
    const again = await openReplyDraft('u', 'm1', 'regenerated-id', 'stale-signature', 'gemini');
    expect(again).toEqual(view); expect(fake.aiCalls).toBe(1);
    expect(documents.get('projects/p/tasks/t')).toEqual(before);
    expect((await readSecretary('u')).state.incomingDecisions).toHaveLength(0);
    await expect(readReplyDraft('v', view.conversationId)).rejects.toThrow('接続');
    documents.delete('google/connections/users/u');
    await expect(readReplyDraft('u', view.conversationId)).rejects.toThrow('接続');
  });
  it('retains generated body on atomic save failure and retries exactly once without regenerating', async () => {
    const reviewed = await reviewedMail(); fake.failReplyCommit = true;
    await expect(openReplyDraft('u', 'm1', reviewed.state.incomingReview!.candidates[0].id, reviewed.snapshot.incoming!.signature, 'gemini')).rejects.toThrow('保存');
    const conversationId = [...documents.keys()].find(k => k.startsWith('users/u/conversations/') && !k.includes('/messages/'))!.split('/').at(-1)!;
    const failed = await readReplyDraft('u', conversationId);
    expect(failed.messages).toHaveLength(1); expect(failed.messages[0].retry).toBe(true);
    const saved = await prepareReplyDraft('u', conversationId, failed.messages[0].id, failed.messages[0].content, 'gemini');
    expect(saved.messages).toHaveLength(2); expect(fake.aiCalls).toBe(1);
    await prepareReplyDraft('u', conversationId, failed.messages[0].id, failed.messages[0].content, 'gemini');
    expect(fake.aiCalls).toBe(1);
    await expect(prepareReplyDraft('u', conversationId, failed.messages[0].id, '入力の偽装', 'gemini')).rejects.toThrow('内容');
  });
  it('checks each saved draft basis and refuses editing an old mail after a newer reply', async () => {
    const view = await openMail();
    const cache = documents.get('google/cache/users/u') as { sources: { gmail: { items: { id: string; at: string; text: string; url: string }[] } } };
    cache.sources.gmail.items[0].text = '原稿を取り下げます';
    expect((await readReplyDraft('u', view.conversationId)).sourceWarning).toContain('変更');
    await prepareReplyDraft('u', view.conversationId, 'request-2', '取り下げを確認する返信にして', 'gemini');
    const changed = await readReplyDraft('u', view.conversationId);
    expect(changed.messages.filter(m => m.role === 'assistant')[0].sourceWarning).toContain('変更');
    cache.sources.gmail.items.push({ ...cache.sources.gmail.items[0], id: 'm2', at: new Date(Date.now() + 1000).toISOString(), text: '先ほどの依頼を取り消します' });
    await expect(prepareReplyDraft('u', view.conversationId, 'request-3', '短くして', 'gemini')).rejects.toThrow('最新のメール');
  });
  it('does not rebase failed input onto a later draft and can recreate an explicitly deleted conversation', async () => {
    const view = await openMail(); fake.failReplyCommit = true;
    await expect(prepareReplyDraft('u', view.conversationId, 'request-a', '短くして', 'gemini')).rejects.toThrow('保存');
    await prepareReplyDraft('u', view.conversationId, 'request-b', '敬語を整えて', 'gemini');
    await expect(prepareReplyDraft('u', view.conversationId, 'request-a', '短くして', 'gemini')).rejects.toThrow('別の返信案');
    for (const key of [...documents.keys()]) if (key.startsWith(`users/u/conversations/${view.conversationId}`)) documents.delete(key);
    const reviewed = await readSecretary('u');
    const recreated = await openReplyDraft('u', 'm1', reviewed.state.incomingReview!.candidates[0].id, reviewed.snapshot.incoming!.signature, 'gemini');
    expect(recreated.messages).toHaveLength(2);
    expect(recreated.messages[0].id).not.toBe(view.messages[0].id);
  });
  it('rejects tool calls, keeps saved input and stops permission loss during generation', async () => {
    const view = await openMail(); fake.aiTool = true;
    await expect(prepareReplyDraft('u', view.conversationId, 'request-2', 'メールを送って', 'gemini')).rejects.toThrow('以外');
    expect((await readReplyDraft('u', view.conversationId)).messages.find(m => m.id === 'request-2')?.retry).toBe(true);
    fake.aiTool = false; fake.aiHook = () => { documents.delete('google/connections/users/u'); };
    await expect(prepareReplyDraft('u', view.conversationId, 'request-3', '短くして', 'gemini')).rejects.toThrow('接続');
    expect(documents.has(`users/u/conversations/${view.conversationId}/messages/reply-request-3`)).toBe(false);
  });
});

it('reads a parent review and its original conversation without needing a child document',async()=>{
 const at='2026-09-14T00:00:00.000Z';documents.get('projects/p/tasks/t')!.reviewRequests={'review-c':{commentId:'c',assigneeIds:['u'],dueDate:null,createdBy:'u',createdAt:at,updatedAt:at,cycle:{policy:'all',round:1,request:'原稿を確認',attachments:[],requestedAt:at,responses:{}}}};
 const view=await readSecretary('u');const review=view.snapshot.tasks.find(t=>t.taskId==='review-c');
 expect(review).toMatchObject({assigneeIds:['u'],isCompleted:false,context:{taskKind:'review_request',sourceComment:{taskId:'t',commentId:'c'}}});expect(review!.comments[0].id).toBe('c');expect(documents.has('projects/p/tasks/review-c')).toBe(false);
});

it('does not let an AI completion bypass a pending parent review',async()=>{
 const at='2026-09-14T00:00:00.000Z';documents.get('projects/p/tasks/t')!.reviewRequests={'review-c':{commentId:'c',assigneeIds:['v'],dueDate:null,createdBy:'u',createdAt:at,updatedAt:at,cycle:{policy:'all',round:1,request:'確認',attachments:[],requestedAt:at,responses:{}}}};
 const loaded=await readSecretary('u');const view=await saveReview('u',{revision:loaded.state.revision,signature:loaded.snapshot.signature},output);const proposal=view.state.proposals.find(p=>p.key==='p/t')!;
 const before=structuredClone([...documents]);await expect(actOnSecretary('u',{action:'complete',proposalId:proposal.id,revision:view.state.revision})).rejects.toThrow('返答');expect([...documents]).toEqual(before);
});

it('includes checklist completion in the shared evidence version and refuses a stale write', async () => {
 documents.set('projects/p/tasks/t/checklists/l',{title:'準備',order:0,items:[{id:'a',text:'持ちもの',isChecked:false}]});
 const first=await readSecretary('u');
 expect(first.snapshot.tasks[0]).toMatchObject({checklistStatus:'ready',checklists:[{id:'l',items:[{isChecked:false}]}]});
 const reviewed=await saveReview('u',{revision:first.state.revision,signature:first.snapshot.signature},output);
 documents.get('projects/p/tasks/t/checklists/l')!.items=[{id:'a',text:'持ちもの',isChecked:true}];
 const updated=await readSecretary('u');
 expect(updated.snapshot.tasks[0].version).not.toBe(first.snapshot.tasks[0].version);
 await expect(actOnSecretary('u',{action:'accept',proposalId:reviewed.state.proposals[0].id,revision:reviewed.state.revision})).rejects.toThrow();
});
it.each([{items:Array.from({length:101},(_,i)=>({id:String(i),text:'項目',isChecked:false}))},{items:[{id:'a',text:'項目'}]}])('marks truncated or malformed checklists unavailable', async ({items})=>{
 documents.set('projects/p/tasks/t/checklists/l',{title:'準備',items});
 const v=await readSecretary('u');expect(v.snapshot.tasks[0].checklistStatus).toBe('unavailable');expect(v.snapshot.tasks[0].complete).toBe(false);
});

it('reschedules ordinary work without an AI proposal, and can undo through the same history',async()=>{
 const before=await readSecretary('u');expect(before.state.proposals).toHaveLength(0);
 const task=before.snapshot.tasks[0];const request={action:'reschedule' as const,proposalId:'manual-operation-1',revision:before.state.revision,taskKey:task.key,sourceVersion:task.version,dueDate:'2026-10-01'};
 const saved=await actOnSecretary('u',request);expect(saved.state.proposals).toHaveLength(0);
 expect(saved.snapshot.tasks[0].dueDate).toContain('2026-10-01');
 const undone=await actOnSecretary('u',{action:'undo',proposalId:request.proposalId,revision:saved.state.revision});
 expect(undone.snapshot.tasks[0].dueDate).toBe(task.dueDate);
});
it('dismisses only the personal candidate and rejects stale or unauthorized direct actions',async()=>{
 const v=await readSecretary('u');const t=v.snapshot.tasks[0];const before=structuredClone(documents.get('projects/p/tasks/t'));
 const request={action:'unneeded' as const,proposalId:'manual-operation-2',revision:v.state.revision,taskKey:t.key,sourceVersion:t.version};
 const saved=await actOnSecretary('u',request);expect(documents.get('projects/p/tasks/t')).toEqual(before);expect(saved.state.decisions[0].disposition).toBe('unneeded');
 await expect(actOnSecretary('u',{...request,proposalId:'different',revision:saved.state.revision,sourceVersion:'old'})).rejects.toThrow();
 await expect(actOnSecretary('u',{...request,action:'complete',proposalId:'different',revision:saved.state.revision})).rejects.toThrow();
 documents.get('projects/p/tasks/t')!.assigneeIds=['v'];
 const other=await readSecretary('u');await expect(actOnSecretary('u',{...request,proposalId:'different',revision:other.state.revision,sourceVersion:other.snapshot.tasks[0].version})).rejects.toThrow();
});
