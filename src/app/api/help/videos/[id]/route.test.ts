// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => ({ verifyIdToken: mock.verify }) }));
vi.mock('node:fs/promises', () => ({ readFile: mock.read }));
import { GET } from './route';
const request = (token = 'valid') => new NextRequest('https://slowth.1000ri.jp/api/help/videos/01_project-open', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const context = (id = '01_project-open') => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.resetAllMocks(); mock.verify.mockResolvedValue({ email: 'user@1000ri.jp', email_verified: true }); mock.read.mockResolvedValue(Buffer.from('mp4-fixture')); });
afterEach(() => vi.unstubAllEnvs());
it('requires a valid, non-revoked session before reading recordings', async () => {
  expect((await GET(request(''), context())).status).toBe(401);
  mock.verify.mockRejectedValue(new Error('revoked'));
  expect((await GET(request(), context())).status).toBe(401);
  expect(mock.read).not.toHaveBeenCalled();
});
it.each([{ email: 'external@example.com', email_verified: true }, { email: 'user@1000ri.jp', email_verified: false }])('rejects non-company or unverified accounts %j', async user => {
  mock.verify.mockResolvedValue(user);
  expect((await GET(request(), context())).status).toBe(403);
  expect(mock.read).not.toHaveBeenCalled();
});
it('serves allowlisted media without caching or placing credentials in URLs', async () => {
  const response = await GET(request(), context());
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('video/mp4');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.text()).toBe('mp4-fixture');
  expect(mock.verify).toHaveBeenCalledWith('valid', true);
  expect(mock.read).toHaveBeenCalledWith(expect.stringMatching(/src\/assets\/help-videos\/01_project-open\.mp4$/));
});
it('rejects arbitrary paths and unknown media before file access', async () => {
  expect((await GET(request(), context('../../.env.local'))).status).toBe(404);
  expect((await GET(request(), context('missing'))).status).toBe(404);
  expect(mock.read).not.toHaveBeenCalled();
});
it('does not expose server paths when media is missing', async () => {
  mock.read.mockRejectedValue(new Error('/secret/server/path'));
  const response = await GET(request(), context());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('/secret');
});
it('serves local mock previews only during development', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_E2E_MOCK_AUTH', 'true');
  const local = new NextRequest('http://localhost:3002/api/help/videos/01_project-open', { headers: { Authorization: 'Bearer taskflow-local-help-preview' } });
  expect((await GET(local, context())).status).toBe(200);
  expect(mock.verify).not.toHaveBeenCalled();
  mock.verify.mockRejectedValue(new Error('invalid token'));
  expect((await GET(request('taskflow-local-help-preview'), context())).status).toBe(401);
  vi.stubEnv('NODE_ENV', 'production');
  expect((await GET(local, context())).status).toBe(401);
});
