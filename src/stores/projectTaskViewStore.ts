import { create } from 'zustand';
import { isTaskView, type TaskView } from '@/lib/board/taskViews';

export const PROJECT_TASK_VIEW_KEY = 'taskflow.projectTaskView.v1';
export const taskViewScope = (viewerId: string, projectId: string) => JSON.stringify([viewerId, projectId]);
function validScope(scope: string) {
  try {
    const ids: unknown = JSON.parse(scope);
    return Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length < 201 && !/[\s/]/.test(id));
  } catch { return false; }
}
function read(): Record<string, TaskView> {
  const raw = localStorage.getItem(PROJECT_TASK_VIEW_KEY);
  let value: unknown;
  try { value = JSON.parse(raw || 'null'); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, view]) => validScope(key) && isTaskView(view)));
}
interface State {
  byScope: Record<string, TaskView>;
  hydrated: boolean;
  persistenceFailed: boolean;
  hydrate: () => void;
  setDefault: (scope: string, view: TaskView) => void;
}
export const useProjectTaskViewStore = create<State>((set, get) => ({
  byScope: {}, hydrated: false, persistenceFailed: false,
  hydrate: () => {
    try { set({ byScope: read(), hydrated: true, persistenceFailed: false }); }
    catch { set({ hydrated: true, persistenceFailed: true }); }
  },
  setDefault: (scope, view) => {
    if (!validScope(scope) || !isTaskView(view)) return;
    let byScope = { ...get().byScope, [scope]: view };
    let persistenceFailed = false;
    try {
      byScope = { ...read(), ...(get().persistenceFailed ? get().byScope : {}), [scope]: view };
      localStorage.setItem(PROJECT_TASK_VIEW_KEY, JSON.stringify(byScope));
    } catch { persistenceFailed = true; }
    set({ byScope, hydrated: true, persistenceFailed });
  },
}));
