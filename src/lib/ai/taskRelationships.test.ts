// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestTaskRelationships, validateTaskRelationshipSuggestions, type RelationshipSourceTask } from './taskRelationships';
import { getProvider } from './providers';
import { getUserAIApiKey } from '@/lib/firebase/admin';
import type { SendMessageOptions, StreamChunk } from './providers/types';

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getUserAIApiKey: vi.fn() }));
vi.mock('./providers', () => ({ getProvider: vi.fn() }));
type Data = Record<string, unknown>;
let documents: Map<string, Data>;
let reads: string[];
let output: string;
let providerMode: 'text' | 'tool' | 'error' | 'hang';
let duringGeneration: (() => void) | undefined;
let options: SendMessageOptions | undefined;
let input: string;

class Ref {
  constructor(public path: string) {}
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async get() {
    reads.push(this.path);
    const data = documents.get(this.path);
    return { id: this.path.split('/').at(-1)!, exists: !!data, data: () => data && structuredClone(data), updateTime: { toMillis: () => Number(data?.version ?? 1) } };
  }
}
class Query {
  maximum = Infinity;
  filter?: { field: string; value: unknown };
  constructor(public path: string) {}
  where(field: string, _operator: string, value: unknown) { this.filter = { field, value }; return this; }
  limit(maximum: number) { this.maximum = maximum; return this; }
  async get() {
    reads.push(this.path);
    const paths = [...documents.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1)
      .filter(path => !this.filter || documents.get(path)![this.filter.field] === this.filter.value).sort().slice(0, this.maximum);
    const docs = await Promise.all(paths.map(path => new Ref(path).get()));
    return { docs, size: docs.length };
  }
}
const sourceTask = (id: string, extra: Partial<RelationshipSourceTask> = {}): RelationshipSourceTask & Data => ({
  id, title: `原稿${id}`, description: `原稿${id}を確認する`, parentTaskId: null, dependsOnTaskIds: [], isCompleted: false, isArchived: false, isAbandoned: false, ...extra,
});
const proposal = (extra: Record<string, unknown> = {}) => ({ kind: 'related', taskIds: ['a', 'b'], parentTaskId: null, reason: '原稿の確認作業を一緒に確認できます。',
  evidence: [{ taskId: 'a', quote: '原稿a' }, { taskId: 'b', quote: '原稿b' }], ...extra });

beforeEach(() => {
  vi.resetAllMocks(); reads = []; providerMode = 'text'; duringGeneration = undefined; options = undefined; input = '';
  output = JSON.stringify([proposal()]);
  documents = new Map<string, Data>([
    ['projects/p', { ownerId: 'owner', memberIds: ['u'], isArchived: false }],
    ['projects/p/members/u', { userId: 'u', role: 'viewer' }],
    ['users/u/settings/aiSettings', { allowedProjectIds: ['p'] }],
    ['projects/p/tasks/a', sourceTask('a')], ['projects/p/tasks/b', sourceTask('b')],
  ]);
  fake.db = { doc: (path: string) => new Ref(path), runTransaction: (fn: (tx: { get: (ref: Ref | Query) => unknown }) => unknown) => fn({ get: ref => ref.get() }) };
  vi.mocked(getUserAIApiKey).mockResolvedValue('synthetic-key');
  vi.mocked(getProvider).mockReturnValue({ name: 'gemini', sendMessage: async function* (messages, _context, _key, _model, supplied): AsyncGenerator<StreamChunk, void, unknown> {
    options = supplied; input = messages[0].content; duringGeneration?.();
    if (providerMode === 'hang') await new Promise(() => {});
    if (providerMode === 'error') throw new Error('provider-private-key-and-body');
    if (providerMode === 'tool') yield { type: 'tool_calls', toolCalls: [] };
    else yield { type: 'text', content: output };
  } });
});
afterEach(() => vi.useRealTimers());

