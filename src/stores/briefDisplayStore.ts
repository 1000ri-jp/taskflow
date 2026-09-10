import { create } from 'zustand';

export type BriefTaskScope = 'mine' | 'all';
export const BRIEF_DISPLAY_STORAGE_KEY = 'taskflow.brief-display';

interface BriefDisplayState {
  taskScope: BriefTaskScope;
  hydrate: () => void;
  setTaskScope: (taskScope: BriefTaskScope) => void;
}

function readScope(): BriefTaskScope {
  try {
    const value = JSON.parse(localStorage.getItem(BRIEF_DISPLAY_STORAGE_KEY) || 'null');
    return value === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

export const useBriefDisplayStore = create<BriefDisplayState>((set) => ({
  taskScope: 'mine',
  hydrate: () => set({ taskScope: readScope() }),
  setTaskScope: (taskScope) => {
    set({ taskScope });
    try { localStorage.setItem(BRIEF_DISPLAY_STORAGE_KEY, JSON.stringify(taskScope)); } catch { /* local-only preference */ }
  },
}));
