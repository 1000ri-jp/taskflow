'use client';

import { useCallback, useState } from 'react';
import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { useAuthStore } from '@/stores/authStore';
import { MAX_UPCOMING_DAYS } from '@/lib/dashboard/upcoming-range';
import {
  fetchGoogleCalendarEvents,
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  type GoogleCalendarEvent,
} from '@/lib/google/calendar';

export type GoogleCalendarConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error';

function connectionErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';

  if (code.includes('popup-closed-by-user')) {
    return '接続はキャンセルされました。';
  }
  if (code.includes('user-mismatch')) {
    return 'TaskFlowにログイン中のGoogleアカウントを選んでください。';
  }

  const message = error instanceof Error ? error.message : '';
  if (message.includes('has not been used') || message.includes('disabled')) {
    return 'Google Calendar APIがまだ有効になっていません。管理者の設定が必要です。';
  }

  return 'Googleカレンダーに接続できませんでした。権限設定を確認してください。';
}

export function useGoogleCalendar() {
  const { firebaseUser } = useAuthStore();
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [status, setStatus] = useState<GoogleCalendarConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!firebaseUser) {
      setStatus('error');
      setError('TaskFlowへのログインが必要です。');
      return;
    }

    setStatus('connecting');
    setError(null);

    try {
      const provider = new GoogleAuthProvider();
      provider.addScope(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
      provider.setCustomParameters({
        hd: '1000ri.jp',
        include_granted_scopes: 'true',
        ...(firebaseUser.email ? { login_hint: firebaseUser.email } : {}),
      });

      const result = await reauthenticateWithPopup(firebaseUser, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Google Calendar access token was not returned');
      }

      const now = new Date();
      const calendarEvents = await fetchGoogleCalendarEvents({
        accessToken: credential.accessToken,
        timeMin: startOfDay(now),
        timeMax: endOfDay(addDays(now, MAX_UPCOMING_DAYS)),
      });

      setEvents(calendarEvents);
      setStatus('connected');
    } catch (connectionError) {
      setEvents([]);
      setStatus('error');
      setError(connectionErrorMessage(connectionError));
    }
  }, [firebaseUser]);

  return {
    events,
    status,
    error,
    connect,
  };
}
