import { create } from 'zustand';

export const CHECKLIST_ASSIGNEE_STORAGE_KEY = 'taskflow.checklistAssignees.local.v1';
export type ChecklistAssigneeScope = [viewerId: string, projectId: string, taskId: string, checklistId: string, itemId: string];
export const checklistAssigneeKey = (scope: ChecklistAssigneeScope) => JSON.stringify(scope);
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\s/]/.test(id);
function validKey(key: string) {
  try { const scope: unknown = JSON.parse(key); return Array.isArray(scope) && scope.length === 5 && scope.every(validId); }
  catch { return false; }
}
function read(): Record<string, string[]> {
  const value: unknown = JSON.parse(localStorage.getItem(CHECKLIST_ASSIGNEE_STORAGE_KEY) || 'null');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, ids]) => validKey(key) && Array.isArray(ids) && ids.length <= 100 && ids.every(validId))
    .map(([key, ids]) => [key, [...new Set(ids as string[])]]));
}
interface State {
  byItem: Record<string, string[]>;
  hydrated: boolean;
  persistenceFailed: boolean;
  hydrate: () => void;
  setAssignees: (scope: ChecklistAssigneeScope, ids: string[]) => void;
}
// Local only: never merge these values into a Task or Checklist payload.
export const useChecklistAssigneeStore = create<State>((set, get) => ({
  byItem: {}, hydrated: false, persistenceFailed: false,
  hydrate: () => {
    try { set({ byItem: read(), hydrated: true, persistenceFailed: false }); }
    catch { set({ hydrated: true, persistenceFailed: true }); }
  },
  setAssignees: (scope, ids) => {
    const key = checklistAssigneeKey(scope);
    if (!validKey(key) || ids.length > 100 || !ids.every(validId)) return;
    const selected = [...new Set(ids)];
    let byItem = { ...get().byItem };
    let persistenceFailed = false;
    const apply = () => { if (selected.length) byItem[key] = selected; else delete byItem[key]; };
    try {
      byItem = { ...read(), ...(get().persistenceFailed ? get().byItem : {}) };
      apply();
      localStorage.setItem(CHECKLIST_ASSIGNEE_STORAGE_KEY, JSON.stringify(byItem));
    } catch { apply(); persistenceFailed = true; }
    set({ byItem, hydrated: true, persistenceFailed });
  },
}));
