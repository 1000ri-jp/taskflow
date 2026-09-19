'use client';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useSecretaryRefreshSettings } from './useSecretaryRefreshSettings';
import type { GoogleService, GoogleWorkspaceView } from '@/lib/google/workspace/types';

export function useGoogleWorkspace() {
  const user = useAuthStore(s => s.firebaseUser);
  const { refreshMinutes } = useSecretaryRefreshSettings(user?.uid ?? '');
  const client = useQueryClient(); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState<string | null>(null);
  const key = ['google-workspace-v2', user?.uid];
  const request = useCallback(async <T,>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!user) throw new Error('TaskFlowにログインしてください。');
    const token = await user.getIdToken();
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, signal });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Google連携を確認できませんでした。'); return value;
  }, [user]);
  const query = useQuery<GoogleWorkspaceView>({ queryKey: key, enabled: !!user,
    queryFn: ({ signal }) => request('/api/google', 'POST', { minutes: refreshMinutes, force: false }, signal),
    staleTime: refreshMinutes ? refreshMinutes * 60000 : Infinity,
    refetchInterval: q => q.state.error || !refreshMinutes ? false : refreshMinutes * 60000,
    refetchIntervalInBackground: false, refetchOnWindowFocus: refreshMinutes > 0, refetchOnReconnect: refreshMinutes > 0, retry: false,
  });
  async function action(operation: () => Promise<void>) {
    if (busy) return false;
    setBusy(true); setActionError(null);
    try { await operation(); return true; } catch (e) { setActionError(e instanceof Error ? e.message : 'Google連携を確認できませんでした。'); return false; }
    finally { setBusy(false); }
  }
  const refresh = () => action(async () => {
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, await request('/api/google', 'POST', { minutes: refreshMinutes, force: true }));
    window.dispatchEvent(new Event('taskflow-google-updated'));
  });
  const connect = (service: GoogleService) => action(async () => {
    const { url } = await request<{ url: string }>('/api/google/connect', 'POST', { service });
    const target = new URL(url);
    if (target.origin !== 'https://accounts.google.com') throw new Error('Google認証の戻り先を確認してください。');
    window.location.assign(url);
  }).then(() => undefined);
  const disconnect = (service: GoogleService) => action(async () => {
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, await request('/api/google', 'DELETE', { service }));
    window.dispatchEvent(new Event('taskflow-google-updated'));
  });
  const select = (service: GoogleService, ids: string[]) => action(async () => {
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, await request('/api/google', 'PATCH', { service, ids }));
    await client.invalidateQueries({ queryKey: key });
    window.dispatchEvent(new Event('taskflow-google-updated'));
  });
  return { data: query.data, loading: query.isPending, busy: busy || query.isFetching, error: actionError || query.error?.message || null,
    refresh, connect, disconnect, select, request, refreshMinutes };
}
