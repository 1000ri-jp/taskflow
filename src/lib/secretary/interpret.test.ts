// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretSnapshot, SECRETARY_PROMPT } from './interpret';
import { createMockSecretary, mockInterpretations, mockView } from './mock';
import { validateInterpretations } from './engine';
import type { EvidenceOption, ReviewOption } from './evidence';
import type { AIMessage } from '@/types/ai';
import { AIProviderError } from '@/lib/ai/providers/errors';
const mock = vi.hoisted(() => ({ key: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getUserAIApiKey: mock.key }));
vi.mock('@/lib/ai/providers', () => ({ getProvider: () => ({ sendMessage: mock.send }) }));
const now = '2026-09-10T01:00:00Z';
beforeEach(() => { vi.resetAllMocks(); mock.key.mockResolvedValue('synthetic-key'); });
describe('Secretary existing LLM transport', () => {
  it('uses the configured provider with a server-owned policy and no tools; passes scoped corrections', async () => {
    mock.send.mockImplementation(async function* () { yield { type: 'text', content: '[]' }; });
    const { snapshot, state } = mockView(createMockSecretary('u', now), 'u', now);
    const raw = await interpretSnapshot(snapshot, state, 'anthropic', 'configured-model');
    expect(raw).toEqual([]); const args = mock.send.mock.calls[0];
    expect(args[4]).toMatchObject({ enableTools: false, systemPrompt: SECRETARY_PROMPT, supportInstructions: '本人の希望：端的に' });
    expect(args[0]).toHaveLength(1); expect(args[0][0].role).toBe('user'); expect(args[3]).toBe('configured-model');
  });
  it('includes calendar as dated context without accepting it as task evidence', async () => {
    mock.send.mockImplementation(async function* () { yield { type: 'text', content: '[]' }; });
    const { snapshot, state } = mockView(createMockSecretary('u', now), 'u', now);
    snapshot.calendar = { connected: true, fetchedAt: '2026-09-09T00:00:00Z', attemptedAt: '2026-09-09T00:00:00Z', status: 'ready', error: null, items: [] };
    await interpretSnapshot(snapshot, state, 'gemini');
    const input = JSON.parse(mock.send.mock.calls[0][0][0].content);
    expect(input.calendarContext).toMatchObject({ stale: true, fetchedAt: snapshot.calendar.fetchedAt });
    expect(input.targets.every((t: { evidenceOptions: EvidenceOption[] }) => t.evidenceOptions.every(e => !e.source.startsWith('calendar')))).toBe(true);
  });
  it('never substitutes canned rules for missing AI or a failed/malformed response', async () => {
    const { snapshot, state } = mockView(createMockSecretary('u', now), 'u', now);
    mock.key.mockResolvedValue(null); await expect(interpretSnapshot(snapshot, state, 'openai')).rejects.toThrow('未接続');
    mock.key.mockResolvedValue('synthetic-key'); mock.send.mockImplementation(async function* () { yield { type: 'text', content: 'not json' }; });
    await expect(interpretSnapshot(snapshot, state, 'openai')).rejects.toThrow('応答');
  });
  it('sends source options and restores their exact text from the returned model references', async () => {
    const { snapshot, state } = mockView(createMockSecretary('u', now), 'u', now);
    const base = mockInterpretations(snapshot)[0];
    mock.send.mockImplementation(async function* (messages: AIMessage[]) {
      const input = JSON.parse(messages[0].content);
      if (input.proposals) { yield { type: 'text', content: '[{"id":0,"keep":true}]' }; return; }
      const target = input.targets.find((t: { key: string }) => t.key === base.key);
      const source = target.evidenceOptions.find((o: EvidenceOption) => o.source === base.evidence[0].source && o.quote.includes(base.evidence[0].quote));
      const review = target.reviewOptions.find((o: ReviewOption) => JSON.stringify(o.review) === JSON.stringify(base.review));
      yield { type: 'text', content: JSON.stringify([{ ...base, decision: { whyNow: '素材の予定が変わりました', question: '代わりの素材を選びますか？', consequence: '選んだ素材で制作を進めます' }, evidence: [{ id: source.id }], review: review?.id ?? null }]) };
    });
    const result = await interpretSnapshot(snapshot, state, 'gemini');
    expect(validateInterpretations(result, snapshot)[0].evidence[0].source).toBe(base.evidence[0].source);
    expect(validateInterpretations(result, snapshot)[0].evidence[0].quote).toContain(base.evidence[0].quote);
  });
  it('does not send incomplete reads to a provider', async () => {
    const view = mockView({ ...createMockSecretary('u', now), failed: true }, 'u', now);
    await expect(interpretSnapshot(view.snapshot, view.state, 'openai')).rejects.toThrow('一部未完了'); expect(mock.send).not.toHaveBeenCalled();
  });
  it('explains an invalid API key without presenting it as a retryable response-format problem', async () => {
    const { snapshot, state } = mockView(createMockSecretary('u', now), 'u', now);
    mock.send.mockImplementation(async function* () { throw new AIProviderError('openai', 401, 'invalid_api_key'); });
    await expect(interpretSnapshot(snapshot, state, 'openai')).rejects.toThrow('AI設定');
    await expect(interpretSnapshot(snapshot, state, 'openai')).rejects.toThrow('既存の判断は保持');
  });
});

vi.mock('@/lib/ai/support/repository', () => ({ readAISupportInstructions: async () => '本人の希望：端的に' }));

it.each(['[{"id":0,"keep":false}]','[]'])('checks generated questions against the originals before accepting them: %s', async verdict=>{
 const {snapshot,state}=mockView(createMockSecretary('u',now),'u',now);const base=mockInterpretations(snapshot)[0];
 mock.send.mockImplementation(async function* (messages:AIMessage[]) {
  const input=JSON.parse(messages[0].content);
  if(input.proposals){yield {type:'text',content:verdict};return;}
  const target=input.targets.find((t:{key:string})=>t.key===base.key);
  const source=target.evidenceOptions.find((o:EvidenceOption)=>o.source===base.evidence[0].source && o.quote.includes(base.evidence[0].quote));
  const review=target.reviewOptions.find((o:ReviewOption)=>JSON.stringify(o.review)===JSON.stringify(base.review));
  yield {type:'text',content:JSON.stringify([{...base,decision:{whyNow:'確認された予定の変更',question:'別案を選びますか？',consequence:'選んだ案で進めます'},evidence:[{id:source.id}],review:review?.id??null}])};
 });
 if(verdict==='[]')await expect(interpretSnapshot(snapshot,state,'openai')).rejects.toThrow('AIの応答');
 else expect(await interpretSnapshot(snapshot,state,'openai')).toEqual([]);
 expect(mock.send).toHaveBeenCalledTimes(2);expect(mock.send.mock.calls[1][4].enableTools).toBe(false);
});
