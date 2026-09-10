import { describe, expect, it } from 'vitest';
import {
  buildCalendarBriefRow,
  buildCalendarUpcomingDays,
} from './calendar';
import type { GoogleCalendarEvent } from '@/lib/google/calendar';

const now = new Date(2026, 8, 2, 12);

function createEvent(
  overrides: Partial<GoogleCalendarEvent> = {}
): GoogleCalendarEvent {
  return {
    id: 'event-1',
    title: '予定',
    start: new Date(2026, 8, 2, 14),
    end: new Date(2026, 8, 2, 15),
    isAllDay: false,
    htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
    ...overrides,
  };
}

describe('Google Calendar dashboard data', () => {
  it('includes fourth and fifth day calendar events when five days are requested', () => {
    const events = [4, 5, 6].map((offset) => createEvent({ id: `day-${offset}`, start: new Date(2026, 8, 2 + offset, 10), end: new Date(2026, 8, 2 + offset, 11) }));
    expect(buildCalendarUpcomingDays(events, now, 5).map((day) => day.events.map((event) => event.id))).toEqual([[], [], [], ['day-4'], ['day-5']]);
    expect(buildCalendarUpcomingDays(events, now).flatMap((day) => day.events)).toEqual([]);
  });
  it('builds the today row with time and a read-only event link', () => {
    const row = buildCalendarBriefRow([createEvent()], now);

    expect(row.total).toBe(1);
    expect(row.items[0]).toMatchObject({
      source: 'CAL',
      title: '予定',
      meta: '14:00–15:00',
      action: 'カレンダーで開く',
    });
  });

  it('groups tomorrow through three days from now and preserves empty days', () => {
    const tomorrow = createEvent({
      id: 'tomorrow',
      start: new Date(2026, 8, 3),
      end: new Date(2026, 8, 4),
      isAllDay: true,
    });
    const threeDaysLater = createEvent({
      id: 'three-days-later',
      start: new Date(2026, 8, 5, 10),
      end: new Date(2026, 8, 5, 11),
    });

    const days = buildCalendarUpcomingDays([tomorrow, threeDaysLater], now);

    expect(days.map((day) => day.events.map((event) => event.id))).toEqual([
      ['tomorrow'],
      [],
      ['three-days-later'],
    ]);
  });
});
