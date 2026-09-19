import { randomUUID } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import { accessToken, cacheRef, connectionRef, type Connection } from './oauth';
import { CALENDAR_LIST_SCOPE, GoogleWorkspaceError, isGoogleConfigured } from './security';
import { emptyGoogleWorkspace, googleSelections, GOOGLE_SERVICES, MAX_GOOGLE_SELECTIONS, type GoogleService, type GoogleSource, type GoogleWorkspaceView } from './types';
import { readGoogleChoices, readGoogleItems } from './readers';

interface Cache { epoch: string; sources: Partial<Record<GoogleService, GoogleSource>> }
export function workspaceView(connection: Connection | undefined, cache: Cache | undefined): GoogleWorkspaceView {
  const view = emptyGoogleWorkspace(isGoogleConfigured());
  if (!connection) return view;
  view.email = connection.email; view.gmailLabels = googleSelections(connection, 'gmail');
  view.selectedCalendars = googleSelections(connection, 'calendar'); view.selectedSpaces = connection.selectedSpaces;
  view.calendarSelectionAvailable = connection.scopes.includes(CALENDAR_LIST_SCOPE);
  for (const service of GOOGLE_SERVICES) {
    if (!connection.enabled.includes(service)) continue;
    view.sources[service] = cache?.epoch === connection.epoch && cache.sources[service] ? cache.sources[service]! : {
      ...view.sources[service], connected: true, status: !googleSelections(connection, service).length ? 'selection_required' : 'pending',
    };
  }
  return view;
}
export async function readWorkspace(uid: string) {
  if (!isGoogleConfigured()) return emptyGoogleWorkspace();
  const [connection, cache] = await Promise.all([connectionRef(uid).get(), cacheRef(uid).get()]);
  return workspaceView(connection.data() as Connection | undefined, cache.data() as Cache | undefined);
}
const refreshes = new Map<string, Promise<GoogleWorkspaceView>>();
export async function refreshWorkspace(uid: string, minutes: number, force: boolean) {
  if (!isGoogleConfigured()) return emptyGoogleWorkspace();
  const connection = (await connectionRef(uid).get()).data() as Connection | undefined;
  if (!connection) return emptyGoogleWorkspace(true);
  const key = `${uid}:${connection.epoch}`;
  const existing = refreshes.get(key); if (existing) return existing;
  const request = (async () => {
    const view = workspaceView(connection, (await cacheRef(uid).get()).data() as Cache | undefined);
    const now = Date.now();
    const due = connection.enabled.filter(s => {
      if (!googleSelections(connection, s).length) return false;
      const last = view.sources[s].attemptedAt;
      return force || !last || now - Date.parse(last) >= (minutes === 0 ? Infinity : minutes * 60000);
    });
    if (!due.length) return view;
    let token = ''; let tokenError: unknown;
    try { token = await accessToken(uid, connection); } catch (e) { tokenError = e; }
    const sources: Partial<Record<GoogleService, GoogleSource>> = {};
    for (const service of due) {
      const previous = view.sources[service]; const attemptedAt = new Date().toISOString();
      try {
        if (tokenError) throw tokenError;
        const result = await readGoogleItems(service, token, connection);
        sources[service] = { connected: true, fetchedAt: attemptedAt, attemptedAt, status: result.partial ? 'partial' : 'ready',
          error: result.partial ? '取得範囲の一部です。上限を超えた情報や本文以外は含まれません。' : null, items: result.items };
      } catch (e) {
        sources[service] = { ...previous, connected: true, attemptedAt, status: 'error', error: e instanceof GoogleWorkspaceError ? e.message : '取得できませんでした。前回の情報を保持しています。' };
      }
    }
    await getAdminDb().runTransaction(async tx => {
      const latest = (await tx.get(connectionRef(uid))).data() as Connection | undefined;
      const old = (await tx.get(cacheRef(uid))).data() as Cache | undefined;
      if (latest?.epoch !== connection.epoch) return;
      tx.set(cacheRef(uid), { epoch: connection.epoch, sources: { ...(old?.epoch === connection.epoch ? old.sources : {}), ...sources } } satisfies Cache);
    });
    return readWorkspace(uid);
  })();
  refreshes.set(key, request); try { return await request; } finally { refreshes.delete(key); }
}
export async function workspaceChoices(uid: string, service: GoogleService) {
  const connection = (await connectionRef(uid).get()).data() as Connection | undefined;
  if (!connection?.enabled.includes(service)) throw new GoogleWorkspaceError('RECONNECT', '先にGoogleと接続してください。', 400);
  if (service === 'calendar' && !connection.scopes.includes(CALENDAR_LIST_SCOPE)) throw new GoogleWorkspaceError('RECONNECT', 'カレンダーの一覧を表示するため、カレンダーを再接続してください。', 400);
  return readGoogleChoices(service, await accessToken(uid, connection));
}
export async function selectWorkspace(uid: string, service: GoogleService, ids: string[]) {
  const before = (await connectionRef(uid).get()).data() as Connection | undefined;
  if (!before?.enabled.includes(service)) throw new GoogleWorkspaceError('RECONNECT', '先にGoogleと接続してください。', 400);
  if (ids.length > MAX_GOOGLE_SELECTIONS || new Set(ids).size !== ids.length) throw new GoogleWorkspaceError('INVALID', '取得対象は重複なく最大5つを選んでください。', 422);
  const { choices } = await readGoogleChoices(service, await accessToken(uid, before));
  const selected = ids.map(id => choices.find(c => c.id === id));
  if (selected.some(s => !s)) throw new GoogleWorkspaceError('INVALID', 'アクセスできる一覧から選んでください。', 422);
  await getAdminDb().runTransaction(async tx => {
    const ref = connectionRef(uid); const current = (await tx.get(ref)).data() as Connection | undefined;
    if (current?.epoch !== before.epoch) throw new GoogleWorkspaceError('CONNECTION_CHANGED', '設定が変わりました。更新してください。', 409);
    const cache = (await tx.get(cacheRef(uid))).data() as Cache | undefined;
    const epoch = randomUUID();
    tx.update(ref, { epoch, [service === 'chat' ? 'selectedSpaces' : service === 'calendar' ? 'selectedCalendars' : 'gmailLabels']: selected });
    // Keep the other services' fresh data when only one acquisition range changes.
    const sources = { ...(cache?.epoch === current.epoch ? cache.sources : {}) };
    delete sources[service];
    tx.set(cacheRef(uid), { epoch, sources });
  });
  return readWorkspace(uid);
}
export async function disconnectWorkspace(uid: string, service: GoogleService) {
  await getAdminDb().runTransaction(async tx => {
    const ref = connectionRef(uid); const current = (await tx.get(ref)).data() as Connection | undefined;
    if (!current) return;
    const enabled = current.enabled.filter(s => s !== service);
    if (!enabled.length) tx.delete(ref);
    else tx.update(ref, { enabled, epoch: randomUUID(), ...(service === 'chat' ? { selectedSpaces: [] } : {}) });
    tx.delete(cacheRef(uid));
  });
  return readWorkspace(uid);
}
