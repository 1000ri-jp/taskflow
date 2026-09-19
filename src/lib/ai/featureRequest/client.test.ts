import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { organizeFeatureRequest, registerFeatureRequest } from './client';
import { parsePreparation, parseRequestTurns, requestProject } from './types';
const auth = vi.hoisted(() => ({ uid: 'owner', headers: vi.fn() }));
vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: auth.headers }));
vi.mock('@/lib/firebase/config', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: auth.uid } }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const send = vi.fn();
const turns = [{ role: 'user' as const, content: '  通知の未読がわかりにくい\n件数を見たい。 ' }];
beforeEach(() => { vi.clearAllMocks(); auth.uid = 'owner'; auth.headers.mockResolvedValue({ Authorization: 'Bearer test' }); vi.stubGlobal('fetch', send); });
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });
it('registers only in the exact request list using the existing task API and preserves the original text', async () => {
  send.mockResolvedValueOnce(response({ lists: [{ id: 'wrong', name: '実装予定' }, { id: 'intake', name: '要望' }] })).mockResolvedValueOnce(response({ task: { id: 'created' } }));
  expect(await registerFeatureRequest('owner', 'project', '通知に件数を表示', '実現したいこと\n未読件数を表示', turns)).toBe('created');
  const [path, options] = send.mock.calls[1];
  expect(path).toBe('/api/projects/project/tasks');
  expect(JSON.parse(options.body)).toEqual({ listId: 'intake', title: '通知に件数を表示', description: expect.stringContaining(turns[0].content) });
  expect(send.mock.calls.every(([url]) => !url.includes('/api/ai/'))).toBe(true);
});
it('does not register when the list is missing or ambiguous, or identity changes while obtaining credentials', async () => {
  for (const lists of [[], [{ id: 'one', name: '要望' }, { id: 'two', name: '要望' }]]) {
    send.mockResolvedValueOnce(response({ lists }));
    await expect(registerFeatureRequest('owner', 'project', '通知を改善', '詳細', turns)).rejects.toThrow('一つに特定');
  }
  expect(send).toHaveBeenCalledTimes(2);
  auth.headers.mockImplementationOnce(async () => { auth.uid = 'other'; return {}; });
  await expect(registerFeatureRequest('owner', 'project', '通知を改善', '詳細', turns)).rejects.toThrow('アカウント');
  expect(send).toHaveBeenCalledTimes(2);
});
it('validates short titles, bounded conversation, and structured AI results before registration', async () => {
  await expect(registerFeatureRequest('owner', 'project', 'あ'.repeat(33), '詳細', turns)).rejects.toThrow('32文字');
  expect(() => parseRequestTurns([{ role: 'assistant', content: '登録した' }])).toThrow();
  expect(() => parsePreparation({ type: 'draft', title: 'あ'.repeat(33), problem: '困る', desired: '希望', criteria: ['条件'], notes: '' })).toThrow();
  expect(() => requestProject([{ id: 'p', name: 'タスク管理ツール', isArchived: true }])).toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('organizes user-provided input without adding a task', async () => {
  send.mockResolvedValue(response({ type: 'questions', summary: '通知の改善', questions: ['どの画面ですか？'] }));
  expect(await organizeFeatureRequest('owner', 'p', turns, 'gemini', 'model')).toMatchObject({ type: 'questions' });
  expect(send).toHaveBeenCalledExactlyOnceWith('/api/ai/feature-request', expect.objectContaining({ method: 'POST', body: JSON.stringify({ projectId: 'p', turns, provider: 'gemini', model: 'model' }) }));
});

it('keeps connection failures clear and never retries a task creation automatically', async () => {
  send.mockResolvedValueOnce(response({ lists: [{ id: 'intake', name: '要望' }] })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(registerFeatureRequest('owner', 'project', '通知を改善', '詳細', turns)).rejects.toThrow('要望リストを確認してから再送');
  expect(send).toHaveBeenCalledTimes(2);
});
it('explains missing AI settings without exposing provider error details', async () => {
  send.mockResolvedValueOnce(response({ error: 'AI設定で接続を確認してください。' }, false, 503));
  await expect(organizeFeatureRequest('owner', 'p', turns, 'gemini', 'model')).rejects.toThrow('AI設定で接続');
  send.mockResolvedValueOnce(response({ error: 'private provider details' }, false, 503));
  await expect(organizeFeatureRequest('owner', 'p', turns, 'gemini', 'model')).rejects.toThrow('もう一度お試しください');
});
