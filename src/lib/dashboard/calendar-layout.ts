import { addDays, addMonths, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { GoogleItem } from '@/lib/google/workspace/types';

export type CalendarView = 'day' | 'week' | 'month';
export function calendarWindow(anchor: Date, view: CalendarView) {
  const start = view === 'day' ? startOfDay(anchor) : startOfWeek(view === 'month' ? startOfMonth(anchor) : anchor, { weekStartsOn: 1 });
  const count = view === 'month' ? 42 : view === 'week' ? 7 : 1;
  return { start, end: addDays(start, count), count };
}
export function moveCalendar(anchor: Date, view: CalendarView, direction: number) {
  return view === 'month' ? addMonths(startOfMonth(anchor), direction) : addDays(anchor, direction * (view === 'week' ? 7 : 1));
}

export interface TimedPlacement { event: GoogleItem; start: number; end: number; column: number; columns: number }
/** Position by wall-clock time. An overnight event is clipped at each day's midnight. */
export function placeTimedEvents(events: readonly GoogleItem[], date: Date): TimedPlacement[] {
  const dayStart = startOfDay(date), dayEnd = addDays(dayStart, 1);
  const minute = (value: Date) => value.getHours() * 60 + value.getMinutes();
  const spans = events.filter(event => !event.allDay).flatMap(event => {
    const start = new Date(event.at), end = event.end ? new Date(event.end) : null;
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start))) return [];
    if (start >= dayEnd || (end ? end <= dayStart : start < dayStart)) return [];
    const from = start < dayStart ? 0 : minute(start);
    const until = end ? end >= dayEnd ? 1440 : minute(end) : from;
    return [{ event, start: from, end: Math.min(1440, Math.max(from + 20, until)), column: 0, columns: 1 }];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
  let group: TimedPlacement[] = [], groupEnd = -1;
  const finish = () => {
    const ends: number[] = [];
    for (const item of group) {
      let column = ends.findIndex(end => end <= item.start);
      if (column === -1) column = ends.length;
      ends[column] = item.end; item.column = column;
    }
    for (const item of group) item.columns = ends.length;
  };
  for (const span of spans) {
    if (span.start >= groupEnd) { finish(); group = []; groupEnd = -1; }
    group.push(span); groupEnd = Math.max(groupEnd, span.end);
  }
  finish();
  return spans;
}

const EVENT_COLORS = [
  'border-blue-300 bg-blue-100 text-blue-950',
  'border-violet-300 bg-violet-100 text-violet-950',
  'border-emerald-300 bg-emerald-100 text-emerald-950',
  'border-orange-300 bg-orange-100 text-orange-950',
  'border-pink-300 bg-pink-100 text-pink-950',
];
export function calendarEventColor(source: string) {
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return EVENT_COLORS[hash % EVENT_COLORS.length];
}
