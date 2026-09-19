// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessToken, cacheRef, connectionRef, finishGoogleOAuth, startGoogleOAuth, type Connection } from './oauth';
import { SCOPES, seal, unseal } from './security';
import { refreshWorkspace, selectWorkspace, workspaceView } from './repository';
import { emptyGoogleSource } from './types';

const fake = vi.hoisted(() => ({ documents: new Map<string, unknown>() }));
vi.mock('@/lib/firebase/admin', () => {
  interface FakeRef { path: string; get: () => Promise<{ data: () => unknown }>; set: (data: unknown) => Promise<void>; collection: (name: string) => { doc: (id: string) => FakeRef } }
  const ref = (path: string): FakeRef => ({ path,
    get: async () => ({ data: () => fake.documents.get(path) }), set: async (data: unknown) => { fake.documents.set(path, data); }, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  return { getAdminDb: () => ({ doc: ref, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: (() => void)[] = [];
    const result = await fn({ get: (r: ReturnType<typeof ref>) => r.get(), set: (r: ReturnType<typeof ref>, data: unknown) => writes.push(() => { fake.documents.set(r.path, data); }),
      update: (r: ReturnType<typeof ref>, data: object) => writes.push(() => { fake.documents.set(r.path, { ...(fake.documents.get(r.path) as object), ...data }); }), delete: (r: ReturnType<typeof ref>) => writes.push(() => { fake.documents.delete(r.path); }) });
    for (const write of writes) write(); return result;
  } }) };
});
beforeEach(() => {
  fake.documents.clear();
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'synthetic-client'); vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3003/api/google/callback'); vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('GOOGLE_WORKSPACE_NAMESPACE', 'synthetic');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setupOAuth(scopes = SCOPES.calendar.join(' '), email = 'u@1000ri.jp') {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: scopes })).mockResolvedValueOnce(Response.json({ email, email_verified: true, hd: '1000ri.jp' })); vi.stubGlobal('fetch', fetch);
  const started = await startGoogleOAuth('u', 'u@1000ri.jp', 'calendar');
  const state = new URL(started.url).searchParams.get('state')!;
  return { ...started, state, fetch };
}
describe('Google OAuth persistent connection', () => {
  it('requires matching browser state and uses a one-time PKCE exchange', async () => {
    const flow = await setupOAuth();
    const url = new URL(flow.url);
    expect(url.searchParams.get('access_type')).toBe('offline'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(finishGoogleOAuth(flow.cookie, 'wrong', 'code')).rejects.toThrow(); expect(flow.fetch).not.toHaveBeenCalled();
    await expect(finishGoogleOAuth(flow.cookie, flow.state, 'code')).resolves.toBe('calendar');
    expect(new URLSearchParams(flow.fetch.mock.calls[0][1].body).get('code_verifier')).toBeTruthy();
    const saved = (await connectionRef('u').get()).data() as Connection;
    expect(saved.email).toBe('u@1000ri.jp'); expect(saved.enabled).toEqual(['calendar']);
    expect(JSON.stringify(saved)).not.toContain('synthetic-refresh');
    expect(unseal(saved.credentials, 'u:tokens')).toMatchObject({ refreshToken: 'synthetic-refresh' });
    await expect(finishGoogleOAuth(flow.cookie, flow.state, 'code')).rejects.toThrow(); expect(flow.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a wrong account or missing permission without saving a connection', async () => {
    let flow = await setupOAuth(SCOPES.calendar.join(' '), 'other@1000ri.jp');
    await expect(finishGoogleOAuth(flow.cookie, flow.state, 'code')).rejects.toThrow('同じ会社');
    expect((await connectionRef('u').get()).data()).toBeUndefined();
    flow = await setupOAuth('openid email');
    await expect(finishGoogleOAuth(flow.cookie, flow.state, 'code')).rejects.toThrow('権限');
    expect((await connectionRef('u').get()).data()).toBeUndefined();
  });
  it('overwrites pending state and rejects the superseded callback', async () => {
    const flow = await setupOAuth(); await startGoogleOAuth('u', 'u@1000ri.jp', 'gmail');
    await expect(finishGoogleOAuth(flow.cookie, flow.state, 'code')).rejects.toThrow();
    expect(flow.fetch).not.toHaveBeenCalled(); expect(fake.documents.size).toBe(1);
  });
  it('refreshes an expired token once for concurrent reads, keeping it server-side', async () => {
    const flow = await setupOAuth(); await finishGoogleOAuth(flow.cookie, flow.state, 'code');
    const saved = (await connectionRef('u').get()).data() as Connection;
    saved.credentials = seal({ accessToken: 'old', refreshToken: 'synthetic-refresh', expiresAt: 0 }, 'u:tokens');
    await connectionRef('u').set(saved);
    const fetch = vi.fn().mockResolvedValue(Response.json({ access_token: 'new-access', expires_in: 3600 })); vi.stubGlobal('fetch', fetch);
    expect(await Promise.all([accessToken('u', saved), accessToken('u', saved)])).toEqual(['new-access', 'new-access']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the hourly cache, allows manual refresh, and keeps prior data on failure', async () => {
    const flow = await setupOAuth(); await finishGoogleOAuth(flow.cookie, flow.state, 'code');
    const fetch = vi.fn().mockResolvedValue(Response.json({ items: [{ id: 'e', summary: 'saved', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }] })); vi.stubGlobal('fetch', fetch);
    const initial = await refreshWorkspace('u', 60, false); expect(initial.sources.calendar.items).toHaveLength(1);
    await refreshWorkspace('u', 60, false); await refreshWorkspace('u', 0, false); expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(Response.json({}, { status: 403 }));
    const failed = await refreshWorkspace('u', 60, true);
    expect(fetch).toHaveBeenCalledTimes(2); expect(failed.sources.calendar.status).toBe('error');
    expect(failed.sources.calendar.items).toEqual(initial.sources.calendar.items);
    expect(failed.sources.calendar.fetchedAt).toBe(initial.sources.calendar.fetchedAt);
  });
  it('migrates old selections on reconnect without dropping existing calendar reading', async () => {
    const flow = await setupOAuth(); await finishGoogleOAuth(flow.cookie, flow.state, 'code');
    const saved = (await connectionRef('u').get()).data() as Connection;
    delete saved.gmailLabels; delete saved.selectedCalendars;
    saved.gmailLabel = { id: 'Work', name: 'Work' }; await connectionRef('u').set(saved);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'next', expires_in: 3600, scope: [SCOPES.calendar[0], ...SCOPES.gmail].join(' ') }))
      .mockResolvedValueOnce(Response.json({ email: 'u@1000ri.jp', email_verified: true, hd: '1000ri.jp' })); vi.stubGlobal('fetch', fetch);
    const next = await startGoogleOAuth('u', 'u@1000ri.jp', 'gmail');
    await finishGoogleOAuth(next.cookie, new URL(next.url).searchParams.get('state')!, 'code');
    const updated = (await connectionRef('u').get()).data() as Connection;
    expect(updated.enabled).toEqual(['calendar', 'gmail']);
    expect(updated.gmailLabels).toEqual([{ id: 'Work', name: 'Work' }]); expect(updated.selectedCalendars?.[0].id).toBe('primary');
    expect(workspaceView(updated, undefined).calendarSelectionAvailable).toBe(false);
  });
  it('saves multiple labels or no calendars while preserving other source caches', async () => {
    const flow = await setupOAuth(); await finishGoogleOAuth(flow.cookie, flow.state, 'code');
    const saved = (await connectionRef('u').get()).data() as Connection;
    saved.enabled.push('gmail'); await connectionRef('u').set(saved);
    const calendar = { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: '2026-09-10T01:00:00Z' };
    await cacheRef('u').set({ epoch: saved.epoch, sources: { calendar, gmail: calendar } });
    const fetch = vi.fn().mockImplementation(async () => Response.json({ labels: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }] })); vi.stubGlobal('fetch', fetch);
    const selected = await selectWorkspace('u', 'gmail', ['A', 'B']);
    expect(selected.gmailLabels.map(l => l.id)).toEqual(['A', 'B']); expect(selected.sources.calendar).toEqual(calendar);
    expect(selected.sources.gmail.status).toBe('pending');
    await expect(selectWorkspace('u', 'gmail', ['unknown'])).rejects.toThrow('アクセス');
    await expect(selectWorkspace('u', 'gmail', ['A', 'A'])).rejects.toThrow('重複');
    fetch.mockResolvedValue(Response.json({ items: [{ id: 'u@1000ri.jp', primary: true, summary: 'Mine' }] }));
    const empty = await selectWorkspace('u', 'calendar', []);
    expect(empty.selectedCalendars).toEqual([]); expect(empty.sources.calendar.status).toBe('selection_required');
    expect(empty.gmailLabels.map(l => l.id)).toEqual(['A', 'B']);
  });
  it('fetches a new selection while an older refresh is still running', async () => {
    const flow = await setupOAuth(); await finishGoogleOAuth(flow.cookie, flow.state, 'code');
    let releaseOld!: (value: Response) => void;
    const delayed = new Promise<Response>(resolve => { releaseOld = resolve; });
    const event = (id: string) => ({ id, start: { date: '2026-09-10' }, end: { date: '2026-09-11' } });
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/primary/events')) return delayed;
      if (url.includes('/calendarList?')) return Response.json({ items: [{ id: 'other', summary: 'Work' }] });
      return Response.json({ items: [event('new')] });
    }); vi.stubGlobal('fetch', fetch);
    const older = refreshWorkspace('u', 60, false);
    await vi.waitFor(() => expect(fetch.mock.calls.some(c => c[0].includes('/primary/events'))).toBe(true));
    await selectWorkspace('u', 'calendar', ['other']);
    const newer = refreshWorkspace('u', 60, false);
    try { await vi.waitFor(() => expect(fetch.mock.calls.some(c => c[0].includes('/other/events'))).toBe(true)); }
    finally { releaseOld(Response.json({ items: [event('old')] })); }
    const results = await Promise.all([older, newer]);
    for (const result of results) expect(result.sources.calendar.items.map(item => item.id)).toEqual(['other:new']);
  });
});
