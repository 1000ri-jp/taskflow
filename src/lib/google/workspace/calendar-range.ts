import { accessToken, connectionRef, type Connection } from './oauth';
import { readGoogleItems } from './readers';
import { GoogleWorkspaceError, isGoogleConfigured } from './security';
import { emptyGoogleSource, googleSelections, type GoogleSource } from './types';

export function parseCalendarRange(startValue: string | null, endValue: string | null) {
  const start = new Date(startValue ?? ''), end = new Date(endValue ?? '');
  // A six-week month, including DST transitions. The endpoint never scans an unbounded calendar.
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 43 * 86400000) {
    throw new GoogleWorkspaceError('INVALID', '表示する期間を確認してください。', 422);
  }
  return { start, end };
}

const cache = new Map<string, { expires: number; source: GoogleSource }>();
const pending = new Map<string, Promise<GoogleSource>>();
export async function readCalendarRange(uid: string, range: { start: Date; end: Date }, force = false) {
  if (!isGoogleConfigured()) return emptyGoogleSource();
  const connection = (await connectionRef(uid).get()).data() as Connection | undefined;
  if (!connection?.enabled.includes('calendar')) return emptyGoogleSource();
  if (!googleSelections(connection, 'calendar').length) return { ...emptyGoogleSource(), connected: true, status: 'selection_required' as const };
  const key = JSON.stringify([uid, connection.epoch, range.start.toISOString(), range.end.toISOString()]);
  const cached = cache.get(key);
  if (!force && cached && cached.expires > Date.now()) return cached.source;
  let request = pending.get(key);
  if (!request) {
    request = (async () => {
      const token = await accessToken(uid, connection);
      const result = await readGoogleItems('calendar', token, connection, new Date(), range);
      const latest = (await connectionRef(uid).get()).data() as Connection | undefined;
      if (latest?.epoch !== connection.epoch || !latest.enabled.includes('calendar')) {
        throw new GoogleWorkspaceError('CONNECTION_CHANGED', 'Google連携が変わりました。もう一度表示してください。', 409);
      }
      const at = new Date().toISOString();
      const source: GoogleSource = { connected: true, fetchedAt: at, attemptedAt: at, status: result.partial ? 'partial' : 'ready',
        error: result.partial ? '予定の一部を表示しています。' : null, items: result.items };
      for (const [entry, value] of cache) if (value.expires <= Date.now()) cache.delete(entry);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + 120000, source });
      return source;
    })();
    pending.set(key, request);
  }
  try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
}
