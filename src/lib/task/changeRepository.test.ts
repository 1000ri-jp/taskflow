// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { listProjectTaskChanges } from './changeRepository';
import { asTimestamp, changeTime, decodeChangeCursor, encodeChangeCursor, PAGE_CURSOR_MAX_AGE_MS, timeCompare, timeIso } from './changeCursor';

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));
type Row = { id: string; at: Timestamp; data: Record<string, unknown> };
let versions: Row[], now: Timestamp;
let baseSeconds: number;
let requests: { query: Query; readTime?: Timestamp }[];
const stamp = (offset: number, nanos = 0) => new Timestamp(baseSeconds + offset, nanos);
const compare = (a: Timestamp, b: Timestamp) => timeCompare(changeTime(a), changeTime(b));
class Query {
  constructor(public path: string, public lower?: Timestamp, public orders: string[] = [], public after?: unknown[], public maximum = Infinity) {}
  doc(id: string) { return new Query(`${this.path}/${id}`); }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  where(field: string, op: string, at: Timestamp) { expect([field, op]).toEqual(['apiChangedAt', '>=']); this.lower = at; return this; }
  orderBy(field: unknown, direction: string) { expect(direction).toBe('asc'); this.orders.push(typeof field === 'string' ? field : '__name__'); return this; }
  startAfter(...values: unknown[]) { this.after = values; return this; }
  limit(n: number) { this.maximum = n; return this; }
}
const write = (id: string, at: Timestamp, data: Record<string, unknown>, legacy = false) => versions.push({ id, at, data: { title: id, listId: 'todo', isArchived: false, updatedAt: at, ...data, ...(!legacy ? { apiChangedAt: at } : {}) } });
beforeEach(() => {
  baseSeconds = Math.floor(Date.now() / 1000) - 100;
  versions = []; requests = []; now = stamp(20);
  fake.db = { collection: (p: string) => new Query(p), runTransaction: async (fn: (tx: unknown) => Promise<unknown>, options: { readTime?: Timestamp }) => fn({
    get: async (query: Query) => {
      requests.push({ query, readTime: options.readTime });
      expect(query.path).toBe('projects/p/tasks');
      const at = options.readTime ?? now;
      const latest = new Map<string, Row>();
      for (const row of versions) if (compare(row.at, at) <= 0) latest.set(row.id, row);
      let rows = [...latest.values()].filter(row => !query.lower || row.data.apiChangedAt instanceof Timestamp && compare(row.data.apiChangedAt, query.lower) >= 0);
      rows.sort((a, b) => (query.lower ? compare(a.data.apiChangedAt as Timestamp, b.data.apiChangedAt as Timestamp) : 0) || a.id.localeCompare(b.id));
      if (query.after) rows = rows.filter(row => query.lower ? compare(row.data.apiChangedAt as Timestamp, query.after![0] as Timestamp) > 0 || compare(row.data.apiChangedAt as Timestamp, query.after![0] as Timestamp) === 0 && row.id > query.after![1]! : row.id > query.after![0]!);
      return { readTime: at, docs: rows.slice(0, query.maximum).map(row => ({ id: row.id, updateTime: row.at, data: () => row.data, get: (key: string) => row.data[key] })) };
    },
  }) };
});

