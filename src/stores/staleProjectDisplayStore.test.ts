import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_PROJECT_DISPLAY_STORAGE_KEY, useStaleProjectDisplayStore } from './staleProjectDisplayStore';

describe('staleProjectDisplayStore', () => {
  beforeEach(() => { localStorage.removeItem(STALE_PROJECT_DISPLAY_STORAGE_KEY); useStaleProjectDisplayStore.setState({ hiddenProjectIds: [] }); });
  afterEach(() => vi.restoreAllMocks());

  it('shows every project by default and restores hidden IDs', () => {
    useStaleProjectDisplayStore.getState().hydrate();
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual([]);
    useStaleProjectDisplayStore.getState().setVisible(['project-a'], false);
    useStaleProjectDisplayStore.setState({ hiddenProjectIds: [] });
    useStaleProjectDisplayStore.getState().hydrate();
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['project-a']);
    useStaleProjectDisplayStore.getState().setVisible(['project-a'], true);
    expect(JSON.parse(localStorage.getItem(STALE_PROJECT_DISPLAY_STORAGE_KEY)!)).toEqual([]);
  });

  it('bulk toggles visible projects without erasing unavailable project preferences', () => {
    useStaleProjectDisplayStore.getState().setVisible(['old-id'], false);
    useStaleProjectDisplayStore.getState().setVisible(['a', 'b', 'a'], false);
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['old-id', 'a', 'b']);
    useStaleProjectDisplayStore.getState().setVisible(['a', 'b'], true);
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['old-id']);
  });

  it.each(['invalid', 'null', '{}', '[false]', '[" "]'])('ignores malformed storage: %s', (saved) => {
    localStorage.setItem(STALE_PROJECT_DISPLAY_STORAGE_KEY, saved);
    useStaleProjectDisplayStore.getState().hydrate();
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual([]);
  });

  it('deduplicates restored IDs and works when storage is blocked', () => {
    localStorage.setItem(STALE_PROJECT_DISPLAY_STORAGE_KEY, '["a","a"]');
    useStaleProjectDisplayStore.getState().hydrate();
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['a']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => useStaleProjectDisplayStore.getState().hydrate()).not.toThrow();
    expect(() => useStaleProjectDisplayStore.getState().setVisible(['b'], false)).not.toThrow();
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['b']);
  });
});
