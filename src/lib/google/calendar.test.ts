import { describe, expect, it } from 'vitest';
import { normalizeGoogleCalendarEvent } from './calendar';

describe('normalizeGoogleCalendarEvent', () => {
  it('normalizes a timed event', () => {
    const event = normalizeGoogleCalendarEvent({
      id: 'event-1',
      summary: ' 定例会議 ',
      htmlLink: 'https://calendar.google.com/event-1',
      start: { dateTime: '2026-09-02T10:00:00+09:00' },
      end: { dateTime: '2026-09-02T11:00:00+09:00' },
    });

    expect(event).toMatchObject({
      id: 'event-1',
      title: '定例会議',
      isAllDay: false,
    });
  });

  it('parses all-day dates in the local calendar day and skips cancelled events', () => {
    const event = normalizeGoogleCalendarEvent({
      id: 'all-day',
      start: { date: '2026-09-03' },
      end: { date: '2026-09-04' },
    });
    const cancelled = normalizeGoogleCalendarEvent({
      id: 'cancelled',
      status: 'cancelled',
      start: { dateTime: '2026-09-03T10:00:00+09:00' },
      end: { dateTime: '2026-09-03T11:00:00+09:00' },
    });

    expect(event?.start.getFullYear()).toBe(2026);
    expect(event?.start.getMonth()).toBe(8);
    expect(event?.start.getDate()).toBe(3);
    expect(event?.isAllDay).toBe(true);
    expect(cancelled).toBeNull();
  });
});
