'use client';

import { useEffect, type ReactNode } from 'react';
import { APPEARANCE_STORAGE_KEY, useAppearanceStore } from '@/stores/appearanceStore';

export function AppearanceProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const applyAppearance = () => {
      document.documentElement.dataset.appearance = useAppearanceStore.getState().appearance;
    };
    useAppearanceStore.getState().hydrate();
    applyAppearance();
    const unsubscribe = useAppearanceStore.subscribe(applyAppearance);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      useAppearanceStore.getState().syncFromStorage(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return children;
}
