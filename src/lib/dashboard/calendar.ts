import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import type { DashboardBriefRow } from './brief';
import type { GoogleCalendarEvent } from '@/lib/google/calendar';
import type { UpcomingRange } from './upcoming-range';

export interface DashboardCalendarDay {
  dayOffset: number;
  date: Date;
  events: GoogleCalendarEvent[];
}

function calendarEventMeta(event: GoogleCalendarEvent): string {
  if (event.isAllDay) return '終日';
  return `${format(event.start, 'H:mm')}–${format(event.end, 'H:mm')}`;
}

export function buildCalendarBriefRow(
  events: GoogleCalendarEvent[],
  now: Date = new Date()
): DashboardBriefRow {
  const todayEvents = events.filter((event) => isSameDay(event.start, now));

  return {
    label: '今日の予定',
    tone: 'blue',
    total: todayEvents.length,
    items:
      todayEvents.length > 0
        ? todayEvents.map((event) => ({
            source: 'CAL' as const,
            title: event.title,
            meta: calendarEventMeta(event),
            action: event.htmlLink ? 'カレンダーで開く' : undefined,
            href: event.htmlLink,
          }))
        : [
            {
              source: 'CAL' as const,
              title: '今日のGoogleカレンダー予定はありません',
              meta: '読み取り専用で接続中',
            },
          ],
  };
}

export function buildCalendarUpcomingDays(
  events: GoogleCalendarEvent[],
  now: Date = new Date(),
  dayCount: UpcomingRange = 3
): DashboardCalendarDay[] {
  return Array.from({ length: dayCount }, (_, index) => index + 1).map((dayOffset) => {
    const date = startOfDay(addDays(now, dayOffset));
    return {
      dayOffset,
      date,
      events: events.filter((event) => isSameDay(event.start, date)),
    };
  });
}
