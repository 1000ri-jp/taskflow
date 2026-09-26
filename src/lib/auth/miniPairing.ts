// Only the initiating Mini holds the private key and polling secret. Neither
// credential is placed in a URL or persisted in browser storage.
export const MINI_PAIRING_TTL = 5 * 60 * 1000;
export type MiniPairingRequest = { id: string; secretHash: string; publicKey: string; expiresAt: number };
export type MiniEnvelope = { wrappedKey: string; iv: string; ciphertext: string };
export type MiniPairing = { request: MiniPairingRequest; secret: string; privateKey: CryptoKey };
const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function validateMiniPairing(value: unknown, now = Date.now()): MiniPairingRequest {
  const v = value as MiniPairingRequest | null;
  if (!v || !/^[a-f0-9]{32}$/.test(v.id) || !/^[a-f0-9]{64}$/.test(v.secretHash)
    || typeof v.publicKey !== 'string' || !/^[A-Za-z0-9+/=]{300,800}$/.test(v.publicKey)
    || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= now || v.expiresAt > now + MINI_PAIRING_TTL) {
    throw new Error('接続情報が無効か、期限が切れています。Miniでやり直してください。');
  }
  return { id: v.id, secretHash: v.secretHash, publicKey: v.publicKey, expiresAt: v.expiresAt };
}

export async function createMiniPairing(): Promise<MiniPairing> {
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  return {
    privateKey: keys.privateKey, secret,
    request: {
      id: hex(crypto.getRandomValues(new Uint8Array(16))),
      secretHash: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))),
      publicKey: encode(await crypto.subtle.exportKey('spki', keys.publicKey)),
      expiresAt: Date.now() + MINI_PAIRING_TTL,
    },
  };
}

export function miniPairingCode(request: MiniPairingRequest) {
  return `${request.id.slice(0, 4)}-${request.id.slice(4, 8)}`.toUpperCase();
}

export function miniPairingFragment(request: MiniPairingRequest) {
  return btoa(JSON.stringify(request));
}

export function parseMiniPairingFragment(fragment: string) {
  if (fragment.length > 2000) throw new Error('接続情報が無効です。');
  return validateMiniPairing(JSON.parse(atob(fragment.replace(/^#/, ''))));
}

export async function encryptMiniCredential(request: MiniPairingRequest, credential: { idToken: string; uid: string }): Promise<MiniEnvelope> {
  validateMiniPairing(request);
  const publicKey = await crypto.subtle.importKey('spki', decode(request.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(request.id);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify(credential)));
  const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP', publicKey, await crypto.subtle.exportKey('raw', key));
  return { wrappedKey: encode(wrappedKey), iv: encode(iv.buffer), ciphertext: encode(ciphertext) };
}

export async function decryptMiniCredential(pairing: MiniPairing, envelope: MiniEnvelope, expectedUid: string) {
  validateMiniPairing(pairing.request);
  const rawKey = await crypto.subtle.decrypt('RSA-OAEP', pairing.privateKey, decode(envelope.wrappedKey));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: new TextEncoder().encode(pairing.request.id) }, key, decode(envelope.ciphertext));
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (value.uid !== expectedUid || typeof value.idToken !== 'string' || value.idToken.length > 10000) throw new Error('接続するアカウントを確認できませんでした。');
  return value as { idToken: string; uid: string };
}
