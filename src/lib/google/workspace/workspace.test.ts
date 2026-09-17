// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertGoogleAccount, googleConfig, SCOPES, seal, unseal } from './security';
import { readGoogleChoices, readGoogleItems } from './readers';
import { workspaceView } from './repository';
import { emptyGoogleSource } from './types';
import type { Connection } from './oauth';

const config = () => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'synthetic-client'); vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3003/api/google/callback');
  vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('GOOGLE_WORKSPACE_NAMESPACE', 'synthetic');
};
const connection: Connection = { epoch: 'one', email: 'test@1000ri.jp', clientId: 'synthetic-client', credentials: '', scopes: SCOPES.calendar,
  enabled: ['calendar', 'gmail', 'chat'], selectedSpaces: [], gmailLabel: { id: 'INBOX', name: '受信トレイ' } };
beforeEach(config);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('Google Workspace isolation and source handling', () => {
  it('encrypts tokens with user and environment binding, detecting tampering', () => {
    const token = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
    const sealed = seal(token, 'u:tokens'); expect(sealed).not.toContain('synthetic');
    expect(unseal(sealed, 'u:tokens')).toEqual(token);
    expect(() => unseal(sealed, 'v:tokens')).toThrow();
    const raw = Buffer.from(sealed, 'base64url'); raw[30] ^= 1;
    expect(() => unseal(raw.toString('base64url'), 'u:tokens')).toThrow();
    vi.stubEnv('GOOGLE_WORKSPACE_NAMESPACE', 'other'); expect(() => unseal(sealed, 'u:tokens')).toThrow();
  });
  it('requires the exact verified company account and fixed safe callback', () => {
    expect(() => assertGoogleAccount({ email: 'test@1000ri.jp', email_verified: true, hd: '1000ri.jp' }, 'test@1000ri.jp')).not.toThrow();
    for (const profile of [
      { email: 'other@1000ri.jp', email_verified: true, hd: '1000ri.jp' },
      { email: 'test@1000ri.jp', email_verified: false, hd: '1000ri.jp' },
      { email: 'test@1000ri.jp', email_verified: true, hd: 'other.jp' },
    ]) expect(() => assertGoogleAccount(profile, 'test@1000ri.jp')).toThrow();
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://untrusted.example/api/google/callback'); expect(() => googleConfig()).toThrow();
  });
  it('does not expose old cache after disconnect or configuration change', () => {
    const source = { ...emptyGoogleSource(), connected: true, status: 'ready' as const, fetchedAt: '2026-09-10T01:00:00Z', items: [{ id: 'x', title: 'synthetic private', text: '', at: '2026-09-10T01:00:00Z', url: '', sourceName: '' }] };
    expect(workspaceView(connection, { epoch: 'one', sources: { calendar: source } }).sources.calendar.items).toHaveLength(1);
    expect(workspaceView({ ...connection, epoch: 'two' }, { epoch: 'one', sources: { calendar: source } }).sources.calendar.items).toEqual([]);
    expect(workspaceView({ ...connection, enabled: [] }, { epoch: 'one', sources: { calendar: source } }).sources.calendar.connected).toBe(false);
    expect(workspaceView(undefined, { epoch: 'one', sources: { calendar: source } }).email).toBeNull();
  });
  it('reads a bounded JST calendar window and labels truncation rather than claiming completeness', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ items: [
      { id: 'e', summary: 'all day', start: { date: '2026-09-11' }, end: { date: '2026-09-12' } },
      { id: 'cancelled', status: 'cancelled' },
    ], nextPageToken: 'more' })); vi.stubGlobal('fetch', fetch);
    const result = await readGoogleItems('calendar', 'synthetic', connection, new Date('2026-09-10T16:00:00Z'));
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('timeMin')).toBe('2026-09-10T15:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-09-18T15:00:00.000Z');
    expect(url.searchParams.get('maxResults')).toBe('100');
    expect(result).toMatchObject({ partial: true, items: [{ id: 'primary:e', allDay: true, at: '2026-09-11T00:00:00+09:00' }] });
  });
  it('reads working-location metadata in the existing request without discarding any event', async () => {
    const events = [
      { id: 'home', summary: '自宅', eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice' } },
      { id: 'office', summary: 'オフィス', eventType: 'workingLocation', workingLocationProperties: { type: 'officeLocation' } },
      { id: 'custom', summary: '自宅', eventType: 'workingLocation', workingLocationProperties: { type: 'customLocation', customLocation: { label: '自宅' } } },
      { id: 'regular', summary: '自宅', location: '自宅', eventType: 'default' },
      { id: 'unclassified', summary: '自宅' },
    ].map(item => ({ ...item, start: { date: '2026-09-12' }, end: { date: '2026-09-13' } }));
    const fetch = vi.fn().mockResolvedValue(Response.json({ items: events })); vi.stubGlobal('fetch', fetch);
    const result = await readGoogleItems('calendar', 'synthetic', connection, new Date('2026-09-12T01:00:00Z'));
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get('fields')).toBe('items(id,summary,start,end,status,htmlLink,eventType,workingLocationProperties(type)),nextPageToken');
    expect(new URL(url).searchParams.has('eventTypes')).toBe(false);
    expect(options.method ?? 'GET').toBe('GET');
    expect(result.partial).toBe(false);
    expect(result.items).toHaveLength(events.length);
    expect(result.items.find(item => item.id === 'primary:home')).toMatchObject({ title: '自宅', eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice' } });
    expect(result.items.find(item => item.id === 'primary:office')).toMatchObject({ eventType: 'workingLocation', workingLocationProperties: { type: 'officeLocation' } });
    expect(result.items.find(item => item.id === 'primary:custom')).toMatchObject({ title: '自宅', workingLocationProperties: { type: 'customLocation' } });
    expect(result.items.find(item => item.id === 'primary:regular')).toMatchObject({ title: '自宅', eventType: 'default' });
    const unclassified = result.items.find(item => item.id === 'primary:unclassified');
    expect(unclassified).not.toHaveProperty('eventType');
    expect(unclassified).not.toHaveProperty('workingLocationProperties');
    const source = { ...emptyGoogleSource(), connected: true, status: 'ready' as const, items: result.items };
    expect(workspaceView(connection, { epoch: 'one', sources: { calendar: source } }).sources.calendar.items).toEqual(result.items);
  });
  it('reads Gmail metadata for only the chosen label and last seven days', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: 'm' }] })).mockResolvedValueOnce(Response.json({ id: 'm', threadId: 't', internalDate: '1788998400000', snippet: '&quot;確認&#39; &amp; &lt;b&gt;本文&lt;/b&gt; &amp;quot;', payload: { headers: [{ name: 'Subject', value: 'subject' }, { name: 'From', value: 'sender' }, { name: 'To', value: 'test@1000ri.jp' }, { name: 'Cc', value: 'team@1000ri.jp' }] } }));
    vi.stubGlobal('fetch', fetch);
    const result = await readGoogleItems('gmail', 'synthetic', { ...connection, gmailLabel: { id: 'Label_1', name: 'Work' } });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('labelIds')).toBe('Label_1');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toBe('newer_than:7d');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('format')).toBe('metadata');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.getAll('metadataHeaders')).toEqual(['Subject', 'From', 'To', 'Cc']);
    expect(result.items[0]).toMatchObject({ conversationId: 't', recipients: 'test@1000ri.jp ／ team@1000ri.jp' });
    expect(result.items[0]).toMatchObject({ title: 'subject', text: '"確認\' & <b>本文</b> &quot;' });
    expect(fetch.mock.calls.every(c => !c[1]?.method || c[1].method === 'GET')).toBe(true);
  });
  it('never reads Chat messages before the user selects a space', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await readGoogleItems('chat', 'synthetic', connection)).toEqual({ items: [], partial: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(workspaceView(connection, undefined).sources.chat.status).toBe('selection_required');
  });
  it('preserves legacy selections while distinguishing an explicit empty selection', async () => {
    const legacy = { ...connection, gmailLabel: { id: 'Label_1', name: 'Work' } };
    expect(workspaceView(legacy, undefined)).toMatchObject({ gmailLabels: [legacy.gmailLabel], selectedCalendars: [{ id: 'primary' }] });
    const empty = { ...legacy, gmailLabels: [], selectedCalendars: [] };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const service of ['calendar', 'gmail'] as const) {
      expect(workspaceView(empty, undefined).sources[service].status).toBe('selection_required');
      expect((await readGoogleItems(service, 'synthetic', empty)).items).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('lists readable calendars, retaining display names and the primary alias', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ items: [
      { id: 'test@1000ri.jp', primary: true, summary: 'My calendar' },
      { id: 'shared@group.calendar.google.com', summary: 'Original', summaryOverride: 'Work' },
    ], nextPageToken: 'more' })); vi.stubGlobal('fetch', fetch);
    expect(await readGoogleChoices('calendar', 'synthetic')).toEqual({ choices: [{ id: 'primary', name: 'My calendar（メイン）' }, { id: 'shared@group.calendar.google.com', name: 'Work' }], partial: true });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('minAccessRole')).toBe('reader');
  });
  it('merges selected calendars by time with unique IDs and bounds the combined output', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => Response.json({ items: Array.from({ length: 60 }, (_, i) => ({
      id: String(i), summary: 'event', start: { date: url.includes('/primary/') ? '2026-09-12' : '2026-09-11' }, end: { date: '2026-09-13' },
    })) })); vi.stubGlobal('fetch', fetch);
    const result = await readGoogleItems('calendar', 'synthetic', { ...connection, selectedCalendars: [{ id: 'primary', name: 'Personal' }, { id: 'team/a', name: 'Work' }] });
    expect(fetch.mock.calls[1][0]).toContain('/team%2Fa/events?');
    expect(result.items).toHaveLength(100); expect(result.partial).toBe(true);
    expect(new Set(result.items.map(i => i.id)).size).toBe(100);
    expect(result.items[0].sourceName).toBe('Work'); expect(result.items.at(-1)?.sourceName).toBe('Personal');
  });
  it('unions Gmail labels, fetches shared messages once, and sorts newest first', async () => {
    const fetch = vi.fn().mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/messages')) return Response.json({ messages: (url.searchParams.get('labelIds') === 'A' ? ['shared', 'a'] : ['shared', 'b']).map(id => ({ id })) });
      const id = url.pathname.split('/').at(-1)!;
      return Response.json({ id, threadId: id, internalDate: String(1788998400000 + (id === 'b' ? 2000 : id === 'a' ? 1000 : 0)) });
    }); vi.stubGlobal('fetch', fetch);
    const result = await readGoogleItems('gmail', 'synthetic', { ...connection, gmailLabels: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }] });
    expect(result.items.map(i => i.id)).toEqual(['b', 'a', 'shared']); expect(result.partial).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.slice(0, 2).map(c => new URL(c[0]).searchParams.getAll('labelIds'))).toEqual([['A'], ['B']]);
  });
  it('marks a failed target as partial and rejects a total calendar failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [] })).mockResolvedValue(Response.json({}, { status: 403 })); vi.stubGlobal('fetch', fetch);
    const multiple = { ...connection, selectedCalendars: [{ id: 'primary', name: 'Personal' }, { id: 'other', name: 'Work' }] };
    expect(await readGoogleItems('calendar', 'synthetic', multiple)).toEqual({ items: [], partial: true });
    await expect(readGoogleItems('calendar', 'synthetic', multiple)).rejects.toThrow('前回の情報');
  });
});
