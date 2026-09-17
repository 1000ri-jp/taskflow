// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { suggestTaskRelationships, TaskRelationshipError } from '@/lib/ai/taskRelationships';

vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: vi.fn() }));
vi.mock('@/lib/ai/providers', () => ({ isValidProvider: (value: string) => ['gemini', 'openai', 'anthropic'].includes(value) }));
vi.mock('@/lib/ai/taskRelationships', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/taskRelationships')>(), suggestTaskRelationships: vi.fn() }));

const request = (body: unknown) => new NextRequest('http://localhost/api/ai/task-relations', {
  method: 'POST', headers: { Authorization: 'Bearer synthetic-token' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'authenticated-user', email: 'tester@1000ri.jp' });
  vi.mocked(suggestTaskRelationships).mockResolvedValue({ projectId: 'p', checkedAt: '2026-09-12T00:00:00.000Z', taskCount: 0, suggestions: [] });
});

describe('POST /api/ai/task-relations', () => {
  it('uses the authenticated user and prevents response caching', async () => {
    const response = await POST(request({ projectId: 'p', provider: 'gemini', model: 'gemini-2.5-flash' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(suggestTaskRelationships).toHaveBeenCalledExactlyOnceWith('authenticated-user', 'p', 'gemini', 'gemini-2.5-flash');
    expect(await response.json()).toMatchObject({ projectId: 'p', suggestions: [] });
  });
  it('requires authentication before accessing project data', async () => {
    vi.mocked(verifyAuthToken).mockRejectedValue(new Error('private-token-error'));
    const response = await POST(request({ projectId: 'p', provider: 'gemini' }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('private-token-error');
    expect(suggestTaskRelationships).not.toHaveBeenCalled();
  });
  it.each([undefined, 'tester@example.com', 'tester@other1000ri.jp'])('rejects ineligible accounts before reading project data: %s', async email => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'authenticated-user', email });
    const response = await POST(request({ projectId: 'p', provider: 'gemini' }));
    expect(response.status).toBe(403);
    expect(suggestTaskRelationships).not.toHaveBeenCalled();
  });
  it.each([
    { projectId: 'p', provider: 'gemini', tasks: [] },
    { projectId: 'p', provider: 'gemini', userId: 'other' },
    { projectId: '../other', provider: 'gemini' },
    { projectId: 'p', provider: 'unknown' },
    { projectId: 'p', provider: 'gemini', model: 'bad model' },
    { projectId: 'p', provider: 'gemini', model: 'x'.repeat(1001) },
    null,
  ])('rejects client context or malformed arguments: %j', async body => {
    const response = await POST(request(body));
    expect(response.status).toBe(422); expect(suggestTaskRelationships).not.toHaveBeenCalled();
  });
  it.each([['FORBIDDEN', 403], ['CONFLICT', 409], ['AI_NOT_CONFIGURED', 503], ['AI_TIMEOUT', 504], ['LIMIT', 422]] as const)('returns an explicit %s error rather than an empty success', async (code, status) => {
    vi.mocked(suggestTaskRelationships).mockRejectedValue(new TaskRelationshipError(code, 'safe message'));
    const response = await POST(request({ projectId: 'p', provider: 'gemini' }));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'safe message', code });
  });
  it('does not return database error details', async () => {
    vi.mocked(suggestTaskRelationships).mockRejectedValue(new Error('private-project-data'));
    const response = await POST(request({ projectId: 'p', provider: 'gemini' }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-project-data');
  });
});
