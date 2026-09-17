// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretIncoming, INCOMING_PROMPT, INCOMING_CHECK_PROMPT, validateIncoming } from './interpretIncoming';
import { incomingMessages, incomingNeedsReview } from './incoming';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
import { createMockSecretary, mockView } from './mock';
import { emptySecretaryState } from './types';
const ai = vi.hoisted(() => ({ key: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getUserAIApiKey: ai.key }));
vi.mock('@/lib/ai/providers', () => ({ getProvider: () => ({ sendMessage: ai.send }) }));
const now = '2026-09-10T10:00:00.000Z';
function source() {
  const snapshot = mockView(createMockSecretary('u', now), 'u', now).snapshot;
  snapshot.incoming = { signature: 'incoming-v1', email: 'synthetic@1000ri.jp', selections: { gmail: ['受信トレイ'], chat: ['架空スペース'] }, sources: {
    gmail: { connected: true, status: 'partial', fetchedAt: now, attemptedAt: now, error: '部分取得', items: [
      { id: 'm1', title: '原稿の確認依頼', text: '9月12日までに確認をお願いします。', sourceName: '架空の送信者', at: now, url: 'https://mail.google.com/mail/#all/thread1' },
    ] }, chat: emptyGoogleSource(),
  } };
  return snapshot;
}
const candidate = () => ({ title: '原稿の確認状況を確認', kind: 'reply', reason: '原稿への返信が必要か確認します。', uncertainties: ['返信済みか未確認'],
  evidence: [{ ref: 'g1', id: 'e1' }], deadline: { ref: 'g1', id: 'd1' }, matchedTaskKeys: [] });
