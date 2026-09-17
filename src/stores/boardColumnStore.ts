import { create } from 'zustand';
import { isBoardSort, type BoardSort } from '@/lib/board/sort';
import { DEFAULT_BOARD_DISPLAY, type BoardDisplaySettings } from './boardDisplayStore';

export interface BoardColumnOptions { sort?: BoardSort; display: Partial<BoardDisplaySettings> }
export const BOARD_COLUMN_KEY = 'taskflow.boardColumns.v1';
export const boardColumnScope = (viewerId: string, projectId: string, listId: string) => JSON.stringify([viewerId, projectId, listId]);
function read(): Record<string, BoardColumnOptions> {
  const value: unknown = JSON.parse(localStorage.getItem(BOARD_COLUMN_KEY) || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, BoardColumnOptions> = {};
  for (const [scope, raw] of Object.entries(value)) {
    let ids: unknown; try { ids = JSON.parse(scope); } catch { continue; }
    if (!Array.isArray(ids) || ids.length !== 3 || !ids.every(id => typeof id === 'string') || !raw || typeof raw !== 'object') continue;
    const saved = raw as Record<string, unknown>;
    const display: Partial<BoardDisplaySettings> = {};
    for (const key of Object.keys(DEFAULT_BOARD_DISPLAY) as (keyof BoardDisplaySettings)[]) {
      const option = saved.display && typeof saved.display === 'object' ? (saved.display as Record<string, unknown>)[key] : undefined;
      if (typeof option === 'boolean') display[key] = option;
    }
    result[scope] = { display, ...(isBoardSort(saved.sort) ? { sort: saved.sort } : {}) };
  }
  return result;
}
interface State {
  byScope: Record<string, BoardColumnOptions>;
  persistenceFailed: boolean;
  hydrate: () => void;
  save: (scope: string, value: BoardColumnOptions) => void;
}
export const useBoardColumnStore = create<State>((set, get) => ({
  byScope: {}, persistenceFailed: false,
  hydrate: () => { try { set({ byScope: read(), persistenceFailed: false }); } catch { set({ persistenceFailed: true }); } },
  save: (scope, value) => {
    let byScope = { ...get().byScope, [scope]: value };
    let persistenceFailed = false;
    try { byScope = { ...read(), ...get().byScope, [scope]: value }; localStorage.setItem(BOARD_COLUMN_KEY, JSON.stringify(byScope)); }
    catch { persistenceFailed = true; }
    set({ byScope, persistenceFailed });
  },
}));