describe('task state delta query', () => {
  it('bootstraps legacy documents without a marker, including archived tasks; empty projects get checkpoints', async () => {
    const empty = await listProjectTaskChanges('p', null, 2);
    expect(empty.tasks).toEqual([]); expect(empty.checkpoint).toBeTruthy();
    write('old', stamp(1), { isArchived: true }, true);
    const result = await listProjectTaskChanges('p', null, 2);
    expect(result.tasks).toMatchObject([{ id: 'old', isArchived: true }]);
    expect(requests.at(-1)!.query.lower).toBeUndefined(); expect(requests.at(-1)!.query.maximum).toBe(3);
  });
  it('separates identical timestamps by document ID and uses a bounded server query', async () => {
    for (const id of ['a', 'b', 'c', 'd']) write(id, stamp(10, 123000), {});
    const checkpoint = encodeChangeCursor({ v: 1, project: 'p', kind: 'checkpoint', at: changeTime(stamp(5)) });
    const a = await listProjectTaskChanges('p', checkpoint, 2);
    const b = await listProjectTaskChanges('p', a.nextCursor, 2);
    expect(a.tasks.map(t => t.id)).toEqual(['a', 'b']); expect(b.tasks.map(t => t.id)).toEqual(['c', 'd']);
    expect(a.checkpoint).toBeNull(); expect(b.nextCursor).toBeNull(); expect(b.checkpoint).toBeTruthy();
    expect(requests.map(r => r.query.maximum)).toEqual([3, 3]);
    expect(requests[0].query.orders).toEqual(['apiChangedAt', '__name__']);
    expect(requests[1].readTime?.isEqual(asTimestamp(decodeChangeCursor(a.nextCursor, 'p')!.at))).toBe(true);
  });
  it('keeps bootstrap pages stable while writes and inserts happen; next round catches them', async () => {
    write('a', stamp(1), {}, true); write('b', stamp(1), {}, true); write('c', stamp(1), {}, true);
    const first = await listProjectTaskChanges('p', null, 1);
    write('a', stamp(21), { isCompleted: true }); write('b', stamp(21), { listId: 'done' }); write('aa', stamp(21), {}); now = stamp(22);
    const second = await listProjectTaskChanges('p', first.nextCursor, 1);
    expect(second.tasks[0]).toMatchObject({ id: 'b', listId: 'todo', isCompleted: false });
    const third = await listProjectTaskChanges('p', second.nextCursor, 1);
    expect(third.tasks.map(t => t.id)).toEqual(['c']);
    const delta = await listProjectTaskChanges('p', third.checkpoint, 10);
    expect(delta.tasks.map(t => t.id)).toEqual(['a', 'aa', 'b']);
  });
  it('keeps delta pages stable even when a pending task is updated and changes its sort position', async () => {
    for (const id of ['a', 'b', 'c']) write(id, stamp(10), {});
    const checkpoint = encodeChangeCursor({ v: 1, project: 'p', kind: 'checkpoint', at: changeTime(stamp(5)) });
    const first = await listProjectTaskChanges('p', checkpoint, 1);
    write('b', stamp(21), { isCompleted: true }); now = stamp(22);
    const second = await listProjectTaskChanges('p', first.nextCursor, 2);
    expect(second.tasks.map(t => t.id)).toEqual(['b', 'c']); expect(second.tasks[0].isCompleted).toBe(false);
    const delta = await listProjectTaskChanges('p', second.checkpoint, 10);
    expect(delta.tasks.find(t => t.id === 'b')).toMatchObject({ isCompleted: true });
  });
  it('includes the watermark boundary, preserves submillisecond versions and retries the same page', async () => {
    write('a', stamp(20, 0), {}); write('b', stamp(20, 1000), { isArchived: true }); now = stamp(21);
    const checkpoint = encodeChangeCursor({ v: 1, project: 'p', kind: 'checkpoint', at: changeTime(stamp(20)) });
    const first = await listProjectTaskChanges('p', checkpoint, 1);
    expect(first.tasks[0].id).toBe('a');
    const page = await listProjectTaskChanges('p', first.nextCursor, 1);
    expect(page.tasks[0].changeVersion).not.toBe(first.tasks[0].changeVersion);
    expect(await listProjectTaskChanges('p', first.nextCursor, 1)).toEqual(page);
    expect(timeIso(changeTime(stamp(20, 1000)))).toMatch(/\.000001000Z$/);
  });
});

it('re-reads the millisecond boundary and the overlap when the commit version is later than its server transform', async () => {
  now = stamp(20, 123456000);
  const first = await listProjectTaskChanges('p', null, 10);
  write('late', stamp(21), { isCompleted: true });
  versions.at(-1)!.data.apiChangedAt = stamp(20, 123000000);
  now = stamp(22);
  const next = await listProjectTaskChanges('p', first.checkpoint, 10);
  expect(next.tasks).toMatchObject([{ id: 'late', isCompleted: true }]);
  expect(requests.at(-1)!.query.lower).toEqual(new Timestamp(stamp(20).seconds - 60, 123000000));
});

