import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPCOMING_RANGE_STORAGE_KEY, useUpcomingRangeStore } from './upcomingRangeStore';

describe('upcoming display range', () => {
  beforeEach(() => { localStorage.removeItem(UPCOMING_RANGE_STORAGE_KEY); useUpcomingRangeStore.setState({ dayCount: 5, persistenceFailed: false }); });
  afterEach(() => vi.restoreAllMocks());
  it('defaults to five days and restores either choice after a state reset', () => {
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState().dayCount).toBe(5);
    for (const dayCount of [7, 5] as const) {
      useUpcomingRangeStore.getState().setDayCount(dayCount);
      expect(JSON.parse(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)!)).toBe(dayCount);
      useUpcomingRangeStore.setState({ dayCount: 5 });
      useUpcomingRangeStore.getState().hydrate();
      expect(useUpcomingRangeStore.getState().dayCount).toBe(dayCount);
    }
  });
  it.each(['bad', '0', '4', '6', '8', '"5"', '{}', 'null'])('ignores invalid stored preferences: %s', (value) => {
    localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, value);
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState().dayCount).toBe(5);
  });
  it('migrates a saved three-day preference to five without changing other saved data', () => {
    localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, '3');
    localStorage.setItem('unrelated-upcoming-draft', 'keep');
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState()).toMatchObject({ dayCount: 5, persistenceFailed: false });
    expect(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)).toBe('5');
    expect(localStorage.getItem('unrelated-upcoming-draft')).toBe('keep');
    localStorage.removeItem('unrelated-upcoming-draft');
    useUpcomingRangeStore.setState({ dayCount: 7 });
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState().dayCount).toBe(5);
  });
  it('uses five days if migration cannot be saved and retries migration on the next hydration', () => {
    localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, '3');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState()).toMatchObject({ dayCount: 5, persistenceFailed: true });
    expect(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)).toBe('3');
    write.mockRestore();
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState()).toMatchObject({ dayCount: 5, persistenceFailed: false });
    expect(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)).toBe('5');
  });
  it('keeps the display usable when storage is blocked, without claiming persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useUpcomingRangeStore.getState().setDayCount(7);
    expect(useUpcomingRangeStore.getState()).toMatchObject({ dayCount: 7, persistenceFailed: true });
  });
});
