import { create } from 'zustand';
import { validArchiveDays } from '@/lib/board/autoArchivePreview';

export const AUTO_ARCHIVE_PREVIEW_KEY = 'taskflow.autoArchivePreview.v1';
export const archivePreviewScope = (viewerId: string, projectId: string) => JSON.stringify([viewerId, projectId]);
function validScope(key: string) {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && value.length === 2 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\s/]/.test(id));
  } catch { return false; }
}
function read(): Record<string, number | null> {
  const raw = localStorage.getItem(AUTO_ARCHIVE_PREVIEW_KEY);
  let parsed: unknown;
  try { parsed = JSON.parse(raw || 'null'); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([scope, days]) => validScope(scope) && (days === null || validArchiveDays(days))));
}
interface State {
  byScope: Record<string, number | null>;
  hydrated: boolean;
  persistenceFailed: boolean;
  hydrate: () => void;
  save: (scope: string, days: number | null) => void;
}
// A preview preference only. It must never be consumed by a shared write or a scheduler.
export const useAutoArchivePreviewStore = create<State>((set, get) => ({
  byScope: {}, hydrated: false, persistenceFailed: false,
  hydrate: () => {
    try { set({ byScope: read(), hydrated: true, persistenceFailed: false }); }
    catch { set({ hydrated: true, persistenceFailed: true }); }
  },
  save: (scope, days) => {
    if (!validScope(scope) || (days !== null && !validArchiveDays(days))) return;
    let byScope = { ...get().byScope };
    // Explicit OFF must survive reload instead of falling back to the 30-day default.
    const apply = () => { byScope[scope] = days; };
    let persistenceFailed = false;
    try {
      byScope = { ...read(), ...(get().persistenceFailed ? get().byScope : {}) };
      apply();
      localStorage.setItem(AUTO_ARCHIVE_PREVIEW_KEY, JSON.stringify(byScope));
    } catch { apply(); persistenceFailed = true; }
    set({ byScope, hydrated: true, persistenceFailed });
  },
}));
