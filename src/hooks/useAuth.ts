'use client';

import { useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  signInWithGoogle,
  signInWithGoogleForMcp,
  signInWithTestUser,
  signInWithDemoUser,
  signOut as firebaseSignOut,
  isTestMode,
  isDemoLoginEnabled,
  getUserData,
} from '@/lib/firebase/auth';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';

export function useAuth() {
  const {
    firebaseUser,
    user,
    isLoading,
    isAuthenticated,
    setFirebaseUser,
    setUser,
    setLoading,
    reset,
  } = useAuthStore();

  // Sign in with Google
  const signIn = useCallback(async () => {
    try {
      setLoading(true);
      const fbUser = await signInWithGoogle();
      // Explicitly set the user in store (don't wait for onAuthStateChanged)
      setFirebaseUser(fbUser);
      const userData = await getUserData(fbUser.uid);
      setUser(userData);
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setFirebaseUser, setUser]);

  const signInForMcp = useCallback(async () => {
    setLoading(true);
    try {
      const fbUser = await signInWithGoogleForMcp();
      setFirebaseUser(fbUser);
      setUser(await getUserData(fbUser.uid));
    } finally { setLoading(false); }
  }, [setLoading, setFirebaseUser, setUser]);

  // Sign in with test user (E2E testing)
  const signInAsTestUser = useCallback(async () => {
    try {
      setLoading(true);
      const fbUser = await signInWithTestUser();
      setFirebaseUser(fbUser);
      const userData = await getUserData(fbUser.uid);
      setUser(userData);
    } catch (error) {
      console.error('Test sign in error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setFirebaseUser, setUser]);

  // Sign in with the shared demo user (production demo button)
  const signInAsDemoUser = useCallback(async () => {
    try {
      setLoading(true);
      const fbUser = await signInWithDemoUser();
      setFirebaseUser(fbUser);
      const userData = await getUserData(fbUser.uid);
      setUser(userData);
    } catch (error) {
      console.error('Demo sign in error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setFirebaseUser, setUser]);

  // Sign out
  const signOut = useCallback(async () => {
    try {
      setLoading(true);
      if (isE2EMockAuthEnabled()) {
        reset();
        return;
      }
      await firebaseSignOut();
      reset();
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, reset]);

  return {
    user,
    firebaseUser,
    isLoading,
    isAuthenticated,
    isTestMode: isTestMode(),
    isDemoLoginEnabled: isDemoLoginEnabled(),
    signIn,
    signInForMcp,
    signInAsTestUser,
    signInAsDemoUser,
    signOut,
  };
}
