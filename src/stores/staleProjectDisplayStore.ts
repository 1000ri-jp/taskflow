import { create } from 'zustand';

export const STALE_PROJECT_DISPLAY_STORAGE_KEY = 'taskflow.staleProjectDisplay.v1';

function readHiddenIds(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STALE_PROJECT_DISPLAY_STORAGE_KEY) || '[]');
    if (Array.isArray(saved) && saved.every((id) => typeof id === 'string' && id.trim())) {
      return [...new Set(saved)];
    }
  } catch {
    // Invalid/unavailable storage must not prevent displaying the dashboard.
  }
  return [];
}

interface StaleProjectDisplayState {
  hiddenProjectIds: string[];
  hydrate: () => void;
  setVisible: (projectIds: string[], visible: boolean) => void;
}

export const useStaleProjectDisplayStore = create<StaleProjectDisplayState>((set) => ({
  // Store exclusions by ID: renamed projects retain preferences; new ones show by default.
  hiddenProjectIds: [],
  hydrate: () => set({ hiddenProjectIds: readHiddenIds() }),
  setVisible: (projectIds, visible) => set((state) => {
    const hiddenProjectIds = visible
      ? state.hiddenProjectIds.filter((id) => !projectIds.includes(id))
      : [...new Set([...state.hiddenProjectIds, ...projectIds])];
    try {
      localStorage.setItem(STALE_PROJECT_DISPLAY_STORAGE_KEY, JSON.stringify(hiddenProjectIds));
    } catch {
      // Keep the display setting usable for this session.
    }
    return { hiddenProjectIds };
  }),
}));
