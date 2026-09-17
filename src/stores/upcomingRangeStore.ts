import { create } from 'zustand';
import { DEFAULT_UPCOMING_DAYS, UPCOMING_RANGES, type UpcomingRange } from '@/lib/dashboard/upcoming-range';

export const UPCOMING_RANGE_STORAGE_KEY = 'taskflow.upcomingRange.v1';
interface UpcomingRangeState {
  dayCount: UpcomingRange;
  persistenceFailed: boolean;
  hydrate: () => void;
  setDayCount: (value: UpcomingRange) => void;
}
export const useUpcomingRangeStore = create<UpcomingRangeState>((set) => ({
  dayCount: DEFAULT_UPCOMING_DAYS,
  persistenceFailed: false,
  hydrate: () => {
    let dayCount: UpcomingRange = DEFAULT_UPCOMING_DAYS;
    let persistenceFailed = false;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY) || 'null');
      if (saved === 5 || saved === 7) dayCount = saved;
      if (saved === 3) {
        try { localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, JSON.stringify(dayCount)); }
        catch { persistenceFailed = true; }
      }
    } catch { /* Invalid browser preferences keep the default range. */ }
    set({ dayCount, persistenceFailed });
  },
  setDayCount: (dayCount) => {
    if (!UPCOMING_RANGES.includes(dayCount)) return;
    let persistenceFailed = false;
    try { localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, JSON.stringify(dayCount)); }
    catch { persistenceFailed = true; }
    set({ dayCount, persistenceFailed });
  },
}));
