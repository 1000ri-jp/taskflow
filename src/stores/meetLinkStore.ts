import { create } from 'zustand';

export const LEGACY_MEET_LINK_STORAGE_KEY = 'taskflow.meetLink.v1';
export const MEET_LINK_STORAGE_KEY = 'taskflow.meetLinks.v2';
export interface MeetShortcut { name: string; url: string | null }
export type MeetLinkIndex = 0 | 1;
export type MeetShortcuts = [MeetShortcut, MeetShortcut];
export const emptyMeetLinks = (): MeetShortcuts => [{ name: 'Meet 1', url: null }, { name: 'Meet 2', url: null }];

export function normalizeMeetUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com' || url.username || url.password || url.port || url.pathname === '/') return null;
    return url.href;
  } catch {
    return null;
  }
}

interface MeetLinkState {
  links: MeetShortcuts;
  persistenceFailed: boolean;
  hydrate: () => void;
  save: (index: MeetLinkIndex, name: string, value: string) => boolean;
  clear: (index: MeetLinkIndex) => void;
}

function persist(links: MeetShortcuts) {
  try { localStorage.setItem(MEET_LINK_STORAGE_KEY, JSON.stringify(links)); return false; }
  catch { return true; }
}

export const useMeetLinkStore = create<MeetLinkState>((set) => ({
  links: emptyMeetLinks(),
  persistenceFailed: false,
  hydrate: () => {
    const links = emptyMeetLinks();
    try {
      const raw = localStorage.getItem(MEET_LINK_STORAGE_KEY);
      if (raw === null) {
        const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_MEET_LINK_STORAGE_KEY) || 'null');
        const url = typeof legacy === 'string' ? normalizeMeetUrl(legacy) : null;
        if (url) links[0] = { name: 'Google Meet', url };
      } else {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved)) {
          for (const index of [0, 1] as const) {
            const item: unknown = saved[index];
            if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
            const entry = item as Record<string, unknown>;
            links[index] = {
              name: typeof entry.name === 'string' && entry.name.trim() && entry.name.trim().length <= 40 ? entry.name.trim() : links[index].name,
              url: typeof entry.url === 'string' ? normalizeMeetUrl(entry.url) : null,
            };
          }
        }
      }
    } catch { /* Ignore malformed or unavailable browser storage. */ }
    set({ links, persistenceFailed: false });
  },
  save: (index, name, value) => {
    const url = normalizeMeetUrl(value);
    if (!url || !name.trim() || name.trim().length > 40) return false;
    set((state) => {
      const links: MeetShortcuts = [...state.links];
      links[index] = { name: name.trim(), url };
      return { links, persistenceFailed: persist(links) };
    });
    return true;
  },
  clear: (index) => set((state) => {
    const links: MeetShortcuts = [...state.links];
    links[index] = { ...links[index], url: null };
    return { links, persistenceFailed: persist(links) };
  }),
}));
