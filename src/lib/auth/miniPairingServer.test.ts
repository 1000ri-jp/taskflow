// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { approveMiniPairing, consumeMiniPairing } from './miniPairingServer';

// Transactional fixture commits after callback success, including query reads.
function database() {
  const rows = new Map<string, Record<string, unknown>>();
  const collection = { doc: (id: string) => ({ id }), where: (_field: string, _op: string, id: string) => ({ limit: () => ({ query: id }) }) };
  let queue = Promise.resolve();
  const db = {
    collection: () => collection,
    runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const writes: Array<[string, Record<string, unknown>]> = [];
        const tx = {
          get: async (ref: { id?: string; query?: string }) => {
            if (ref.query) {
              const docs = [...rows].filter(([, value]) => value.sessionId === ref.query).map(([id, value]) => ({ ref: { id }, data: () => value }));
              return { empty: docs.length === 0, docs };
            }
            return { data: () => rows.get(ref.id!) };
          },
          set: (ref: { id: string }, value: Record<string, unknown>) => writes.push([ref.id, value]),
        };
        const value = await fn(tx);
        for (const [id, row] of writes) rows.set(id, row);
        return value;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db: db as unknown as Firestore, rows };
}
const secret = '1'.repeat(64);
const request = () => ({ id: 'a'.repeat(32), secretHash: createHash('sha256').update(secret).digest('hex'), publicKey: 'A'.repeat(392), expiresAt: Date.now() + 240000 });
const envelope = { wrappedKey: 'A'.repeat(344), iv: 'A'.repeat(16), ciphertext: 'A'.repeat(200) };
beforeEach(() => { vi.useRealTimers(); });
describe('Mini pairing single-use store', () => {
  it('does not consume or disclose a grant to a different secret', async () => {
    const { db, rows } = database(); const r = request();
    await approveMiniPairing(db, r, envelope, 'user-1');
    expect(await consumeMiniPairing(db, r.id, '2'.repeat(64))).toBeNull();
    expect(rows.get('user-1')?.consumed).toBe(false);
    expect(await consumeMiniPairing(db, r.id, secret)).toEqual({ envelope, uid: 'user-1' });
    expect(rows.get('user-1')).not.toHaveProperty('envelope');
  });
  it('only one concurrent consumer succeeds and approval replay is rejected', async () => {
    const { db } = database(); const r = request();
    await approveMiniPairing(db, r, envelope, 'user-1');
    const values = await Promise.all([consumeMiniPairing(db, r.id, secret), consumeMiniPairing(db, r.id, secret)]);
    expect(values.filter(Boolean)).toHaveLength(1);
    await expect(approveMiniPairing(db, r, envelope, 'user-1')).rejects.toThrow('使用済み');
    await expect(approveMiniPairing(db, r, envelope, 'user-2')).rejects.toThrow('使用済み');
  });
  it('a new session invalidates the old session, and an old approval cannot replace the newer one', async () => {
    const { db, rows } = database(); const old = request();
    await approveMiniPairing(db, old, envelope, 'user-1');
    const next = { ...old, id: 'b'.repeat(32), expiresAt: old.expiresAt + 1 };
    await approveMiniPairing(db, next, envelope, 'user-1');
    await expect(approveMiniPairing(db, old, envelope, 'user-1')).rejects.toThrow('使用済み');
    expect(await consumeMiniPairing(db, old.id, secret)).toBeNull();
    expect(await consumeMiniPairing(db, next.id, secret)).not.toBeNull();
    expect(rows.size).toBe(1);
  });
  it('expired sessions, malformed requests and unknown ids cannot return credentials', async () => {
    vi.useFakeTimers(); const { db } = database(); const r = request();
    await approveMiniPairing(db, r, envelope, 'user-1');
    vi.advanceTimersByTime(240001);
    expect(await consumeMiniPairing(db, r.id, secret)).toBeNull();
    expect(await consumeMiniPairing(db, 'b'.repeat(32), secret)).toBeNull();
    await expect(approveMiniPairing(db, r, envelope, 'user-1')).rejects.toThrow();
    await expect(consumeMiniPairing(db, '../users', secret)).rejects.toThrow();
  });
});
