import { create } from 'zustand';

export interface InboxDisplaySettings {
  gmail: boolean;
  comments: boolean;
  googleChat: boolean;
}

export const DEFAULT_INBOX_DISPLAY: InboxDisplaySettings = {
  gmail: true,
  comments: true,
  googleChat: false,
};
export const INBOX_DISPLAY_STORAGE_KEY = 'taskflow.inboxDisplay.v1';

function readSettings(): InboxDisplaySettings {
  const settings = { ...DEFAULT_INBOX_DISPLAY };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(INBOX_DISPLAY_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const key of Object.keys(settings) as (keyof InboxDisplaySettings)[]) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'boolean') settings[key] = value;
      }
    }
  } catch {
    // Malformed or unavailable storage must not prevent displaying the inbox.
  }
  return settings;
}

function saveSettings(settings: InboxDisplaySettings) {
  try {
    localStorage.setItem(INBOX_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep preferences usable for this session if persistent storage is blocked.
  }
}

interface InboxDisplayState {
  settings: InboxDisplaySettings;
  hydrate: () => void;
  setOption: (key: keyof InboxDisplaySettings, enabled: boolean) => void;
  reset: () => void;
}

export const useInboxDisplayStore = create<InboxDisplayState>((set) => ({
  settings: { ...DEFAULT_INBOX_DISPLAY },
  hydrate: () => set({ settings: readSettings() }),
  setOption: (key, enabled) => set((state) => {
    const settings = { ...state.settings, [key]: enabled };
    saveSettings(settings);
    return { settings };
  }),
  reset: () => {
    const settings = { ...DEFAULT_INBOX_DISPLAY };
    saveSettings(settings);
    set({ settings });
  },
}));
