import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from './route';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { readSharedCountdown, saveSharedCountdown } from '@/lib/firebase/admin-countdown';

vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: vi.fn() }));
vi.mock('@/lib/firebase/admin-countdown', () => ({ readSharedCountdown: vi.fn(), saveSharedCountdown: vi.fn() }));
const target = { projectId: 'p1', taskId: 't1' };
const request = (body?: unknown) => new NextRequest('http://localhost/api/dashboard/countdown', {
  method: body === undefined ? 'GET' : 'PATCH', headers: { Authorization: 'Bearer id-token' }, body: body === undefined ? undefined : JSON.stringify(body),
});
describe('shared countdown route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'user', email: 'user@1000ri.jp' });
    vi.mocked(readSharedCountdown).mockResolvedValue({ target: null, task: null, revision: 0, status: 'unset' });
  });
  it('reads the shared selection without cache or writes', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(readSharedCountdown).toHaveBeenCalledWith('user');
    expect(saveSharedCountdown).not.toHaveBeenCalled();
  });
  it.each([target, null])('saves only the target and revision', async (value) => {
    const response = await PATCH(request({ target: value, revision: 2 }));
    expect(response.status).toBe(200);
    expect(saveSharedCountdown).toHaveBeenCalledWith('user', value, 2);
  });
  it.each([{}, [], null, { target }, { target, revision: -1 }, { target, revision: 0.5 }, { target: { ...target, taskId: '../x' }, revision: 0 }, { target, revision: 0, title: 'overwrite' }])('rejects malformed payloads', async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(saveSharedCountdown).not.toHaveBeenCalled();
  });
  it('requires a verified company identity before reads or writes', async () => {
    vi.mocked(verifyAuthToken).mockRejectedValue(new Error('bad token'));
    expect((await GET(request())).status).toBe(401);
    expect((await PATCH(request({ target, revision: 0 }))).status).toBe(401);
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'outsider', email: 'person@example.com' });
    expect((await GET(request())).status).toBe(403);
    expect((await PATCH(request({ target, revision: 0 }))).status).toBe(403);
    expect(readSharedCountdown).not.toHaveBeenCalled();
    expect(saveSharedCountdown).not.toHaveBeenCalled();
  });
  it.each([['FORBIDDEN', 403], ['INVALID_COUNTDOWN_TASK', 400], ['CONFLICT', 409], ['credential secret details', 503]] as const)('maps %s to safe errors', async (message, status) => {
    vi.mocked(saveSharedCountdown).mockRejectedValue(new Error(message));
    const response = await PATCH(request({ target, revision: 0 }));
    expect(response.status).toBe(status);
    if (status === 503) expect(JSON.stringify(await response.json())).not.toContain('secret details');
  });
});
