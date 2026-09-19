// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connection: { epoch: 'first', enabled: ['calendar'], selectedCalendars: [{ id: 'primary', name: '会社' }] }, configured: true, token: vi.fn(), read: vi.fn(), get: vi.fn() }));
vi.mock('./oauth', () => ({ connectionRef: () => ({ get: mocks.get }), accessToken: mocks.token }));
vi.mock('./readers', () => ({ readGoogleItems: mocks.read }));
vi.mock('./security', async () => ({ ...await vi.importActual('./security'), isGoogleConfigured: () => mocks.configured }));
import { parseCalendarRange, readCalendarRange } from './calendar-range';
const range = () => parseCalendarRange('2026-08-31T00:00:00+09:00', '2026-10-12T00:00:00+09:00');
beforeEach(() => {
  mocks.configured = true; mocks.connection = { epoch: 'first', enabled: ['calendar'], selectedCalendars: [{ id: 'primary', name: '会社' }] };
  mocks.token.mockReset().mockResolvedValue('server-token');
  mocks.read.mockReset().mockResolvedValue({ items: [], partial: false });
  mocks.get.mockReset().mockImplementation(async () => ({ data: () => mocks.connection }));
});
describe('calendar range reads', () => {
  it('rejects invalid, inverted and excessive ranges', () => {
    for (const args of [[null, null], ['invalid', '2026-09-01'], ['2026-09-01', '2026-08-31'], ['2026-01-01', '2027-01-01']] as const) expect(() => parseCalendarRange(args[0], args[1])).toThrow();
    expect(range().end.getTime() - range().start.getTime()).toBe(42 * 86400000);
  });
  it('reads only calendar, coalesces a repeated range, and isolates users and changed selections', async () => {
    const result = await readCalendarRange('user-a', range());
    expect(result.status).toBe('ready');
    expect(mocks.read).toHaveBeenCalledWith('calendar', 'server-token', mocks.connection, expect.any(Date), range());
    await readCalendarRange('user-a', range());
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await readCalendarRange('user-b', range());
    expect(mocks.read).toHaveBeenCalledTimes(2);
    mocks.connection.epoch = 'changed';
    await readCalendarRange('user-a', range());
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
  it('does not return prior cache after disconnect and rejects selection changes while reading', async () => {
    mocks.connection.enabled = [];
    expect((await readCalendarRange('disconnected', range())).connected).toBe(false);
    expect(mocks.token).not.toHaveBeenCalled();
    mocks.connection.enabled = ['calendar'];
    mocks.read.mockImplementationOnce(async () => { mocks.connection = { ...mocks.connection, epoch: 'new' }; return { items: [], partial: false }; });
    await expect(readCalendarRange('changed-during-read', range())).rejects.toThrow('Google連携が変わりました');
  });
});
