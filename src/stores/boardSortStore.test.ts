import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SORT_STORAGE_KEY as KEY, useBoardSortStore as store } from './boardSortStore';
describe('board sort preferences', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.removeItem(KEY); store.setState({byProject:{},persistenceFailed:false}); });
  it('persists per project without changing card metadata or other local keys', () => {
    const write=vi.spyOn(Storage.prototype,'setItem');
    store.getState().setSort('a','due-asc'); store.getState().setSort('b','start-desc');
    store.setState({byProject:{}}); store.getState().hydrate();
    expect(store.getState().byProject).toEqual({a:'due-asc',b:'start-desc'});
    store.getState().setSort('a','manual');
    expect(store.getState().byProject.b).toBe('start-desc');
    expect(write.mock.calls.every(([key]) => key===KEY)).toBe(true);
  });
  it('ignores invalid preferences and reports storage errors', () => {
    localStorage.setItem(KEY,JSON.stringify({a:'invalid',b:'due-desc'})); store.getState().hydrate();
    expect(store.getState().byProject).toEqual({b:'due-desc'});
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('quota');});
    store.getState().setSort('a','start-asc');
    expect(store.getState().byProject.a).toBe('start-asc');
    expect(store.getState().persistenceFailed).toBe(true);
  });
});
