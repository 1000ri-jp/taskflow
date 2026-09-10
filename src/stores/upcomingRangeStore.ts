import { create } from 'zustand';
import { UPCOMING_RANGES, type UpcomingRange } from '@/lib/dashboard/upcoming-range';

export const UPCOMING_RANGE_STORAGE_KEY = 'taskflow.upcomingRange.v1';
interface UpcomingRangeState {
  dayCount: UpcomingRange;
  persistenceFailed: boolean;
  hydrate: () => void;
  setDayCount: (value: UpcomingRange) => void;
}
export const useUpcomingRangeStore = create<UpcomingRangeState>((set) => ({
  dayCount: 3,
  persistenceFailed: false,
  hydrate: () => {
    let dayCount: UpcomingRange = 3;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY) || 'null');
      if (saved === 3 || saved === 5) dayCount = saved;
    } catch { /* Invalid browser preferences keep the default range. */ }
    set({ dayCount, persistenceFailed: false });
  },
  setDayCount: (dayCount) => {
    if (!UPCOMING_RANGES.includes(dayCount)) return;
    let persistenceFailed = false;
    try { localStorage.setItem(UPCOMING_RANGE_STORAGE_KEY, JSON.stringify(dayCount)); }
    catch { persistenceFailed = true; }
    set({ dayCount, persistenceFailed });
  },
}));
