'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import type { GoogleSource } from '@/lib/google/workspace/types';
import { nextFixedGoogleRefreshDelay } from '@/lib/google/workspace/refresh-schedule';

export function useGoogleCalendarRange(start: Date, end: Date) {
  const user = useAuthStore(state => state.firebaseUser);
  const client = useQueryClient();
  const from = start.toISOString(), until = end.toISOString();
  const query = useQuery<GoogleSource>({
    queryKey: ['google-calendar-range', user?.uid, from, until],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      const token = await user!.getIdToken();
      // The fixed slots are the freshness boundary, so bypass the short-lived range cache.
      const response = await fetch('/api/google/calendar?' + new URLSearchParams({ start: from, end: until, refresh: '1' }), {
        headers: { Authorization: 'Bearer ' + token }, signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Google予定を取得できませんでした。');
      return data;
    },
    staleTime: 120000, gcTime: 600000, retry: false,
    refetchOnWindowFocus: true, refetchInterval: query => query.state.data?.connected === false ? false : nextFixedGoogleRefreshDelay(),
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const refresh = () => { void client.resetQueries({ queryKey: ['google-calendar-range'] }); };
    window.addEventListener('taskflow-google-updated', refresh);
    return () => window.removeEventListener('taskflow-google-updated', refresh);
  }, [client]);
  return { source: query.data, loading: !!user && query.isPending, refreshing: query.isFetching,
    error: query.error?.message ?? null, refresh: () => { void query.refetch(); } };
}
