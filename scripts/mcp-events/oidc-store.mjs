import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');

// All OAuth payloads encrypted; indexes contain only hashes. Client SDK has no access.
export function firestoreAdapter(db, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('OAuth storage key required');
  const collection = db.collection('mcpOAuthState');
  function seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') };
  }
  function open(record) {
    if (!record || record.expiresAt.toMillis() <= Date.now()) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.body, 'base64')), decipher.final()]).toString());
    return record.consumed ? { ...payload, consumed: record.consumed } : payload;
  }
  return class Adapter {
    constructor(name) { this.name = name; }
    ref(id) { return collection.doc(hash(`${this.name}:${id}`)); }
    async upsert(id, payload, expiresIn) {
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Finite OAuth lifetime required');
      const reference = this.ref(id);
      await db.runTransaction(async tx => {
        const before = (await tx.get(reference)).data();
        tx.set(reference, { ...seal(payload), consumed: before?.consumed ?? payload.consumed ?? null,
          expiresAt: new Date(Date.now() + expiresIn * 1000),
          uidHash: payload.uid ? hash(`${this.name}:${payload.uid}`) : null,
          userCodeHash: payload.userCode ? hash(`${this.name}:${payload.userCode}`) : null,
          grantHash: payload.grantId ? hash(payload.grantId) : null,
        });
      });
    }
    async find(id) { return open((await this.ref(id).get()).data()); }
    async findByUid(uid) { return this.lookup('uidHash', uid); }
    async findByUserCode(code) { return this.lookup('userCodeHash', code); }
    async lookup(field, value) {
      const records = await collection.where(field, '==', hash(`${this.name}:${value}`)).limit(1).get();
      return records.empty ? undefined : open(records.docs[0].data());
    }
    async consume(id) {
      const reference = this.ref(id);
      await db.runTransaction(async tx => {
        const record = (await tx.get(reference)).data();
        if (!record || record.consumed || !open(record)) throw new Error('OAuth artifact already consumed or expired');
        tx.update(reference, { consumed: Math.floor(Date.now() / 1000) });
      });
    }
    async destroy(id) { await this.ref(id).delete(); }
    async revokeByGrantId(grantId) {
      // Small bounded grants in this synthetic-only pilot; paginate for complete deletion.
      for (;;) {
        const records = await collection.where('grantHash', '==', hash(grantId)).limit(200).get();
        if (records.empty) return;
        const batch = db.batch(); records.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
      }
    }
  };
}
