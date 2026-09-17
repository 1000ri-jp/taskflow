// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { ACTIVITY_PAGE_SIZE, activityEntry, parseHistoryCursor, readTaskHistory } from './repository';
const mock = vi.hoisted(() => ({ db: null as unknown, privateRead: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => mock.db }));
vi.mock('./privateRepository', () => ({ readTaskPrivateSources: mock.privateRead }));
let documents: Map<string, Record<string, unknown>>;
let failActivity = false;
class Ref {
  constructor(public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Collection(`${this.path}/${name}`); }
  async get() { const value = documents.get(this.path); return { exists: !!value, id: this.id, data: () => value }; }
}
class Collection {
  filters: [string, unknown][] = []; maximum = Infinity; cursor?: [Timestamp, string];
  constructor(public path: string) {}
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
  where(field: string, _op: string, value: unknown) { this.filters.push([field, value]); return this; }
  orderBy() { return this; }
  startAfter(at: Timestamp, id: string) { this.cursor = [at, id]; return this; }
  limit(n: number) { this.maximum = n; return this; }
  async get() {
    if (failActivity) throw new Error('index missing');
    let values = [...documents.entries()].filter(([p, d]) => p.startsWith(`${this.path}/`) && p.split('/').length === this.path.split('/').length + 1 && this.filters.every(([key, v]) => d[key] === v));
    const compare = (at: Timestamp, id: string, otherAt: Timestamp, otherId: string) => otherAt.seconds - at.seconds || otherAt.nanoseconds - at.nanoseconds || otherId.localeCompare(id);
    values.sort(([a, av], [b, bv]) => compare(av.createdAt as Timestamp, a.split('/').at(-1)!, bv.createdAt as Timestamp, b.split('/').at(-1)!));
    if (this.cursor) values = values.filter(([p, d]) => compare(d.createdAt as Timestamp, p.split('/').at(-1)!, ...this.cursor!) > 0);
    const docs = values.slice(0, this.maximum).map(([p, d]) => ({ id: p.split('/').at(-1)!, data: () => d }));
    return { docs, size: docs.length };
  }
}
beforeEach(() => {
  documents = new Map([['projects/p/tasks/t', { title: 'task' }]]); failActivity = false;
  mock.db = { collection: (path: string) => new Collection(path) };
  mock.privateRead.mockReset().mockResolvedValue({ entries: [], status: 'ready', issues: [], unavailableLinks: 0 });
});
describe('targeted activity pagination', () => {
  it('finds this task even behind hundreds of other logs and pages equal timestamps without gaps', async () => {
    for (let i = 0; i < 120; i++) documents.set(`projects/p/activityLogs/other-${i}`, { targetType: 'task', targetId: 'other', createdAt: new Timestamp(2000, 0) });
    for (let i = 0; i < 29; i++) documents.set(`projects/p/activityLogs/mine-${String(i).padStart(2, '0')}`, { targetType: 'task', targetId: 't', action: 'complete', createdAt: new Timestamp(1000, 987654321) });
    documents.set('projects/p/activityLogs/wrong-type', { targetType: 'list', targetId: 't', createdAt: new Timestamp(3000, 0) });
    const first = await readTaskHistory('u', 'p', 't', null);
    expect(first.entries).toHaveLength(ACTIVITY_PAGE_SIZE); expect(first.nextCursor).toBeTruthy();
    expect(parseHistoryCursor(first.nextCursor)!.at.nanoseconds).toBe(987654321);
    const second = await readTaskHistory('u', 'p', 't', first.nextCursor);
    expect(second.entries).toHaveLength(4); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map(e => e.id)).size).toBe(29);
    expect(mock.privateRead).toHaveBeenCalledTimes(2);
  });
  it('reports activity failure separately and never fabricates empty-success', async () => {
    failActivity = true;
    const page = await readTaskHistory('u', 'p', 't', null);
    expect(page.activityStatus).toBe('error'); expect(page.issues[0]).toContain('取得できません');
    expect(page.privateSources?.status).toBe('ready');
    failActivity = false; mock.privateRead.mockRejectedValue(new Error('revoked'));
    const privateFailed = await readTaskHistory('u', 'p', 't', null);
    expect(privateFailed.activityStatus).toBe('ready'); expect(privateFailed.privateSources?.status).toBe('error');
  });
  it('rejects missing tasks and malformed cursor input before reading personal evidence', async () => {
    for (const raw of ['garbage', Buffer.from(JSON.stringify([100, 0, '../other'])).toString('base64url')]) await expect(readTaskHistory('u', 'p', 't', raw)).rejects.toThrow('INVALID_CURSOR');
    await expect(readTaskHistory('u', 'p', 'missing', null)).rejects.toThrow('NOT_FOUND');
    expect(mock.privateRead).not.toHaveBeenCalled();
  });
  it('keeps meeting date, adoption time and safe shared quote distinct', () => {
    const entry = activityEntry('log', { action: 'update', userName: '梢', createdAt: Timestamp.fromDate(new Date('2026-09-12T00:00:00Z')),
      source: { kind: 'meeting', title: '制作会議', occurredAt: '2026-09-10T10:00:00Z', excerpt: '全員で購入を確認する' } });
    expect(entry).toMatchObject({ kind: 'meeting', at: '2026-09-10T10:00:00.000Z', recordedAt: '2026-09-12T00:00:00.000Z', text: '全員で購入を確認する', private: false });
    expect(activityEntry('unknown-date', { source: { kind: 'meeting', title: '会議' }, createdAt: new Date() }).at).toBeNull();
  });
});
