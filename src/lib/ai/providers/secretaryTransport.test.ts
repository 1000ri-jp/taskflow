// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { AIProviderError } from './errors';
import type { AIContext, AIMessage } from '@/types/ai';
const context: AIContext = { scope: 'personal', user: { id: 'u', displayName: 'Synthetic' } };
const messages: AIMessage[] = [{ id: 'm', role: 'user', content: 'synthetic evidence', createdAt: new Date() }];
function fragmentedResponse(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
}
afterEach(() => vi.unstubAllGlobals());
describe('Secretary provider policy and split network chunks', () => {
  it.each([
    [new OpenAIProvider(), 'data: {"choices":[{"delta":{"content":"日本語の提案"}}]}\n\ndata: [DONE]\n\n'],
    [new AnthropicProvider(), 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"日本語の提案"}}\n\ndata: {"type":"message_stop"}\n\n'],
    [new GeminiProvider(), '[{"candidates":[{"content":{"parts":[{"text":"日本語の提案"}]}}]}]'],
  ])('retains complete Japanese JSON content for $name', async (provider, response) => {
    const fetcher = vi.fn().mockResolvedValue(fragmentedResponse(response)); vi.stubGlobal('fetch', fetcher);
    let output = '';
    for await (const chunk of provider.sendMessage(messages, context, 'synthetic-key', 'chosen-model-id', { systemPrompt: 'trusted secretary policy', supportInstructions: '本人の希望：端的に', enableTools: false, maxOutputTokens: 16000 })) if (chunk.type === 'text') output += chunk.content;
    expect(output).toBe('日本語の提案');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.tools).toBeUndefined();
    if (provider.name === 'gemini') expect(fetcher.mock.calls[0][0]).toContain('/models/chosen-model-id:streamGenerateContent');
    else expect(request.model).toBe('chosen-model-id');
    if (provider.name === 'openai') {
      expect(request.messages[0].content).toBe('trusted secretary policy\n\n本人の希望：端的に');
      expect(request.max_completion_tokens).toBe(16000);
    }
    if (provider.name === 'anthropic') expect(request.system).toBe('trusted secretary policy\n\n本人の希望：端的に');
    if (provider.name === 'gemini') expect(request.systemInstruction.parts[0].text).toBe('trusted secretary policy\n\n本人の希望：端的に');
  });
  it.each([
    [401, { error: { code: 'invalid_api_key', message: 'secret-key-and-private-content' } }, 'APIキーが無効'],
    [429, { error: { code: 'insufficient_quota', message: 'secret-key-and-private-content' } }, '利用枠が不足'],
    [503, null, '接続でエラー'],
  ])('reports a safe, actionable OpenAI error for HTTP %s', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body ? JSON.stringify(body) : 'non-json proxy error', { status })));
    const result = new OpenAIProvider().sendMessage(messages, context, 'synthetic-key').next();
    await expect(result).rejects.toBeInstanceOf(AIProviderError);
    await expect(result).rejects.toThrow(message);
    await expect(result).rejects.not.toThrow('secret-key-and-private-content');
  });
  it.each(['gemini-3-flash-preview', 'gemini-2.5-flash'])('bounds Gemini output and applies thinking control only to supported models: %s', async model => {
    const fetcher = vi.fn().mockResolvedValue(fragmentedResponse('[{"candidates":[{"content":{"parts":[{"text":"private thought","thought":true},{"text":"[]"}]},"finishReason":"STOP"}]}]'));
    vi.stubGlobal('fetch', fetcher); let output = '';
    for await (const chunk of new GeminiProvider().sendMessage(messages, context, 'synthetic-key', model, { enableTools: false, maxOutputTokens: 6000, geminiThinkingLevel: 'low' })) if (chunk.type === 'text') output += chunk.content;
    expect(output).toBe('[]'); const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.generationConfig.maxOutputTokens).toBe(6000);
    expect(request.generationConfig.thinkingConfig).toEqual(model.startsWith('gemini-3') ? { thinkingLevel: 'low' } : undefined);
  });
  it('rejects truncated Gemini responses and sanitizes provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fragmentedResponse('[{"candidates":[{"content":{"parts":[{"text":"[]"}]},"finishReason":"MAX_TOKENS"}]}]')));
    await expect(new GeminiProvider().sendMessage(messages, context, 'synthetic-key').next()).rejects.toThrow('Incomplete');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'private-content' } }, { status: 429 })));
    const next = new GeminiProvider().sendMessage(messages, context, 'synthetic-key').next();
    await expect(next).rejects.toBeInstanceOf(AIProviderError); await expect(next).rejects.not.toThrow('private-content');
  });
});

 it.each([
    [new OpenAIProvider(), 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'],
    [new AnthropicProvider(), 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n'],
    [new GeminiProvider(), '[{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}]'],
 ])('sends explicit purchase images to the selected provider only: $name',async(provider,response)=>{
   const fetcher=vi.fn().mockResolvedValue(fragmentedResponse(response));vi.stubGlobal('fetch',fetcher);
   for await(const chunk of provider.sendMessage([{...messages[0],images:[{mimeType:'image/png',data:'ZmFrZQ=='}]}],context,'synthetic',undefined,{enableTools:false}))void chunk;
   const request=JSON.parse(fetcher.mock.calls[0][1].body);
   if(provider.name==='openai')expect(request.messages.at(-1).content).toContainEqual({type:'image_url',image_url:{url:'data:image/png;base64,ZmFrZQ=='}});
   if(provider.name==='anthropic')expect(request.messages.at(-1).content).toContainEqual({type:'image',source:{type:'base64',media_type:'image/png',data:'ZmFrZQ=='}});
   if(provider.name==='gemini')expect(request.contents.at(-1).parts).toContainEqual({inlineData:{mimeType:'image/png',data:'ZmFrZQ=='}});
 });
