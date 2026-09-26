// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMiniPairing, decryptMiniCredential, encryptMiniCredential, miniPairingFragment, parseMiniPairingFragment, validateMiniPairing } from './miniPairing';

describe('Mini encrypted Google credential handoff', () => {
  it('only the initiating Mini decrypts the credential; fragment contains neither credential nor secret', async () => {
    const a = await createMiniPairing();
    const b = await createMiniPairing();
    const credential = { uid: 'user-1', idToken: 'private-google-id-token'.repeat(90) };
    const envelope = await encryptMiniCredential(a.request, credential);
    expect(await decryptMiniCredential(a, envelope, 'user-1')).toEqual(credential);
    await expect(decryptMiniCredential(b, envelope, 'user-1')).rejects.toThrow();
    const fragment = miniPairingFragment(a.request);
    expect(parseMiniPairingFragment(fragment)).toEqual(a.request);
    expect(atob(fragment)).not.toContain(a.secret);
    expect(JSON.stringify(envelope)).not.toContain(credential.idToken);
    expect(a.privateKey.extractable).toBe(false);
  });
  it('rejects tampering, a different session id, and a different approving account', async () => {
    const a = await createMiniPairing();
    const envelope = await encryptMiniCredential(a.request, { uid: 'user-1', idToken: 'test' });
    await expect(decryptMiniCredential(a, envelope, 'other-user')).rejects.toThrow();
    await expect(decryptMiniCredential({ ...a, request: { ...a.request, id: 'a'.repeat(32) } }, envelope, 'user-1')).rejects.toThrow();
    await expect(decryptMiniCredential(a, { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) }, 'user-1')).rejects.toThrow();
  });
  it('rejects expired and overlong requests without changing auth state', async () => {
    const a = await createMiniPairing();
    expect(() => validateMiniPairing(a.request, a.request.expiresAt)).toThrow();
    expect(() => validateMiniPairing({ ...a.request, expiresAt: Date.now() + 600000 })).toThrow();
    expect(() => parseMiniPairingFragment('x'.repeat(3000))).toThrow();
  });
});
