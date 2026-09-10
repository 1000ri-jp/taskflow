import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_DISPLAY_STORAGE_KEY, DEFAULT_BOARD_DISPLAY, useBoardDisplayStore } from './boardDisplayStore';

describe('boardDisplayStore', () => {
  beforeEach(() => {
    localStorage.removeItem(BOARD_DISPLAY_STORAGE_KEY);
    useBoardDisplayStore.setState({ settings: { ...DEFAULT_BOARD_DISPLAY } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('hides column names by default and retains the other metadata', () => {
    useBoardDisplayStore.getState().hydrate();
    expect(useBoardDisplayStore.getState().settings).toEqual({ showListName: false, showAssignees: true, showPriority: true, showTags: true });
  });

  it('saves and restores browser-only preferences', () => {
    useBoardDisplayStore.getState().setOption('showListName', true);
    useBoardDisplayStore.getState().setOption('showPriority', false);
    useBoardDisplayStore.getState().setOption('showTags', false);
    useBoardDisplayStore.setState({ settings: { ...DEFAULT_BOARD_DISPLAY } });
    useBoardDisplayStore.getState().hydrate();
    expect(useBoardDisplayStore.getState().settings).toEqual({ showListName: true, showAssignees: true, showPriority: false, showTags: false });
  });

  it.each(['invalid json', 'null', '[]', '{"showListName":"true","showPriority":null}'])('ignores invalid saved preferences: %s', (saved) => {
    localStorage.setItem(BOARD_DISPLAY_STORAGE_KEY, saved);
    useBoardDisplayStore.getState().hydrate();
    expect(useBoardDisplayStore.getState().settings).toEqual(DEFAULT_BOARD_DISPLAY);
  });

  it('restores valid partial preferences and fills missing defaults', () => {
    localStorage.setItem(BOARD_DISPLAY_STORAGE_KEY, '{"showAssignees":false,"unknown":true}');
    useBoardDisplayStore.getState().hydrate();
    expect(useBoardDisplayStore.getState().settings).toEqual({ ...DEFAULT_BOARD_DISPLAY, showAssignees: false });
  });

  it('keeps toggles usable when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => useBoardDisplayStore.getState().hydrate()).not.toThrow();
    expect(() => useBoardDisplayStore.getState().setOption('showAssignees', false)).not.toThrow();
    expect(useBoardDisplayStore.getState().settings.showAssignees).toBe(false);
  });

  it('persists resetting to the defaults', () => {
    useBoardDisplayStore.getState().setOption('showListName', true);
    useBoardDisplayStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(BOARD_DISPLAY_STORAGE_KEY)!)).toEqual(DEFAULT_BOARD_DISPLAY);
  });
});
