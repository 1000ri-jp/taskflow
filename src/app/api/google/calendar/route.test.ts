// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mocks.verify }));
vi.mock('@/lib/google/workspace/calendar-range', async () => ({ ...await vi.importActual('@/lib/google/workspace/calendar-range'), readCalendarRange: mocks.read }));
import { GET } from './route';
describe('calendar route access and range', () => {
  it('requires the authenticated company user and bounds range before any calendar read', async () => {
    mocks.read.mockReset().mockResolvedValue({ connected: true, items: [] });
    mocks.verify.mockRejectedValueOnce(new Error('no auth'));
    expect((await GET(new NextRequest('http://localhost/api/google/calendar'))).status).toBe(401);
    mocks.verify.mockResolvedValueOnce({ uid: 'outsider', email: 'other@example.com' });
    expect((await GET(new NextRequest('http://localhost/api/google/calendar'))).status).toBe(403);
    mocks.verify.mockResolvedValue({ uid: 'member', email: 'member@1000ri.jp' });
    expect((await GET(new NextRequest('http://localhost/api/google/calendar?start=2026-01-01&end=2027-01-01'))).status).toBe(422);
    expect(mocks.read).not.toHaveBeenCalled();
    const response = await GET(new NextRequest('http://localhost/api/google/calendar?start=2026-09-14&end=2026-09-21&uid=someone-else'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.read).toHaveBeenCalledWith('member', { start: new Date('2026-09-14'), end: new Date('2026-09-21') }, false);
  });
});
