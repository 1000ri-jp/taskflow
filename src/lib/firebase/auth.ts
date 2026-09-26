import {
  signInWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './config';
import type { User as AppUser } from '@/types';
import { isFirebaseTestAuthEnabled } from './testMode';

const googleProvider = new GoogleAuthProvider();

// Restrict to 1000ri.jp domain
googleProvider.setCustomParameters({
  hd: '1000ri.jp',
});

// Allowed email domain
const ALLOWED_DOMAIN = '1000ri.jp';

// Test user credentials (only for E2E testing)
export const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
  displayName: 'テストユーザー',
} as const;

// Demo user credentials (production demo button — credentials are public by design)
export const DEMO_USER_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_EMAIL ?? 'demo@1000ri.jp';
const DEMO_USER_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '';
export const DEMO_USER_DISPLAY_NAME = 'デモユーザー';

// Check if test mode is enabled (only on localhost)
export function isTestMode(): boolean {
  return isFirebaseTestAuthEnabled();
}

// Demo login is available whenever the demo password env var is configured.
export function isDemoLoginEnabled(): boolean {
  return DEMO_USER_PASSWORD.length > 0;
}

/**
 * Sign in with Google OAuth (popup method)
 * Only allows users with 1000ri.jp domain email
 */
export async function signInWithGoogle(): Promise<User> {
  return (await signInWithGoogleResult()).user;
}

/** A fresh Google sign-in, used only after the user confirms the Mini code. */
export async function signInWithGoogleForMini() {
  const result = await signInWithGoogleResult();
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.idToken) throw new Error('Googleの認証結果を取得できませんでした。もう一度ログインしてください。');
  return { user: result.user, googleIdToken: credential.idToken };
}

export async function completeMiniSignIn(idToken: string, expectedUid: string) {
  const auth = getFirebaseAuth();
  const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  if (result.user.uid !== expectedUid || !result.user.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await firebaseSignOut(auth);
    throw new Error('接続するアカウントが一致しません。Miniでやり直してください。');
  }
  await createOrUpdateUser(result.user);
}

async function signInWithGoogleResult() {
  const auth = getFirebaseAuth();
  const result = await signInWithPopup(auth, googleProvider);

  // Verify email domain
  const email = result.user.email;
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    // Sign out the unauthorized user
    await firebaseSignOut(auth);
    throw new Error(`このアプリは ${ALLOWED_DOMAIN} ドメインのユーザーのみ利用可能です。`);
  }

  // Create or update user document in Firestore
  await createOrUpdateUser(result.user);

  return result;
}

/**
 * Sign in with test user (E2E testing only, localhost only)
 */
export async function signInWithTestUser(): Promise<User> {
  if (!isTestMode()) {
    throw new Error('Test authentication is only available on localhost');
  }

  const auth = getFirebaseAuth();

  try {
    // Try to sign in with existing test user
    const result = await signInWithEmailAndPassword(
      auth,
      TEST_USER.email,
      TEST_USER.password
    );
    await createOrUpdateUser(result.user);
    return result.user;
  } catch (error: unknown) {
    // If user doesn't exist, create it
    // Note: Firebase now returns 'auth/invalid-credential' instead of 'auth/user-not-found'
    // for security reasons (to prevent user enumeration attacks)
    const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (errorCode === 'auth/user-not-found' || errorCode === 'auth/invalid-credential') {
      try {
        const result = await createUserWithEmailAndPassword(
          auth,
          TEST_USER.email,
          TEST_USER.password
        );
        await createOrUpdateUser(result.user);
        return result.user;
      } catch (createError: unknown) {
        // If user already exists with different password, or other error
        console.error('Failed to create test user:', createError);
        throw createError;
      }
    }
    throw error;
  }
}

/**
 * Sign in with the shared demo user (always available in production).
 * Auto-creates the Firebase Auth record on first use so the button never dead-ends,
 * but production setup should run `npm run seed:demo` to populate sample data.
 */
export async function signInWithDemoUser(): Promise<User> {
  if (!isDemoLoginEnabled()) {
    throw new Error(
      'デモログインは現在利用できません。NEXT_PUBLIC_DEMO_PASSWORD が設定されていません。'
    );
  }

  const auth = getFirebaseAuth();

  try {
    const result = await signInWithEmailAndPassword(
      auth,
      DEMO_USER_EMAIL,
      DEMO_USER_PASSWORD
    );
    await createOrUpdateUser(result.user);
    return result.user;
  } catch (error: unknown) {
    const errorCode =
      error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (
      errorCode === 'auth/user-not-found' ||
      errorCode === 'auth/invalid-credential'
    ) {
      try {
        const result = await createUserWithEmailAndPassword(
          auth,
          DEMO_USER_EMAIL,
          DEMO_USER_PASSWORD
        );
        await createOrUpdateUser(result.user);
        return result.user;
      } catch (createError: unknown) {
        console.error('Failed to create demo user:', createError);
        throw createError;
      }
    }
    throw error;
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  const auth = getFirebaseAuth();
  await firebaseSignOut(auth);
}

/**
 * Subscribe to auth state changes
 */
export function subscribeToAuthState(
  callback: (user: User | null) => void
): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

/**
 * Get the current authenticated user
 */
export function getCurrentUser(): User | null {
  const auth = getFirebaseAuth();
  return auth.currentUser;
}

/**
 * Create or update user document in Firestore
 */
async function createOrUpdateUser(firebaseUser: User): Promise<void> {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', firebaseUser.uid);
  // Avoid replacing a profile created or edited by another login while this one is reading it.
  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);

    if (!userDoc.exists()) {
      // Provider profile values are defaults for initial registration only.
      transaction.set(userRef, {
        displayName: firebaseUser.displayName || 'Unknown User',
        email: firebaseUser.email || '',
        photoURL: firebaseUser.photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // TaskFlow owns the saved name and image, including intentionally empty values.
      transaction.update(userRef, {
        ...(firebaseUser.email ? { email: firebaseUser.email } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/**
 * Get user data from Firestore
 */
export async function getUserData(userId: string): Promise<AppUser | null> {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', userId);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    return null;
  }

  const data = userDoc.data();
  return {
    id: userDoc.id,
    displayName: data.displayName,
    email: data.email,
    photoURL: data.photoURL,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
}
