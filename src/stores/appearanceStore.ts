import { create } from 'zustand';

export type Appearance = 'neo' | 'ivory' | 'classic';
export const APPEARANCE_STORAGE_KEY = 'taskflow.appearance.v1';
export const DEFAULT_APPEARANCE: Appearance = 'neo';
const STORAGE_WARNING = 'デザインの選択を保存できません。今回の表示には反映しています。';

interface AppearanceState {
  appearance: Appearance;
  hydrated: boolean;
  persistenceError: string | null;
  hydrate: () => void;
  setAppearance: (appearance: Appearance) => void;
  syncFromStorage: (value: string | null) => void;
}

function readAppearance(value: string | null): Appearance {
  return value === 'classic' || value === 'ivory' ? value : DEFAULT_APPEARANCE;
}

// Keep the server and first client render identical; only hydrate after mount.
export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: DEFAULT_APPEARANCE,
  hydrated: false,
  persistenceError: null,
  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    try {
      set({
        appearance: readAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)),
        hydrated: true,
        persistenceError: null,
      });
    } catch {
      set({ hydrated: true, persistenceError: STORAGE_WARNING });
    }
  },
  setAppearance: (appearance) => {
    if (appearance !== 'neo' && appearance !== 'ivory' && appearance !== 'classic') return;
    set({ appearance, hydrated: true });
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
      set({ persistenceError: null });
    } catch {
      set({ persistenceError: STORAGE_WARNING });
    }
  },
  // Storage events reflect another tab's saved choice; never write it back.
  syncFromStorage: (value) => set({
    appearance: readAppearance(value),
    hydrated: true,
    persistenceError: null,
  }),
}));
