'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const SECRETARY_REFRESH_OPTIONS = [
  { minutes: 0, label: '手動のみ' },
  { minutes: 1, label: '1分ごと' },
  { minutes: 5, label: '5分ごと' },
  { minutes: 15, label: '15分ごと' },
  { minutes: 30, label: '30分ごと' },
  { minutes: 60, label: '1時間ごと' },
  { minutes: 180, label: '3時間ごと' },
] as const;

const DEFAULT_MINUTES = 60;
const CHANGE_EVENT = 'taskflow-secretary-refresh-settings';
const storageKey = (userId: string) => `taskflow-secretary-refresh-minutes-v1:${userId}`;
const isValid = (minutes: number) => SECRETARY_REFRESH_OPTIONS.some(option => option.minutes === minutes);

export function setSecretaryRefreshMinutes(userId: string, minutes: number) {
  if (!isValid(minutes)) throw new Error('取得間隔を選択してください。');
  localStorage.setItem(storageKey(userId), String(minutes));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: storageKey(userId) }));
}

export function useSecretaryRefreshSettings(userId: string) {
  const key = storageKey(userId);
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
    const onChange = (event: Event) => { if ((event as CustomEvent<string>).detail === key) notify(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE_EVENT, onChange); };
  }, [key]);
  const getSnapshot = useCallback(() => {
    try {
      const saved = localStorage.getItem(key);
      const minutes = saved === null || saved.trim() === '' ? DEFAULT_MINUTES : Number(saved);
      return isValid(minutes) ? minutes : DEFAULT_MINUTES;
    } catch { return DEFAULT_MINUTES; }
  }, [key]);
  const refreshMinutes = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MINUTES);
  return { refreshMinutes, setRefreshMinutes: (minutes: number) => setSecretaryRefreshMinutes(userId, minutes) };
}
