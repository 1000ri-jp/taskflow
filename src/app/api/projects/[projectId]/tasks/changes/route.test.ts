// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { listProjectTaskChanges } from '@/lib/task/changeRepository';
import { TaskChangeError } from '@/lib/task/changeCursor';
vi.mock('@/lib/auth/authenticateRequest', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: vi.fn() }));
vi.mock('@/lib/task/changeRepository', () => ({ listProjectTaskChanges: vi.fn() }));
const request = (query = '') => GET(new NextRequest(`http://localhost/api/projects/p/tasks/changes${query}`, { headers: { Authorization: 'Bearer example' } }), { params: Promise.resolve({ projectId: 'p' }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u', authType: 'api-token', tokenName: 'test', actorDisplayName: null, actorIcon: null, tokenId: 't', permissions: ['tasks:read'], projectIds: ['p'] });
  vi.mocked(getProjectAccess).mockResolvedValue({ role: 'viewer' });
  vi.mocked(listProjectTaskChanges).mockResolvedValue({ tasks: [], nextCursor: null, checkpoint: 'position', snapshotAt: 'time' });
});
describe('authenticated task change route', () => {
  it('uses the existing read permission and token project scope on initial and every continuation request', async () => {
    const first = await request(); expect(first.status).toBe(200); expect(first.headers.get('Cache-Control')).toContain('no-store');
    await request('?cursor=position&limit=25');
    expect(getProjectAccess).toHaveBeenNthCalledWith(2, 'u', 'p', ['tasks:read'], ['p'], 'tasks:read');
    expect(listProjectTaskChanges).toHaveBeenLastCalledWith('p', 'position', 25);
  });
  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404]])('rejects current %s access even with a cursor', async (message, status) => {
    vi.mocked(getProjectAccess).mockRejectedValue(new Error(message));
    expect((await request('?cursor=position')).status).toBe(status); expect(listProjectTaskChanges).not.toHaveBeenCalled();
  });
  it('requires authentication before querying data', async () => {
    vi.mocked(authenticateRequest).mockRejectedValue(new Error('Missing or invalid Authorization header'));
    expect((await request()).status).toBe(401); expect(getProjectAccess).not.toHaveBeenCalled(); expect(listProjectTaskChanges).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '201', '1.5', 'oops'])('rejects invalid page limit %s', async limit => {
    expect((await request(`?limit=${limit}`)).status).toBe(400); expect(listProjectTaskChanges).not.toHaveBeenCalled();
  });
  it.each([['INVALID_CURSOR', 400], ['CURSOR_EXPIRED', 409]])('returns resumable cursor error %s', async (message, status) => {
    vi.mocked(listProjectTaskChanges).mockRejectedValue(new TaskChangeError(message, status));
    const response = await request('?cursor=invalid'); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: message });
  });
});

it.each(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled'])('maps credential error %s to 401 without returning its diagnostic data', async code => {
  vi.mocked(authenticateRequest).mockRejectedValue(Object.assign(new Error('credential diagnostic'), { code }));
  const response = await request();
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'Invalid authentication token' });
  expect(listProjectTaskChanges).not.toHaveBeenCalled();
});
it('keeps authentication service outages as server errors', async () => {
  vi.mocked(authenticateRequest).mockRejectedValue(Object.assign(new Error('service unavailable'), { code: 'auth/internal-error' }));
  expect((await request()).status).toBe(500); expect(listProjectTaskChanges).not.toHaveBeenCalled();
});
