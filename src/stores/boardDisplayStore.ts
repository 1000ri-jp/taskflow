import { create } from 'zustand';

export interface BoardDisplaySettings {
  showListName: boolean;
  showAssignees: boolean;
  showPriority: boolean;
  showTags: boolean;
}

export const DEFAULT_BOARD_DISPLAY: BoardDisplaySettings = {
  showListName: false,
  showAssignees: true,
  showPriority: true,
  showTags: true,
};

export const BOARD_DISPLAY_STORAGE_KEY = 'taskflow.boardDisplay.v1';

function readSettings(): BoardDisplaySettings {
  const settings = { ...DEFAULT_BOARD_DISPLAY };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(BOARD_DISPLAY_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(settings) as (keyof BoardDisplaySettings)[]) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'boolean') settings[key] = value;
      }
    }
  } catch {
    // Storage can be unavailable or contain an outdated value.
  }
  return settings;
}

function saveSettings(settings: BoardDisplaySettings) {
  try {
    localStorage.setItem(BOARD_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep the current session usable even when storage is unavailable.
  }
}

interface BoardDisplayState {
  settings: BoardDisplaySettings;
  hydrate: () => void;
  setOption: (key: keyof BoardDisplaySettings, enabled: boolean) => void;
  reset: () => void;
}

export const useBoardDisplayStore = create<BoardDisplayState>((set) => ({
  settings: { ...DEFAULT_BOARD_DISPLAY },
  hydrate: () => set({ settings: readSettings() }),
  setOption: (key, enabled) => set((state) => {
    const settings = { ...state.settings, [key]: enabled };
    saveSettings(settings);
    return { settings };
  }),
  reset: () => {
    const settings = { ...DEFAULT_BOARD_DISPLAY };
    saveSettings(settings);
    set({ settings });
  },
}));