beforeEach(() => { vi.resetAllMocks(); ai.key.mockResolvedValue('synthetic-key'); });
describe('Google incoming candidate evidence and LLM boundary', () => {
  it('restores source quotes and links, validates task matches, and deduplicates identical evidence sets', () => {
    const snapshot = source(); const raw = { ...candidate(), matchedTaskKeys: ['t1'] };
    const result = validateIncoming([raw, raw], snapshot);
    expect(result).toHaveLength(1);
    expect(result[0].evidence[0]).toMatchObject({ service: 'gmail', id: 'm1', quote: '原稿の確認依頼\n9月12日までに確認をお願いします。', url: 'https://mail.google.com/mail/#all/thread1' });
    expect(result[0].deadline).toBe('9月12日'); expect(result[0].matchedTaskKeys).toEqual([snapshot.tasks[0].key]);
  });
  it('rejects invented quotes, references, deadlines, inaccessible tasks and unsafe links', () => {
    const snapshot = source();
    for (const changed of [
      { evidence: [{ ref: 'g1', id: 'e1', quote: '偽の承認' }] }, { evidence: [{ ref: 'chat:m1', id: 'e1' }] },
      { evidence: [{ ref: 'g1', id: 'e99' }] }, { deadline: '2026-09-12' }, { deadline: { ref: 'g1', id: 'd99' } }, { matchedTaskKeys: ['private/hidden'] }, { url: 'https://untrusted.example/' },
    ]) expect(() => validateIncoming([{ ...candidate(), ...changed }], snapshot)).toThrow('AI応答');
    snapshot.incoming!.sources.gmail.items[0].url = 'https://mail.google.com.evil.example/';
    expect(() => validateIncoming([candidate()], snapshot)).toThrow('AI応答');
  });
  it('excludes disconnected, failed, pending, unselected and expired cached text instead of declaring zero work', async () => {
    for (const status of ['error', 'pending', 'disconnected', 'selection_required'] as const) {
      const snapshot = source(); snapshot.incoming!.sources.gmail.status = status;
      expect(incomingMessages(snapshot)).toEqual([]);
      expect(incomingNeedsReview(emptySecretaryState(), snapshot)).toBe(false);
      await expect(interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).resolves.toEqual([]);
    }
    const snapshot = source(); snapshot.incoming!.sources.gmail.fetchedAt = '2026-09-10T06:00:00.000Z';
    expect(incomingMessages(snapshot)).toEqual([]); expect(ai.send).not.toHaveBeenCalled();
  });
  it('bounds and deduplicates inputs, reports partial scope, and never enables tools', async () => {
    const snapshot = source(); const item = snapshot.incoming!.sources.gmail.items[0];
    snapshot.incoming!.sources.gmail.items = Array.from({ length: 90 }, (_, i) => ({ ...item, id: `m${i}`, text: 'x'.repeat(4000) }));
    snapshot.incoming!.sources.gmail.items.push(item);
    ai.send.mockImplementation(async function* () { yield { type: 'text', content: '[]' }; });
    await interpretIncoming(snapshot, emptySecretaryState(), 'gemini', 'configured-model');
    const args = ai.send.mock.calls[0]; const input = JSON.parse(args[0][0].content);
    expect(input.messages).toHaveLength(60); expect(input.messages[0].options).toHaveLength(6);
    expect(input.sources.gmail).toMatchObject({ status: 'partial', analyzedCount: 60, cachedCount: 91 });
    expect(args[3]).toBe('configured-model'); expect(args[4]).toMatchObject({ enableTools: false, systemPrompt: INCOMING_PROMPT });
    expect(input).not.toHaveProperty('credentials');
  });
  it('fails closed on tool calls, provider failure or invalid JSON without a canned replacement', async () => {
    const snapshot = source();
    ai.send.mockImplementation(async function* () { yield { type: 'tool_calls', toolCalls: [] }; });
    await expect(interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).rejects.toThrow('保存済み');
    ai.send.mockImplementation(async function* () { yield { type: 'text', content: 'not JSON' }; });
    await expect(interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).rejects.toThrow('保存済み');
    ai.key.mockResolvedValue(null);
    await expect(interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).rejects.toThrow('未接続');
  });
  it('reuses a review only for the exact current source signature', () => {
    const snapshot = source(); const state = { ...emptySecretaryState(), incomingReview: { signature: 'incoming-v1', reviewedAt: now, candidates: [], counts: { gmail: 1, chat: 0 } } };
    expect(incomingNeedsReview(state, snapshot)).toBe(false);
    snapshot.incoming!.signature = 'new-selection'; expect(incomingNeedsReview(state, snapshot)).toBe(true);
  });
  it('keeps only candidates verified against original context, within one shared deadline', async () => {
    const snapshot = source();
    ai.send.mockImplementation(async function* (_messages, _context, _key, _model, options) {
      yield { type: 'text', content: JSON.stringify(options.systemPrompt === INCOMING_PROMPT ? [candidate()] : [{ id: 'p1', keep: false }]) };
    });
    expect(await interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).toEqual([]);
    expect(ai.send).toHaveBeenCalledTimes(2);
    expect(ai.send.mock.calls[1][4]).toMatchObject({ systemPrompt: INCOMING_CHECK_PROMPT, enableTools: false, signal: ai.send.mock.calls[0][4].signal });
    expect(JSON.parse(ai.send.mock.calls[1][0][0].content).reference.messages[0].options[0].quote).toContain('原稿');
    ai.send.mockImplementation(async function* (_messages, _context, _key, _model, options) {
      yield { type: 'text', content: JSON.stringify(options.systemPrompt === INCOMING_PROMPT ? [candidate()] : [{ id: 'p1', keep: true }]) };
    });
    expect(await interpretIncoming(snapshot, emptySecretaryState(), 'gemini')).toEqual([candidate()]);
  });
  it('does not accept missing, unknown or non-boolean verification decisions', async () => {
    for (const verdict of [[], [{ id: 'p2', keep: true }], [{ id: 'p1', keep: 'yes' }]]) {
      ai.send.mockImplementation(async function* (_messages, _context, _key, _model, options) { yield { type: 'text', content: JSON.stringify(options.systemPrompt === INCOMING_PROMPT ? [candidate()] : verdict) }; });
      await expect(interpretIncoming(source(), emptySecretaryState(), 'gemini')).rejects.toThrow('保存済み');
    }
  });
  it('excludes explicitly other-person Chat requests but keeps a direct mention of the owner', () => {
    const snapshot = source(); snapshot.incoming!.ownerName = '*テスト本人';
    snapshot.incoming!.sources.chat = { ...snapshot.incoming!.sources.gmail, items: [{ id: 'chat1', title: '投稿', text: '@別の担当\nご確認ください', sourceName: '架空スペース', at: now, url: 'https://chat.google.com/room/synthetic' }] };
    const raw = { ...candidate(), deadline: null, evidence: [{ ref: 'c1', id: 'e1' }] };
    expect(validateIncoming([raw], snapshot)).toEqual([]);
    snapshot.incoming!.sources.chat.items[0].text = '@＊テスト本人\nご確認ください';
    expect(validateIncoming([raw], snapshot)).toHaveLength(1);
    snapshot.incoming!.sources.chat.items.push({ ...snapshot.incoming!.sources.chat.items[0], id: 'chat2', text: '@別の担当\n別の制作物を確認ください' });
    expect(validateIncoming([{ ...raw, evidence: [{ ref: 'c1', id: 'e1' }, { ref: 'c2', id: 'e1' }] }], snapshot)).toEqual([]);
  });
  it('requires the latest available Gmail reply in the cited conversation', () => {
    const snapshot = source(); const gmail = snapshot.incoming!.sources.gmail;
    gmail.items.push({ ...gmail.items[0], id: 'm2', text: 'ご連絡ありがとうございます。承知いたしました。', at: '2026-09-10T10:01:00.000Z' });
    const oldOnly = { ...candidate(), deadline: null, evidence: [{ ref: 'g2', id: 'e1' }] };
    expect(validateIncoming([oldOnly], snapshot)).toEqual([]);
    // Including the latest reply allows semantic verification; this check never sets completion.
    expect(validateIncoming([{ ...oldOnly, evidence: [...oldOnly.evidence, { ref: 'g1', id: 'e1' }] }], snapshot)).toHaveLength(1);
  });
});

vi.mock('@/lib/ai/support/repository', () => ({ readAISupportInstructions: async () => '本人の希望：端的に' }));
