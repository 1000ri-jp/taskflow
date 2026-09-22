import { createHash, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { validateMiniPairing, type MiniEnvelope, type MiniPairingRequest } from './miniPairing';

const COLLECTION = 'desktopMiniSignInAccounts'; // Existing default-deny rules apply.
export class MiniPairingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function approveMiniPairing(db: Firestore, request: MiniPairingRequest, envelope: MiniEnvelope, uid: string) {
  validateMiniPairing(request);
  if (!envelope || !/^[A-Za-z0-9+/=]{344}$/.test(envelope.wrappedKey)
    || !/^[A-Za-z0-9+/=]{16}$/.test(envelope.iv)
    || typeof envelope.ciphertext !== 'string' || !/^[A-Za-z0-9+/=]{100,14000}$/.test(envelope.ciphertext)) {
    throw new MiniPairingError('接続情報が無効です。', 400);
  }
  // One record per account, monotonic expiry, and an atomic consume prevent
  // replay without accumulating sessions or unauthenticated database writes.
  const account = db.collection(COLLECTION).doc(uid);
  const sameSession = db.collection(COLLECTION).where('sessionId', '==', request.id).limit(1);
  await db.runTransaction(async tx => {
    const [existing, current] = await Promise.all([tx.get(sameSession), tx.get(account)]);
    if (!existing.empty || (current.data()?.expiresAt ?? 0) >= request.expiresAt) throw new MiniPairingError('この接続は使用済みです。Miniでやり直してください。', 409);
    tx.set(account, { sessionId: request.id, secretHash: request.secretHash, expiresAt: request.expiresAt, envelope, uid, consumed: false });
  });
}

export async function consumeMiniPairing(db: Firestore, id: string, secret: string) {
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(secret)) throw new MiniPairingError('接続情報が無効です。', 400);
  const query = db.collection(COLLECTION).where('sessionId', '==', id).limit(1);
  return db.runTransaction(async tx => {
    const result = await tx.get(query);
    const snapshot = result.docs[0];
    const value = snapshot?.data();
    if (!value) return null;
    const actual = createHash('sha256').update(secret).digest();
    if (typeof value.secretHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.secretHash)
      || !timingSafeEqual(actual, Buffer.from(value.secretHash, 'hex'))) return null;
    if (value.consumed || value.expiresAt <= Date.now()) return null;
    // Keep a small tombstone so an approval cannot be replayed after consume.
    tx.set(snapshot.ref, { sessionId: id, secretHash: value.secretHash, expiresAt: value.expiresAt, consumed: true });
    return { envelope: value.envelope as MiniEnvelope, uid: value.uid as string };
  });
}
