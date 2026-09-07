import { create } from 'zustand';

export const TARGET_TASK_STORAGE_KEY = 'taskflow.targetTasks.v1';
interface Selection { month: string; projectId: string; taskIds: string[] }
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !value.includes('/');
const validMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function readSelections(): Selection[] {
  const raw: unknown = JSON.parse(localStorage.getItem(TARGET_TASK_STORAGE_KEY) || '[]');
  if (!Array.isArray(raw)) return [];
  const selections = new Map<string, Selection>();
  for (const item of raw) {
    if (!item || !validMonth(item.month) || !validId(item.projectId) || !Array.isArray(item.taskIds) || !item.taskIds.every(validId)) continue;
    selections.set(JSON.stringify([item.month, item.projectId]), { month: item.month, projectId: item.projectId, taskIds: [...new Set<string>(item.taskIds)] });
  }
  return [...selections.values()];
}
interface State {
  selections: Selection[];
  persistenceFailed: boolean;
  hydrate: () => void;
  save: (month: string, projectId: string, taskIds: string[]) => void;
}
export const useTargetTaskStore = create<State>((set) => ({
  selections: [],
  persistenceFailed: false,
  hydrate: () => {
    try { set({ selections: readSelections(), persistenceFailed: false }); }
    catch { set({ selections: [], persistenceFailed: true }); }
  },
  save: (month, projectId, taskIds) => {
    if (!validMonth(month) || !validId(projectId) || !taskIds.every(validId)) return;
    set((state) => {
      const selections = [...state.selections.filter((item) => item.month !== month || item.projectId !== projectId), { month, projectId, taskIds: [...new Set(taskIds)] }];
      let persistenceFailed = false;
      try { localStorage.setItem(TARGET_TASK_STORAGE_KEY, JSON.stringify(selections)); }
      catch { persistenceFailed = true; }
      return { selections, persistenceFailed };
    });
  },
}));
