import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPCOMING_RANGE_STORAGE_KEY, useUpcomingRangeStore } from './upcomingRangeStore';

describe('upcoming display range', () => {
  beforeEach(() => { localStorage.removeItem(UPCOMING_RANGE_STORAGE_KEY); useUpcomingRangeStore.setState({ dayCount: 3, persistenceFailed: false }); });
  afterEach(() => vi.restoreAllMocks());
  it('defaults to three days and persists either choice', () => {
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState().dayCount).toBe(3);
    for (const dayCount of [5, 3] as const) {
      useUpcomingRangeStore.getState().setDayCount(dayCount);
      expect(JSON.parse(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)!)).toBe(dayCount);
      useUpcomingRangeStore.getState().hydrate();
      expect(useUpcomingRangeStore.getState().dayCount).toBe(dayCount);
    }
  });
  it.each(['bad', '0', '4', '7', '"5"', '{}', 'null'])('ignores invalid stored preferences: %s', (value) => {
    localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, value);
    useUpcomingRangeStore.getState().hydrate();
    expect(useUpcomingRangeStore.getState().dayCount).toBe(3);
  });
  it('keeps the display usable when storage is blocked, without claiming persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useUpcomingRangeStore.getState().setDayCount(5);
    expect(useUpcomingRangeStore.getState()).toMatchObject({ dayCount: 5, persistenceFailed: true });
  });
});
