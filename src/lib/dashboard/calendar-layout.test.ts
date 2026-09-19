import { describe, it, expect } from 'vitest';
import { calendarWindow, moveCalendar, placeTimedEvents } from './calendar-layout';
import type { GoogleItem } from '@/lib/google/workspace/types';
const day = new Date(2026, 8, 15);
const event = (id: string, hour: number, end: number): GoogleItem => ({ id, title: id, sourceName: '予定', text: '', url: '', at: new Date(2026, 8, 15, hour).toISOString(), end: new Date(2026, 8, 15, end).toISOString() });
describe('calendar layout', () => {
  it('uses Monday weeks, six-week months, and navigates month ends without skipping a month', () => {
    expect(calendarWindow(day, 'week')).toEqual({ start: new Date(2026, 8, 14), end: new Date(2026, 8, 21), count: 7 });
    expect(calendarWindow(day, 'month')).toEqual({ start: new Date(2026, 7, 31), end: new Date(2026, 9, 12), count: 42 });
    expect(moveCalendar(new Date(2026, 0, 31), 'month', 1)).toEqual(new Date(2026, 1, 1));
  });
  it('shares space for overlapping appointments and gives the next independent appointment its full width', () => {
    const result = placeTimedEvents([event('b', 10, 12), event('a', 9, 11), event('c', 11, 13), event('d', 13, 14)], day);
    expect(result.map(item => [item.event.id, item.start, item.column, item.columns])).toEqual([['a', 540, 0, 2], ['b', 600, 1, 2], ['c', 660, 0, 2], ['d', 780, 0, 1]]);
  });
  it('clips midnight-exclusive events, handles short/missing ends without concealing neighboring appointments', () => {
    const overnight = { ...event('overnight', 23, 24), at: new Date(2026, 8, 14, 23).toISOString(), end: new Date(2026, 8, 15, 1).toISOString() };
    const unknown = { ...event('unknown', 9, 10), end: undefined };
    const short = { ...event('short', 9, 10), at: new Date(2026, 8, 15, 9, 5).toISOString(), end: new Date(2026, 8, 15, 9, 10).toISOString() };
    const result = placeTimedEvents([overnight, unknown, short, { ...event('all', 0, 24), allDay: true }], day);
    expect(result.map(item => [item.start, item.end, item.columns])).toEqual([[0, 60, 1], [540, 560, 2], [545, 565, 2]]);
    expect(placeTimedEvents([{ ...overnight, end: day.toISOString() }], day)).toEqual([]);
  });
});
