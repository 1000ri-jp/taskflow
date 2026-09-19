// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import type { AIContext, AIMessage } from '@/types/ai';

const messages: AIMessage[] = [{ id: 'report', role: 'user', content: '山田様の図面作成も完了しました！先方にもメール予約した', createdAt: new Date() }];
const project = { id: 'current-project', name: '制作', description: '', lists: [], members: [] };
const responses = [
  [new OpenAIProvider(), 'data: {"choices":[{"delta":{"content":"候補を照合します"}}]}\n\ndata: [DONE]\n\n'],
  [new AnthropicProvider(), 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"候補を照合します"}}\n\ndata: {"type":"message_stop"}\n\n'],
  [new GeminiProvider(), '[{"candidates":[{"content":{"parts":[{"text":"候補を照合します"}]}}]}]'],
] as const;
afterEach(() => vi.unstubAllGlobals());

describe('Task lookup instructions sent to each configured provider', () => {
  it.each(responses)('uses existing read tools before asking for an ID: $0.name', async (provider, reply) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(reply)); vi.stubGlobal('fetch', fetcher);
    const context: AIContext = { scope: 'companion', project, user: { id: 'u', displayName: '本人' } };
    for await (const chunk of provider.sendMessage(messages, context, 'synthetic-key', undefined, { enableTools: true, projectId: project.id })) void chunk;
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    const policy: string = provider.name === 'openai' ? body.messages[0].content : provider.name === 'anthropic' ? body.system : body.contents[0].parts[0].text;
    expect(policy).toContain('現在のプロジェクトでは get_tasks をフィルタなしで取得');
    expect(policy).toContain('完了済み・他の担当のタスクも対象');
    expect(policy).toContain('顧客名と作業名の両方を照合');
    expect(policy).toContain('get_task_details で説明・親子関係・最近の報告を確認');
    expect(policy).toContain('実在するタスク名を最大3件と一致理由');
    expect(policy).toContain('「メール予約」は送信完了ではなく');
    expect(policy).toContain(project.id);
    const definitions = provider.name === 'gemini' ? body.tools[0].functionDeclarations : provider.name === 'openai' ? body.tools.map((tool: { function: unknown }) => tool.function) : body.tools;
    expect(definitions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_tasks' }), expect.objectContaining({ name: 'get_task_details' })]));
    const record = definitions.find((tool: { name: string }) => tool.name === 'record_task_report');
    expect(record.description).not.toContain('対象不明なら先に尋ねる');
    expect(record.description).toContain('先に get_tasks / get_my_tasks_across_projects');
    expect(JSON.stringify(body)).toContain(messages[0].content);
  });
  it.each(responses)('keeps dashboard lookup within the existing cross-project tools: $0.name', async (provider, reply) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(reply)); vi.stubGlobal('fetch', fetcher);
    const context: AIContext = { scope: 'companion', projects: [project], user: { id: 'u', displayName: '本人' } };
    for await (const chunk of provider.sendMessage(messages, context, 'synthetic-key', undefined, { enableTools: true })) void chunk;
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    const policy: string = provider.name === 'openai' ? body.messages[0].content : provider.name === 'anthropic' ? body.system : body.contents[0].parts[0].text;
    expect(policy).toContain('get_my_tasks_across_projects の includeCompleted:true');
    expect(policy).toContain('取得失敗を「タスクが存在しない」と断定しない');
    expect(policy).not.toContain('現在のプロジェクトID（既存ツール用）:');
    const definitions = provider.name === 'gemini' ? body.tools[0].functionDeclarations : provider.name === 'openai' ? body.tools.map((tool: { function: unknown }) => tool.function) : body.tools;
    expect(definitions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_my_tasks_across_projects' })]));
    expect(definitions).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_tasks' })]));
  });
});
