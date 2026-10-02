import { Timestamp } from 'firebase-admin/firestore';

export type ChangeTime = { seconds: number; nanoseconds: number };
export type TaskChangeCursor =
  | { v: 1; project: string; kind: 'checkpoint'; at: ChangeTime }
  | { v: 1; project: string; kind: 'page'; mode: 'bootstrap' | 'delta'; at: ChangeTime; from?: ChangeTime; after: { id: string; at?: ChangeTime } };
export const PAGE_CURSOR_MAX_AGE_MS = 45 * 60 * 1000;
// REQUEST_TIME is millisecond precision, not the document's precise updateTime.
// Re-read a bounded overlap; callers deduplicate by id/changeVersion.
export const CHANGE_OVERLAP_SECONDS = 60;
export const changeLowerBound = (time: ChangeTime): ChangeTime => time.seconds < CHANGE_OVERLAP_SECONDS ? { seconds: 0, nanoseconds: 0 } : ({ seconds: time.seconds - CHANGE_OVERLAP_SECONDS, nanoseconds: Math.floor(time.nanoseconds / 1_000_000) * 1_000_000 });
export class TaskChangeError extends Error {
  constructor(message: string, public readonly status: number = 400) { super(message); }
}
export const changeTime = (timestamp: Timestamp): ChangeTime => ({ seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds });
export const asTimestamp = (time: ChangeTime) => new Timestamp(time.seconds, time.nanoseconds);
export const timeCompare = (a: ChangeTime, b: ChangeTime) => a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
export const timeIso = (time: ChangeTime) => new Date(time.seconds * 1000).toISOString().replace('.000Z', `.${String(time.nanoseconds).padStart(9, '0')}Z`);
export const encodeChangeCursor = (cursor: TaskChangeCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
const isTime = (value: unknown): value is ChangeTime => {
  if (!value || typeof value !== 'object') return false;
  const t = value as ChangeTime;
  return Number.isInteger(t.seconds) && t.seconds >= 0 && t.seconds <= 253402300799 && Number.isInteger(t.nanoseconds) && t.nanoseconds >= 0 && t.nanoseconds < 1e9;
};

/** Cursors are positions, not credentials. Recheck current project access on every request. */
export function decodeChangeCursor(raw: string | null, project: string, now = Date.now()): TaskChangeCursor | null {
  if (raw === null) return null;
  let c: TaskChangeCursor;
  try {
    if (!raw || raw.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!c || c.v !== 1 || c.project !== project || !isTime(c.at) || c.at.nanoseconds % 1000 !== 0 || asTimestamp(c.at).toMillis() > now + 60_000) throw new Error();
    if (c.kind === 'page') {
      if (!c.after || typeof c.after.id !== 'string' || !c.after.id || c.after.id.includes('/') || ['.', '..'].includes(c.after.id) || Buffer.byteLength(c.after.id) > 1500 || Buffer.from(c.after.id).toString('utf8') !== c.after.id || !['bootstrap', 'delta'].includes(c.mode)) throw new Error();
      if (c.mode === 'delta' && (!isTime(c.from) || !isTime(c.after.at) || timeCompare(c.from, c.after.at) > 0 || timeCompare(c.after.at, c.at) > 0)) throw new Error();
      if (c.mode === 'bootstrap' && (c.from !== undefined || c.after.at !== undefined)) throw new Error();
    } else if (c.kind !== 'checkpoint') throw new Error();
  } catch { throw new TaskChangeError('INVALID_CURSOR'); }
  if (c.kind === 'page' && now - asTimestamp(c.at).toMillis() > PAGE_CURSOR_MAX_AGE_MS) throw new TaskChangeError('CURSOR_EXPIRED', 409);
  return c;
}

export function parseChangeLimit(raw: string | null): number {
  if (raw === null) return 100;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 200) throw new TaskChangeError('INVALID_LIMIT');
  return Number(raw);
}
