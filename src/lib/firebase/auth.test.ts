import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const documents = new Map<string, Record<string, unknown>>();
  const timestamp = { toDate: () => new Date('2026-09-14T00:00:00Z') };
  const snapshot = (path: string) => {
    const data = documents.get(path);
    return { id: path.split('/').at(-1), exists: () => !!data, data: () => data };
  };
  const getDoc = vi.fn(async (path: string) => snapshot(path));
  const setDoc = vi.fn(async (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => {
    documents.set(path, { ...(options?.merge ? documents.get(path) : {}), ...data });
  });
  const updateDoc = vi.fn(async (path: string, data: Record<string, unknown>) => {
    if (!documents.has(path)) throw new Error('not-found');
    documents.set(path, { ...documents.get(path), ...data });
  });
  const runTransaction = vi.fn(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => {
    const writes: Array<() => Promise<void>> = [];
    await callback({
      get: getDoc,
      set: (path: string, data: Record<string, unknown>) => writes.push(() => setDoc(path, data)),
      update: (path: string, data: Record<string, unknown>) => writes.push(() => updateDoc(path, data)),
    });
    for (const write of writes) await write();
  });
  return { documents, timestamp, getDoc, setDoc, updateDoc, runTransaction, popup: vi.fn(), signOut: vi.fn() };
});

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class { setCustomParameters() {} },
  signInWithPopup: fixture.popup,
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: fixture.signOut,
  onAuthStateChanged: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: fixture.getDoc,
  setDoc: fixture.setDoc,
  updateDoc: fixture.updateDoc,
  runTransaction: fixture.runTransaction,
  serverTimestamp: () => fixture.timestamp,
}));
vi.mock('./config', () => ({ getFirebaseAuth: () => ({}), getFirebaseDb: () => ({}) }));

import { updateDoc, doc } from 'firebase/firestore';
import { getFirebaseDb } from './config';
import { getUserData, signInWithGoogle, signOut } from './auth';

const googleUser = {
  uid: 'isolated-profile-user', email: 'isolated@1000ri.jp',
  displayName: 'Google name', photoURL: 'https://example.com/google.jpg',
};
const userPath = `users/${googleUser.uid}`;

describe('login profile ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.documents.clear();
    fixture.popup.mockResolvedValue({ user: { ...googleUser } });
  });

  it('uses Google name and photo for first registration', async () => {
    await signInWithGoogle();
    expect(await getUserData(googleUser.uid)).toEqual({
      id: googleUser.uid, displayName: googleUser.displayName, photoURL: googleUser.photoURL,
      email: googleUser.email, createdAt: fixture.timestamp.toDate(), updatedAt: fixture.timestamp.toDate(),
    });
    expect(fixture.documents.size).toBe(1);
  });

  it('registers a user whose Google profile has no name or photo', async () => {
    fixture.popup.mockResolvedValue({ user: { ...googleUser, displayName: null, photoURL: null } });
    await signInWithGoogle();
    expect(await getUserData(googleUser.uid)).toMatchObject({ displayName: 'Unknown User', photoURL: null });
  });

  it.each([googleUser.photoURL, null, ''])('retains an edited profile after sign-out and re-login (Google photo: %s)', async (photoURL) => {
    await signInWithGoogle();
    // Same document and update operation used by My Profile; no real Firebase connection.
    await updateDoc(doc(getFirebaseDb(), 'users', googleUser.uid), {
      displayName: 'TaskFlowで決めた名前', photoURL: 'https://example.com/taskflow-upload.jpg',
    });
    await signOut();
    fixture.popup.mockResolvedValue({ user: { ...googleUser, displayName: 'Changed Google name', photoURL } });
    await signInWithGoogle();
    expect(await getUserData(googleUser.uid)).toMatchObject({
      displayName: 'TaskFlowで決めた名前', photoURL: 'https://example.com/taskflow-upload.jpg',
    });
    expect(fixture.signOut).toHaveBeenCalledOnce();
  });

  it.each([null, ''])('does not repopulate an existing empty TaskFlow photo (%s)', async (photoURL) => {
    fixture.documents.set(userPath, { displayName: '', photoURL, email: googleUser.email });
    await signInWithGoogle();
    expect(fixture.documents.get(userPath)).toMatchObject({ displayName: '', photoURL });
  });

  it('only refreshes login metadata and leaves other saved fields intact', async () => {
    const createdAt = { toDate: () => new Date('2025-01-01') };
    fixture.documents.set(userPath, {
      displayName: 'Saved name', photoURL: 'saved-photo', email: 'old@1000ri.jp', createdAt,
      preferences: { compact: true },
    });
    await signInWithGoogle();
    expect(fixture.documents.get(userPath)).toEqual({
      displayName: 'Saved name', photoURL: 'saved-photo', email: googleUser.email, createdAt,
      preferences: { compact: true }, updatedAt: fixture.timestamp,
    });
  });

  it('does not initialize missing profile fields in an existing document', async () => {
    fixture.documents.set(userPath, { email: googleUser.email });
    await signInWithGoogle();
    expect(fixture.documents.get(userPath)).not.toHaveProperty('displayName');
    expect(fixture.documents.get(userPath)).not.toHaveProperty('photoURL');
  });

  it('propagates read failures without creating or replacing the profile', async () => {
    fixture.getDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(signInWithGoogle()).rejects.toThrow('permission-denied');
    expect(fixture.setDoc).not.toHaveBeenCalled();
    expect(fixture.updateDoc).not.toHaveBeenCalled();
  });

  it('does not write a profile for a rejected Google account', async () => {
    fixture.popup.mockResolvedValue({ user: { ...googleUser, email: 'isolated@example.com' } });
    await expect(signInWithGoogle()).rejects.toThrow('1000ri.jp');
    expect(fixture.getDoc).not.toHaveBeenCalled();
    expect(fixture.documents.size).toBe(0);
  });
});