describe('cursor safety', () => {
  it('rejects foreign projects, malformed positions and expired pages while old completed checkpoints remain usable', () => {
    const old = { v: 1 as const, project: 'p', kind: 'page' as const, mode: 'bootstrap' as const, at: changeTime(Timestamp.fromMillis(Date.now() - PAGE_CURSOR_MAX_AGE_MS - 1)), after: { id: 'a' } };
    expect(() => decodeChangeCursor(encodeChangeCursor(old), 'p')).toThrow('CURSOR_EXPIRED');
    expect(() => decodeChangeCursor(encodeChangeCursor({ ...old, kind: 'checkpoint' }), 'p')).not.toThrow();
    expect(() => decodeChangeCursor(encodeChangeCursor(old), 'q')).toThrow('INVALID_CURSOR');
    for (const c of [null, { ...old, at: { seconds: 1, nanoseconds: -1 } }, { ...old, after: { id: '../other' } }, { ...old, mode: 'delta' }]) expect(() => decodeChangeCursor(Buffer.from(JSON.stringify(c)).toString('base64url'), 'p')).toThrow('INVALID_CURSOR');
  });
});

it('includes the exact rounded 60-second boundary and documents the older-delay limit', async () => {
  now = stamp(20, 123456000);
  const first = await listProjectTaskChanges('p', null, 10);
  for (const [id, marker] of [['boundary', stamp(-40, 123000000)], ['outside', stamp(-40, 122999000)]] as const) {
    write(id, stamp(21), {}); versions.at(-1)!.data.apiChangedAt = marker;
  }
  now = stamp(22);
  const result = await listProjectTaskChanges('p', first.checkpoint, 10);
  expect(result.tasks.map(t => t.id)).toEqual(['boundary']);
  const full = await listProjectTaskChanges('p', null, 10);
  expect(full.tasks.map(t => t.id)).toEqual(['boundary', 'outside']);
});
it('requires a fresh full round for a task created or updated by an old unstamped writer', async () => {
  const checkpoint = (await listProjectTaskChanges('p', null, 10)).checkpoint;
  write('old-client', stamp(21), { title: 'late old client' }, true); now = stamp(22);
  expect((await listProjectTaskChanges('p', checkpoint, 10)).tasks).toEqual([]);
  expect((await listProjectTaskChanges('p', null, 10)).tasks).toMatchObject([{ id: 'old-client', title: 'late old client' }]);
});
it('returns a missing legacy business date as null instead of inventing a current update', async () => {
  write('old', stamp(1), {}, true);
  for (const value of [undefined, null, 'not-a-stored-timestamp']) {
    versions[0].data.updatedAt = value;
    expect((await listProjectTaskChanges('p', null, 10)).tasks[0].updatedAt).toBeNull();
  }
});
it.each(['.', '..', '\ud800', 'a/b'])('rejects malformed document position %j before a query', async id => {
  const cursor = encodeChangeCursor({ v: 1, project: 'p', kind: 'page', mode: 'bootstrap', at: changeTime(now), after: { id } });
  await expect(listProjectTaskChanges('p', cursor, 10)).rejects.toThrow('INVALID_CURSOR'); expect(requests).toEqual([]);
});
it('continues a bootstrap containing a pre-existing imported document identifier', async () => {
  write('__id42__', stamp(1), {}, true); write('ordinary', stamp(1), {}, true);
  const first = await listProjectTaskChanges('p', null, 1);
  expect(first.tasks[0].id).toBe('__id42__');
  expect((await listProjectTaskChanges('p', first.nextCursor, 1)).tasks.map(t => t.id)).toEqual(['ordinary']);
});
it('rejects an unsupported readTime precision before a query', async () => {
  const cursor = encodeChangeCursor({ v: 1, project: 'p', kind: 'page', mode: 'bootstrap', at: changeTime(stamp(20, 1)), after: { id: 'a' } });
  await expect(listProjectTaskChanges('p', cursor, 10)).rejects.toThrow('INVALID_CURSOR'); expect(requests).toEqual([]);
});
it('rejects a foreign-project cursor before a query', async () => {
  const cursor = encodeChangeCursor({ v: 1, project: 'q', kind: 'checkpoint', at: changeTime(now) });
  await expect(listProjectTaskChanges('p', cursor, 10)).rejects.toThrow('INVALID_CURSOR'); expect(requests).toEqual([]);
});
it('treats a well-formed edited cursor only as a position and still fixes the query project', async () => {
  write('task', stamp(10), {});
  const edited = encodeChangeCursor({ v: 1, project: 'p', kind: 'checkpoint', at: changeTime(stamp(-1000)) });
  expect((await listProjectTaskChanges('p', edited, 10)).tasks.map(t => t.id)).toEqual(['task']);
  expect(requests[0].query.path).toBe('projects/p/tasks');
});
