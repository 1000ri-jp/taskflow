// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ verify: vi.fn(), approve: vi.fn(), consume: vi.fn(), db: {} }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => ({ verifyIdToken: mock.verify }), getAdminDb: () => mock.db }));
vi.mock('@/lib/auth/miniPairingServer', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth/miniPairingServer')>(), approveMiniPairing: mock.approve, consumeMiniPairing: mock.consume }));
import { POST } from './route';
const pairing = () => ({ id: 'a'.repeat(32), secretHash: 'b'.repeat(64), publicKey: 'A'.repeat(392), expiresAt: Date.now() + 240000 });
const request = (body: unknown, overrides: Record<string, string> = {}) => new NextRequest('https://slowth.1000ri.jp/api/desktop-mini/auth', {
  method: 'POST', headers: { Origin: 'https://slowth.1000ri.jp', 'Content-Type': 'application/json', Authorization: 'Bearer firebase-id-token', ...overrides }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mock.verify.mockResolvedValue({ uid: 'user-1', email: 'user@1000ri.jp', email_verified: true, auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'google.com' } });
  mock.approve.mockResolvedValue(undefined); mock.consume.mockResolvedValue(null);
});
describe('Mini sign-in route authorization', () => {
  it('requires a recent verified Google account and derives uid from the token', async () => {
    const r = pairing();
    const response = await POST(request({ action: 'approve', request: r, envelope: { ciphertext: 'opaque' }, uid: 'attacker' }));
    expect(response.status).toBe(200);
    expect(mock.verify).toHaveBeenCalledWith('firebase-id-token', true);
    expect(mock.approve).toHaveBeenCalledWith(mock.db, r, { ciphertext: 'opaque' }, 'user-1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([
    { email: 'external@example.com' }, { email_verified: false }, { auth_time: Date.now() / 1000 - 600 }, { firebase: { sign_in_provider: 'password' } },
  ])('rejects inappropriate account state %j', async patch => {
    mock.verify.mockResolvedValue({ uid: 'user-1', email: 'user@1000ri.jp', email_verified: true, auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'google.com' }, ...patch });
    const response = await POST(request({ action: 'approve', request: pairing() }));
    expect([401, 403]).toContain(response.status); expect(mock.approve).not.toHaveBeenCalled();
  });
  it('rejects revoked auth and PATs rather than widening their scopes', async () => {
    mock.verify.mockRejectedValue(new Error('revoked'));
    expect((await POST(request({ action: 'approve' }))).status).toBe(401);
    expect((await POST(request({ action: 'approve' }, { Authorization: 'Bearer tf_scoped-token' }))).status).toBe(401);
    expect(mock.approve).not.toHaveBeenCalled();
  });
  it('rejects cross-origin approval, oversized bodies, invalid json content type, and expired descriptors', async () => {
    expect((await POST(request({ action: 'approve' }, { Origin: 'https://example.com' }))).status).toBe(403);
    expect((await POST(request({ data: 'x'.repeat(19000) }))).status).toBe(413);
    expect((await POST(request({}, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await POST(request({ action: 'approve', request: { ...pairing(), expiresAt: 1 } }))).status).toBe(400);
    expect(mock.approve).not.toHaveBeenCalled();
  });
  it('polls only by high-entropy device proof and does not create data before approval', async () => {
    const response = await POST(request({ action: 'consume', id: 'a'.repeat(32), secret: '1'.repeat(64) }, { Authorization: '' }));
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(mock.consume).toHaveBeenCalledWith(mock.db, 'a'.repeat(32), '1'.repeat(64));
    expect(mock.approve).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled();
  });
});
