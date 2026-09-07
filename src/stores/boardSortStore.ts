import { create } from 'zustand';
import { isBoardSort, type BoardSort } from '@/lib/board/sort';

export const BOARD_SORT_STORAGE_KEY = 'taskflow.boardSort.v1';
const validId = (value: string) => !!value && value.length <= 200 && !/[\s/]/.test(value);
function read(): Record<string, BoardSort> {
  const parsed: unknown = JSON.parse(localStorage.getItem(BOARD_SORT_STORAGE_KEY) || 'null');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([id, mode]) => validId(id) && isBoardSort(mode)));
}
interface State {
  byProject: Record<string, BoardSort>;
  persistenceFailed: boolean;
  hydrate: () => void;
  setSort: (projectId: string, mode: BoardSort) => void;
}
export const useBoardSortStore = create<State>((set, get) => ({
  byProject: {}, persistenceFailed: false,
  hydrate: () => {
    try { set({ byProject: read(), persistenceFailed: false }); }
    catch { set({ persistenceFailed: true }); }
  },
  setSort: (projectId, mode) => {
    if (!validId(projectId) || !isBoardSort(mode)) return;
    let byProject = { ...get().byProject, [projectId]: mode };
    let persistenceFailed = false;
    try {
      byProject = { ...read(), ...(get().persistenceFailed ? get().byProject : {}), [projectId]: mode };
      localStorage.setItem(BOARD_SORT_STORAGE_KEY, JSON.stringify(byProject));
    } catch { persistenceFailed = true; }
    set({ byProject, persistenceFailed });
  },
}));
