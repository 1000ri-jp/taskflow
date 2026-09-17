import { create } from 'zustand';
import type { CalendarView } from '@/lib/dashboard/calendar-layout';

const STORAGE_KEY = 'taskflow.neoCalendarView.v1';

interface NeoCalendarViewState {
  view: CalendarView;
  hydrate: () => void;
  setView: (view: CalendarView) => void;
}

export const useNeoCalendarViewStore = create<NeoCalendarViewState>((set) => ({
  view: 'month',
  hydrate: () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      set({ view: saved === 'day' || saved === 'week' || saved === 'month' ? saved : 'month' });
    } catch { /* Keep the current view when browser storage is unavailable. */ }
  },
  setView: (view) => {
    try { localStorage.setItem(STORAGE_KEY, view); }
    catch { /* Switching views still works without browser storage. */ }
    set({ view });
  },
}));
