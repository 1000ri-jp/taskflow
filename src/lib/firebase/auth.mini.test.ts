import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ popup: vi.fn(), credential: vi.fn(), signOut: vi.fn(), transaction: vi.fn(), user: { uid: 'u1', email: 'user@1000ri.jp' } }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: f.popup, signInWithCredential: f.credential, signOut: f.signOut,
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), onAuthStateChanged: vi.fn(),
  GoogleAuthProvider: class {
    customParameters: Record<string, string> = {};
    setCustomParameters(parameters: Record<string, string>) { this.customParameters = parameters; }
    static credentialFromResult() { return { idToken: 'google-proof' }; }
    static credential(idToken: string) { return { idToken }; }
  },
}));
vi.mock('./config', () => ({ getFirebaseAuth: () => ({}), getFirebaseDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn(), runTransaction: f.transaction, serverTimestamp: vi.fn() }));
import { completeMiniSignIn, signInWithGoogleForMini, signInWithGoogleForMcp, signInWithGoogle } from './auth';
beforeEach(() => { vi.clearAllMocks(); f.popup.mockResolvedValue({ user: f.user }); f.credential.mockResolvedValue({ user: f.user }); f.transaction.mockResolvedValue(undefined); });
describe('Mini uses existing Google/Firebase identity', () => {
  it('gets the Google proof only from a fresh Google sign-in', async () => {
    expect(await signInWithGoogleForMini()).toEqual({ user: f.user, googleIdToken: 'google-proof' });
    expect(f.popup).toHaveBeenCalledOnce(); expect(f.transaction).toHaveBeenCalledOnce();
  });
  it('signs Mini in with the Google credential and maintains the existing profile save path', async () => {
    await completeMiniSignIn('google-proof', 'u1');
    expect(f.credential).toHaveBeenCalledWith({}, { idToken: 'google-proof' });
    expect(f.transaction).toHaveBeenCalledOnce(); expect(f.signOut).not.toHaveBeenCalled();
  });
  it.each([{ uid: 'different', email: 'user@1000ri.jp' }, { uid: 'u1', email: 'user@example.com' }])('signs out mismatched accounts %j', async user => {
    f.credential.mockResolvedValue({ user });
    await expect(completeMiniSignIn('google-proof', 'u1')).rejects.toThrow('一致しません');
    expect(f.signOut).toHaveBeenCalledOnce(); expect(f.transaction).not.toHaveBeenCalled();
  });
});
it('asks for account selection only on the MCP consent path', async () => {
  expect(await signInWithGoogleForMcp()).toEqual(f.user);
  expect(f.popup.mock.calls[0][1].customParameters).toEqual({ hd: '1000ri.jp', prompt: 'select_account' });
  await signInWithGoogle();
  expect(f.popup.mock.calls[1][1].customParameters).toEqual({ hd: '1000ri.jp' });
});
