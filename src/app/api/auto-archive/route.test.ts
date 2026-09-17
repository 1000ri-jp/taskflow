// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PUT } from './route';

const backend = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: backend.auth }));
vi.mock('@/lib/board/autoArchiveRepository', () => ({
  AutoArchiveError: class extends Error { constructor(message: string, public status = 422) { super(message); } },
  readAutoArchive: backend.read, saveAutoArchive: backend.save, runAutoArchive: backend.run,
}));
const request = (method = 'GET', body?: unknown, query = '') => new NextRequest(`http://localhost/api/auto-archive${query}`, {
  method, headers: { Authorization: 'Bearer test-user-token' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const setting = { projectId: 'p', revision: 'r1', mode: 'custom', days: 30 };
beforeEach(() => {
  vi.resetAllMocks();
  backend.auth.mockResolvedValue({ uid: 'u', email: 'u@1000ri.jp' });
  backend.read.mockResolvedValue({ configured: false });
  backend.save.mockResolvedValue({ configured: true });
  backend.run.mockResolvedValue({ checked: 1, archived: 2, failed: 0, nextCursor: null });
});

describe('auto archive authenticated boundary', () => {
  it('reads only the authenticated scope and never starts a run from GET', async () => {
    const response = await GET(request('GET', undefined, '?projectId=p'));
    expect(response.status).toBe(200);
    expect(backend.read).toHaveBeenCalledExactlyOnceWith('u', 'p');
    expect(backend.run).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('reads the common setting without accepting an arbitrary uid', async () => {
    await GET(request('GET', undefined, '?uid=someone'));
    expect(backend.read).toHaveBeenCalledExactlyOnceWith('u', null);
  });
  it.each(['missing', 'outside-company'])('rejects %s authentication before all operations', async reason => {
    if (reason === 'missing') backend.auth.mockRejectedValue(new Error('private credential detail'));
    else backend.auth.mockResolvedValue({ uid: 'u', email: 'u@elsewhere.test' });
    for (const [handler, req] of [[GET, request()], [PUT, request('PUT', setting)], [POST, request('POST', { action: 'run' })]] as const) {
      const response = await handler(req);
      expect(response.status).toBe(reason === 'missing' ? 401 : 403);
      expect(JSON.stringify(await response.json())).not.toContain('private credential');
    }
    expect(backend.read).not.toHaveBeenCalled(); expect(backend.save).not.toHaveBeenCalled(); expect(backend.run).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 3651, '30', false])('rejects invalid archive period %s', async days => {
    expect((await PUT(request('PUT', { ...setting, days }))).status).toBe(422);
    expect(backend.save).not.toHaveBeenCalled();
  });
  it.each([{ uid: 'other' }, { projectId: '../p' }, { projectId: null, mode: 'inherit' }, { mode: 'anything' }])('rejects unexpected scope or values %s', async patch => {
    expect((await PUT(request('PUT', { ...setting, ...patch }))).status).toBe(422);
    expect(backend.save).not.toHaveBeenCalled();
  });
  it('saves OFF and inherited settings without an immediate API-side archive', async () => {
    const input = { ...setting, mode: 'inherit', days: null };
    expect((await PUT(request('PUT', input))).status).toBe(200);
    expect(backend.save).toHaveBeenCalledExactlyOnceWith('u', input);
    expect(backend.run).not.toHaveBeenCalled();
  });
  it('passes only a project cursor to authenticated run', async () => {
    expect((await POST(request('POST', { action: 'run', cursor: 'projects/p20' }))).status).toBe(200);
    expect(backend.run).toHaveBeenCalledExactlyOnceWith('u', 'projects/p20');
  });
  it.each([{ action: 'run', uid: 'other' }, { action: 'run', cursor: 'users/u' }, { action: 'delete' }])('rejects extra run targets %s', async input => {
    expect((await POST(request('POST', input))).status).toBe(422); expect(backend.run).not.toHaveBeenCalled();
  });
  it('keeps infrastructure errors private', async () => {
    backend.read.mockRejectedValue(new Error('private server credentials'));
    const response = await GET(request());
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private server');
  });
});
