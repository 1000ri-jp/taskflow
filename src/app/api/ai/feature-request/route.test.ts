// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { prepareFeatureRequest } from '@/lib/ai/featureRequest/prepare';
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: vi.fn() }));
vi.mock('@/lib/ai/featureRequest/prepare', () => ({ prepareFeatureRequest: vi.fn() }));
const input = { projectId: 'p', provider: 'gemini', turns: [{ role: 'user', content: '通知に未読件数を表示したい' }] };
const call = (body: unknown = input) => POST(new NextRequest('http://localhost/api/ai/feature-request', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'owner' }); vi.mocked(prepareFeatureRequest).mockResolvedValue({ type: 'questions', summary: '通知の改善', questions: ['どの画面ですか？'] }); });
it('uses authenticated identity and returns only a no-store preparation', async () => {
  const result = await call(); expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(prepareFeatureRequest).toHaveBeenCalledWith('owner', 'p', input.turns, 'gemini', undefined);
});
it('rejects impersonation, missing auth and oversized input before calling AI', async () => {
  expect((await call({ ...input, userId: 'other' })).status).toBe(400);
  expect((await call({ ...input, turns: [{ role: 'user', content: 'a'.repeat(3001) }] })).status).toBe(400);
  vi.mocked(verifyAuthToken).mockRejectedValue(new Error('auth'));
  expect((await call()).status).toBe(401); expect(prepareFeatureRequest).not.toHaveBeenCalled();
});
it('reports access denial without a task write', async () => {
  vi.mocked(prepareFeatureRequest).mockRejectedValue(new Error('FORBIDDEN'));
  expect((await call()).status).toBe(403);
});
