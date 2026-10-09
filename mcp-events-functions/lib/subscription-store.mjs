import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Production callback signing keys are encrypted at rest; legacy test grants keep their format.
export function subscriptionStore(collection, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Storage key required');
  function encode(sub) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const { secret, previousSecret, ...metadata } = sub;
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ secret, previousSecret })), cipher.final()]);
    return { ...metadata, deliveryKey: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: encrypted.toString('base64') },
      mcpExpiresAt: new Date(sub.expiresAt) };
  }
  function decode(record) {
    if (!record) return undefined;
    const { deliveryKey, ...metadata } = record;
    if (!deliveryKey) throw new Error('Encrypted subscription required');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(deliveryKey.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(deliveryKey.tag, 'base64'));
    return { ...metadata, ...JSON.parse(Buffer.concat([decipher.update(Buffer.from(deliveryKey.body, 'base64')), decipher.final()]).toString()) };
  }
  return {
    get: async id => decode((await collection.doc(id).get()).data()),
    set: async (id, sub) => collection.doc(id).set(encode(sub)),
    delete: async id => collection.doc(id).delete(),
    values: async () => (await collection.get()).docs.map(doc => decode(doc.data())),
  };
}
