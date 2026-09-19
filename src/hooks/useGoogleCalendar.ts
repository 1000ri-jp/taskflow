'use client';
import { useMemo } from 'react';
import { useGoogleWorkspace } from './useGoogleWorkspace';
import type { GoogleCalendarEvent } from '@/lib/google/calendar';
export type GoogleCalendarConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';
export function useGoogleCalendar() {
  const google = useGoogleWorkspace();
  const source = google.data?.sources.calendar;
  const events = useMemo<GoogleCalendarEvent[]>(() => (source?.items ?? []).map(e => ({ id: e.id, title: e.title,
    start: new Date(e.at), end: new Date(e.end ?? e.at), isAllDay: e.allDay === true, htmlLink: e.url })), [source?.items]);
  const status: GoogleCalendarConnectionStatus = source?.connected && (source.fetchedAt || source.status === 'selection_required') ? 'connected' : google.error || source?.status === 'error' ? 'error' : google.loading ? 'connecting' : 'idle';
  return { events, status, error: google.error || source?.error || null, connect: () => google.connect('calendar') };
}