describe('task relationship server scope', () => {
  it('uses server task text and read permissions, returns server titles, and never changes data', async () => {
    documents.set('projects/p/tasks/archived', sourceTask('archived', { isArchived: true }));
    documents.set('projects/p/tasks/abandoned', sourceTask('abandoned', { isAbandoned: true }));
    documents.set('projects/p/tasks/a/comments/private', { content: 'not part of this read' });
    const before = structuredClone([...documents]);
    const report = await suggestTaskRelationships('u', 'p', 'gemini');
    expect(report).toMatchObject({ projectId: 'p', taskCount: 2, suggestions: [{ kind: 'related', tasks: [{ id: 'a', title: '原稿a' }, { id: 'b', title: '原稿b' }], parentTaskId: null }] });
    expect(report.checkedAt).toMatch(/^\d{4}-/);
    expect(report.suggestions[0].id).toHaveLength(24);
    expect(JSON.parse(input).tasks.map((task: { id: string }) => task.id)).toEqual(['a', 'b']);
    expect(input).not.toContain('not part of this read');
    expect(reads.some(path => path.includes('/comments'))).toBe(false);
    expect(options).toMatchObject({ enableTools: false, maxOutputTokens: 6000 });
    expect(options?.systemPrompt).toContain('参照資料');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect([...documents]).toEqual(before);
  });

  it.each([
    ['projects/p', { memberIds: [], ownerId: 'other' }],
    ['projects/p', { memberIds: 'u' }],
    ['projects/p', { memberIds: ['u'], isArchived: true }],
    ['projects/p/members/u', { userId: 'u', role: 'unknown' }],
    ['users/u/settings/aiSettings', { allowedProjectIds: [] }],
    ['users/u/settings/aiSettings', { allowedProjectIds: 'p' }],
    ['users/u/settings/aiSettings', { allowedProjectIds: ['p', 123] }],
  ])('rejects invalid access before reading task bodies: %s %j', async (path, data) => {
    documents.set(path, data);
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(reads.some(path => path.includes('/tasks'))).toBe(false);
    expect(getUserAIApiKey).not.toHaveBeenCalled(); expect(getProvider).not.toHaveBeenCalled();
  });

  it('accepts the owner with a valid membership role and the legacy all-project setting', async () => {
    documents.set('projects/p', { ownerId: 'u', memberIds: [] });
    documents.set('projects/p/members/u', { userId: 'u', role: 'admin' });
    documents.delete('users/u/settings/aiSettings');
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).resolves.toMatchObject({ taskCount: 2 });
    documents.delete('projects/p/members/u');
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    ['projects/p', { ownerId: 'other', memberIds: [] }],
    ['projects/p/members/u', { userId: 'u', role: 'revoked' }],
    ['users/u/settings/aiSettings', { allowedProjectIds: [] }],
    ['users/u/settings/aiSettings', { allowedProjectIds: 'malformed' }],
  ])('withholds the completed AI result after access changes: %s', async (path, data) => {
    duringGeneration = () => documents.set(path, data);
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getProvider).toHaveBeenCalledOnce();
  });

  it.each(['text', 'version', 'added', 'archived'])('rejects a changed task snapshot after generation: %s', async change => {
    duringGeneration = () => {
      if (change === 'added') documents.set('projects/p/tasks/c', sourceTask('c'));
      else Object.assign(documents.get('projects/p/tasks/a')!, change === 'text' ? { description: 'updated' } : change === 'version' ? { version: 2 } : { isArchived: true });
    };
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each(['count', 'description', 'total'])('reports source limits without a partial success: %s', async kind => {
    if (kind === 'count') for (let i = 0; i < 199; i++) documents.set(`projects/p/tasks/t${i}`, sourceTask(`t${i}`));
    if (kind === 'description') documents.get('projects/p/tasks/a')!.description = '字'.repeat(8001);
    if (kind === 'total') for (let i = 0; i < 16; i++) documents.set(`projects/p/tasks/t${i}`, sourceTask(`t${i}`, { description: '字'.repeat(8000) }));
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'LIMIT' });
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('reports unconfigured AI even with no possible pair; an authorized empty project is otherwise a true empty result', async () => {
    documents.delete('projects/p/tasks/a'); documents.delete('projects/p/tasks/b');
    vi.mocked(getUserAIApiKey).mockResolvedValue(null);
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    vi.mocked(getUserAIApiKey).mockResolvedValue('synthetic-key');
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).resolves.toMatchObject({ taskCount: 0, suggestions: [] });
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('accepts a valid no-candidate result without calling it an error', async () => {
    output = '[]';
    await expect(suggestTaskRelationships('u', 'p', 'gemini')).resolves.toMatchObject({ taskCount: 2, suggestions: [] });
  });

  it.each(['tool', 'error', 'json', 'large'])('rejects unsafe or unavailable provider output without leaking it: %s', async kind => {
    if (kind === 'tool' || kind === 'error') providerMode = kind;
    if (kind === 'json') output = '```json\n[]\n```';
    if (kind === 'large') output = 'private'.repeat(5000);
    const result = suggestTaskRelationships('u', 'p', 'gemini');
    await expect(result).rejects.toMatchObject({ code: kind === 'error' ? 'AI_UNAVAILABLE' : 'AI_INVALID' });
    await expect(result).rejects.not.toThrow('provider-private-key-and-body');
  });

  it('enforces the 45-second deadline even if the provider does not finish its stream', async () => {
    vi.useFakeTimers(); providerMode = 'hang';
    const promise = suggestTaskRelationships('u', 'p', 'gemini');
    const failure = expect(promise).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.waitFor(() => expect(getProvider).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(45000);
    await failure;
    expect(options?.signal?.aborted).toBe(true);
  });
});

describe('task relationship evidence and graph validation', () => {
  const sources = [sourceTask('a'), sourceTask('b')];
  it.each([
    { taskIds: ['a', 'outside'] }, { taskIds: ['a', 'a'] }, { taskIds: ['a'] },
    { kind: 'parent_child', parentTaskId: 'outside' }, { kind: 'parent_child', parentTaskId: null },
    { parentTaskId: 'a' }, { kind: 'delete' }, { kind: ['related'] }, { kind: ['merge'] }, { reason: '' }, { action: 'apply' },
    { evidence: [{ taskId: 'a', quote: 'fabricated' }, { taskId: 'b', quote: '原稿b' }] },
    { evidence: [{ taskId: 'a', quote: '原稿b' }, { taskId: 'b', quote: '原稿b' }] },
    { evidence: [{ taskId: 'a', quote: '原稿a' }, { taskId: 'a', quote: '原稿a' }] },
  ])('rejects invalid candidate data: %j', extra => {
    expect(() => validateTaskRelationshipSuggestions([proposal(extra)], sources)).toThrow();
  });
  it('bounds the candidate count and refuses non-array output', () => {
    expect(() => validateTaskRelationshipSuggestions(Array.from({ length: 7 }, () => proposal()), sources)).toThrow();
    expect(() => validateTaskRelationshipSuggestions({ suggestions: [] }, sources)).toThrow();
  });
  it('filters completed pairs, already-established relationships, and duplicates', () => {
    expect(validateTaskRelationshipSuggestions([proposal()], sources.map(task => ({ ...task, isCompleted: true })))).toEqual([]);
    const existing = [sourceTask('a'), sourceTask('b', { parentTaskId: 'a' })];
    expect(validateTaskRelationshipSuggestions([proposal(), proposal({ kind: 'merge' }), proposal({ kind: 'parent_child', parentTaskId: 'a' })], existing)).toEqual([]);
    expect(validateTaskRelationshipSuggestions([proposal(), proposal()], sources)).toHaveLength(1);
  });
  it('allows a parent-child candidate and rejects both ancestor and cross-suggestion cycles', () => {
    expect(validateTaskRelationshipSuggestions([proposal({ kind: 'parent_child', parentTaskId: 'a' })], sources)[0].parentTaskId).toBe('a');
    const ancestry = [sourceTask('a', { parentTaskId: 'c' }), sourceTask('b'), sourceTask('c', { parentTaskId: 'b' })];
    expect(() => validateTaskRelationshipSuggestions([proposal({ kind: 'parent_child', parentTaskId: 'a' })], ancestry)).toThrow();
    expect(() => validateTaskRelationshipSuggestions([proposal({ kind: 'parent_child', parentTaskId: 'a' }), proposal({ kind: 'parent_child', parentTaskId: 'b' })], sources)).toThrow();
    expect(() => validateTaskRelationshipSuggestions([proposal({ kind: 'parent_child', parentTaskId: 'a' })], [sourceTask('a', { parentTaskId: 'missing' }), sourceTask('b')])).toThrow();
  });
});
