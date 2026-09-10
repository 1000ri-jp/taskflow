export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.readonly';

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  htmlLink?: string;
}

interface GoogleCalendarApiEvent {
  id?: string;
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
}

interface GoogleCalendarApiResponse {
  items?: GoogleCalendarApiEvent[];
  error?: {
    message?: string;
  };
}

function parseCalendarDate(value: string | undefined): Date | null {
  if (!value) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeGoogleCalendarEvent(
  event: GoogleCalendarApiEvent
): GoogleCalendarEvent | null {
  if (!event.id || event.status === 'cancelled') return null;

  const isAllDay = Boolean(event.start?.date);
  const start = parseCalendarDate(event.start?.dateTime ?? event.start?.date);
  const end = parseCalendarDate(event.end?.dateTime ?? event.end?.date);
  if (!start || !end) return null;

  return {
    id: event.id,
    title: event.summary?.trim() || '（タイトルなし）',
    start,
    end,
    isAllDay,
    htmlLink: event.htmlLink,
  };
}

export async function fetchGoogleCalendarEvents({
  accessToken,
  timeMin,
  timeMax,
}: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const data = (await response.json()) as GoogleCalendarApiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || 'Googleカレンダーの取得に失敗しました');
  }

  return (data.items ?? [])
    .map(normalizeGoogleCalendarEvent)
    .filter((event): event is GoogleCalendarEvent => event !== null);
}
