// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareFeatureRequest } from './prepare';
const fake = vi.hoisted(() => ({ access: vi.fn(), send: vi.fn(), allowed: null as string[] | null, key: vi.fn() }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('@/lib/firebase/admin', () => ({ getUserAIApiKey: fake.key, getAdminDb: () => ({ doc: (path: string) => ({ get: async () => ({ data: () => path.startsWith('projects/') ? { name: 'タスク管理ツール', isArchived: false } : { allowedProjectIds: fake.allowed } }) }) }) }));
vi.mock('@/lib/ai/providers', () => ({ getProvider: () => ({ sendMessage: fake.send }) }));
vi.mock('@/lib/ai/support/repository', () => ({ readAISupportProfile: async () => ({ enabled: false, wishes: '', approach: '', referenceNotes: '' }) }));
beforeEach(() => { vi.clearAllMocks(); fake.allowed = null; fake.key.mockResolvedValue('test-key'); });
const turns = [{ role: 'user' as const, content: '通知タブに未読件数を表示したい。' }];
it('uses AI to prepare a short request without tools or shared task context', async () => {
  const draft = { type: 'draft', title: '通知に未読件数を表示', problem: '気づきにくい', desired: '未読件数を表示', criteria: ['通知タブで件数が見える'], notes: '' };
  fake.send.mockImplementation(async function* () { yield { type: 'text', content: JSON.stringify(draft) }; });
  expect(await prepareFeatureRequest('owner', 'p', turns, 'gemini')).toEqual(draft);
  expect(fake.send.mock.calls[0][0][0].content).toBe(JSON.stringify({ turns }));
  expect(fake.send.mock.calls[0][4]).toMatchObject({ enableTools: false, systemPrompt: expect.stringContaining('目安15〜25文字') });
  expect(fake.access).toHaveBeenCalledTimes(2);
});
it('rejects tools and fails closed when the destination is outside AI scope', async () => {
  fake.allowed = [];
  await expect(prepareFeatureRequest('owner', 'p', turns, 'gemini')).rejects.toThrow('FORBIDDEN');
  expect(fake.send).not.toHaveBeenCalled();
  fake.allowed = null;
  fake.send.mockImplementation(async function* () { yield { type: 'tool_calls', toolCalls: [] }; });
  await expect(prepareFeatureRequest('owner', 'p', turns, 'gemini')).rejects.toThrow('INVALID_AI_OUTPUT');
});
