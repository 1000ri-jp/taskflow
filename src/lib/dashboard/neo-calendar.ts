import { addDays, isValid, startOfDay } from 'date-fns';
import type { GoogleItem } from '@/lib/google/workspace/types';
import type { DashboardTask } from './brief';

export interface NeoCalendarDay {
  date: Date;
  tasks: DashboardTask[];
  events: GoogleItem[];
}

const priorityOrder = { high: 0, medium: 1, low: 2 } as const;

/** Calendar days use the same local timezone as the dashboard's date labels. */
export function buildNeoCalendarDays(
  tasks: readonly DashboardTask[],
  events: readonly GoogleItem[],
  now: Date,
  dayCount: number,
): NeoCalendarDay[] {
  if (!isValid(now) || !Number.isInteger(dayCount) || dayCount < 1 || dayCount > 42) return [];

  const dueTasks = tasks.filter((task): task is DashboardTask & { dueDate: Date } =>
    !task.isCompleted && !task.isArchived && !task.isAbandoned && !!task.dueDate && isValid(task.dueDate),
  );
  const spans = events.flatMap(event => {
    if (event.eventType === 'workingLocation' && event.workingLocationProperties?.type === 'homeOffice') return [];
    const start = new Date(event.at);
    if (!isValid(start)) return [];
    const end = event.end === undefined ? null : new Date(event.end);
    if (end && (!isValid(end) || end <= start)) return [];
    return [{ event, start, end }];
  });
  const today = startOfDay(now);

  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(today, index);
    const nextDay = addDays(date, 1);
    return {
      date,
      tasks: dueTasks.filter(task => task.dueDate >= date && task.dueDate < nextDay)
        .sort((a, b) => (a.priority ? priorityOrder[a.priority] : 3) - (b.priority ? priorityOrder[b.priority] : 3)
          || a.dueDate.getTime() - b.dueDate.getTime() || a.title.localeCompare(b.title, 'ja')),
      // Google end dates are exclusive, including midnight at the end of an all-day event.
      events: spans.filter(({ start, end }) => end ? start < nextDay && end > date : start >= date && start < nextDay)
        .sort((a, b) => Number(!!b.event.allDay) - Number(!!a.event.allDay)
          || a.start.getTime() - b.start.getTime() || a.event.title.localeCompare(b.event.title, 'ja'))
        .map(({ event }) => event),
    };
  });
}
