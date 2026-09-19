// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mocks.auth }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: mocks.access }));
vi.mock('@/lib/task/history/repository', () => ({ readTaskHistory: mocks.history }));
const request = (cursor = '') => new NextRequest(`http://localhost/api/projects/p/tasks/t/history${cursor}`, { headers: { Authorization: 'Bearer owner-token' } });
const context = { params: Promise.resolve({ projectId: 'p', taskId: 't' }) };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ uid: 'owner' }); mocks.access.mockResolvedValue({ role: 'viewer' }); mocks.history.mockResolvedValue({ entries: [] }); });
describe('task history owner and project access', () => {
  it('binds private source lookup to the verified user and disables caching', async () => {
    const response = await GET(request('?cursor=next'), context);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.access).toHaveBeenCalledWith('owner', 'p', null, null, 'tasks:read');
    expect(mocks.history).toHaveBeenCalledWith('owner', 'p', 't', 'next');
  });
  it('reads no evidence when authentication or project permission fails', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('API token is not Firebase identity'));
    expect((await GET(request(), context)).status).toBe(401); expect(mocks.access).not.toHaveBeenCalled();
    mocks.access.mockRejectedValue(new Error('FORBIDDEN'));
    expect((await GET(request(), context)).status).toBe(403); expect(mocks.history).not.toHaveBeenCalled();
  });
  it('separates missing task, bad pagination and service failure', async () => {
    for (const [error, status] of [['NOT_FOUND', 404], ['INVALID_CURSOR', 400], ['down', 503]] as const) {
      mocks.history.mockRejectedValueOnce(new Error(error));
      const result = await GET(request(), context);
      expect(result.status).toBe(status); expect(result.headers.get('cache-control')).toBe('no-store');
    }
  });
});
