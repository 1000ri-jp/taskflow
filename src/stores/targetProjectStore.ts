import { create } from 'zustand';

export const TARGET_PROJECT_STORAGE_KEY = 'taskflow.targetProjects.v1';

// null preserves the initial sample preview; [] is an explicit empty selection.
function readSelection(): string[] | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TARGET_PROJECT_STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return [...new Set(saved)];
    }
  } catch {
    // Invalid or unavailable browser storage falls back to the sample preview.
  }
  return null;
}

function saveSelection(ids: string[] | null) {
  try {
    localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Selection still works for this session when persistence is unavailable.
  }
}

interface TargetProjectState {
  selectedProjectIds: string[] | null;
  hydrate: () => void;
  toggle: (id: string, selected: boolean) => void;
  select: (ids: string[] | null) => void;
}

export const useTargetProjectStore = create<TargetProjectState>((set) => ({
  selectedProjectIds: null,
  hydrate: () => set({ selectedProjectIds: readSelection() }),
  toggle: (id, selected) => set((state) => {
    const ids = state.selectedProjectIds ?? [];
    const selectedProjectIds = selected ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
    saveSelection(selectedProjectIds);
    return { selectedProjectIds };
  }),
  select: (ids) => {
    const selectedProjectIds = ids === null ? null : [...new Set(ids)];
    saveSelection(selectedProjectIds);
    set({ selectedProjectIds });
  },
}));
