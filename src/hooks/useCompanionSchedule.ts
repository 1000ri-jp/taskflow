'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_COMPANION_SCHEDULE, currentCompanionGreeting, validateCompanionScheduleSettings, type CompanionScheduleSettings } from '@/lib/ai/companionSchedule';

const CHANGE_EVENT = 'taskflow-companion-schedule-settings';
const PREVIEW_EVENT = 'taskflow-companion-greeting-preview';
const settingsKey = (userId: string) => `taskflow.companion.schedule.v1:${userId}`;
const seenKey = (userId: string) => `taskflow.companion.schedule-seen.v1:${userId}`;
const defaultJSON = JSON.stringify(DEFAULT_COMPANION_SCHEDULE);

function readSettings(userId: string): CompanionScheduleSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(settingsKey(userId)) ?? defaultJSON);
    return validateCompanionScheduleSettings(raw) ? raw : DEFAULT_COMPANION_SCHEDULE;
  } catch { return DEFAULT_COMPANION_SCHEDULE; }
}

export function useCompanionScheduleSettings(userId: string) {
  const key = settingsKey(userId);
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
    const change = (event: Event) => { if ((event as CustomEvent<string>).detail === key) notify(); };
    window.addEventListener('storage', storage); window.addEventListener(CHANGE_EVENT, change);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(CHANGE_EVENT, change); };
  }, [key]);
  const snapshot = useCallback(() => {
    try { return localStorage.getItem(key) ?? defaultJSON; } catch { return defaultJSON; }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => defaultJSON);
  const settings = useMemo(() => {
    try { const value: unknown = JSON.parse(raw); return validateCompanionScheduleSettings(value) ? value : DEFAULT_COMPANION_SCHEDULE; }
    catch { return DEFAULT_COMPANION_SCHEDULE; }
  }, [raw]);
  const saveSettings = useCallback((next: CompanionScheduleSettings) => {
    if (Array.isArray(next?.targetDays) && next.targetDays.length === 0) throw new Error('対象日を1つ以上選んでください。');
    if (!userId || !validateCompanionScheduleSettings(next)) throw new Error('時刻とメッセージを確認してください。');
    const times = next.entries.filter(entry => entry.enabled).map(entry => entry.time);
    if (new Set(times).size !== times.length) throw new Error('同じ時刻の声かけは1件にまとめてください。');
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { throw new Error('このブラウザに保存できませんでした。設定を保持したまま、もう一度お試しください。'); }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
  }, [key, userId]);
  return { settings, saveSettings };
}

export function previewCompanionGreeting(userId: string, message: string): void {
  if (!userId || typeof message !== 'string' || !message.trim() || message.trim().length > 120) throw new Error('メッセージは1〜120文字で入力してください。');
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: { userId, message: message.trim() } }));
}

type ScheduledGreeting = NonNullable<ReturnType<typeof currentCompanionGreeting>>;
type Greeting = { key: string; id: string; message: string; preview: boolean; expiresAt?: number };
type SeenEntry = { owner: string; at: number };

async function claimGreeting(userId: string, candidate: ScheduledGreeting, active: () => boolean, signal: AbortSignal) {
  const key = seenKey(userId);
  const owner = crypto.randomUUID();
  const claim = () => {
    if (!active() || document.visibilityState === 'hidden') return false;
    const current = currentCompanionGreeting(readSettings(userId), new Date());
    if (current?.key !== candidate.key) return false;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
      const records: Record<string, SeenEntry> = {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [entryKey, value] of Object.entries(parsed)) {
          if (value && typeof value === 'object' && typeof value.owner === 'string' && typeof value.at === 'number' && Number.isFinite(value.at)) records[entryKey] = value;
        }
      }
      if (records[candidate.key]) return false;
      const recent = Object.fromEntries(Object.entries(records).sort((a, b) => a[1].at - b[1].at).slice(-167));
      recent[candidate.key] = { owner, at: Date.now() };
      localStorage.setItem(key, JSON.stringify(recent));
      return true;
    } catch { return false; } // Without durable storage, stay quiet instead of repeating on every reload.
  };
  if (navigator.locks?.request) {
    try { return await navigator.locks.request(key, claim); } catch { return false; }
  }
  // Older browsers have no cross-tab lock. Verify ownership after competing tabs have had a chance to claim.
  if (!claim()) return false;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => {
      // This tab never displayed the greeting. Release only its own pending claim.
      try {
        const records = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (records[candidate.key]?.owner === owner) { delete records[candidate.key]; localStorage.setItem(key, JSON.stringify(records)); }
      } catch { /* A storage failure must not keep the timer alive. */ }
      finish();
    };
    const timer = setTimeout(finish, 40);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try { return active() && JSON.parse(localStorage.getItem(key) ?? '{}')[candidate.key]?.owner === owner; }
  catch { return false; }
}

export function useCompanionSchedule(userId: string, { blocked = false, paused = false }: { blocked?: boolean; paused?: boolean } = {}) {
  const { settings } = useCompanionScheduleSettings(userId);
  const [shown, setShown] = useState<{ userId: string; greeting: Greeting } | null>(null);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const current = shown?.userId === userId ? shown.greeting : null;
  const enabled = current?.preview || settings.enabled && settings.entries.some(entry => entry.id === current?.id && entry.enabled);
  const greeting = enabled ? current : null;
  // Discard the old display when its account or setting changes; re-enabling must not revive it.
  if (shown && (shown.userId !== userId || !enabled)) setShown(null);
  const latest = useRef({ userId, blocked, greeting });
  latest.current = { userId, blocked, greeting };
  const dismiss = useCallback(() => setShown(null), []);

  useEffect(() => {
    if (!userId) return;
    const preview = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.userId !== userId || typeof detail.message !== 'string' || !detail.message.trim() || detail.message.length > 120) return;
      setShown({ userId, greeting: { key: `preview:${crypto.randomUUID()}`, id: 'preview', message: detail.message, preview: true } });
    };
    window.addEventListener(PREVIEW_EVENT, preview);
    return () => window.removeEventListener(PREVIEW_EVENT, preview);
  }, [userId]);

  useEffect(() => {
    let active = true; let running = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const isActive = () => active && latest.current.userId === userId && !latest.current.blocked && !latest.current.greeting;
    const check = async () => {
      if (!active || !userId || !settings.enabled || running || latest.current.blocked || document.visibilityState === 'hidden') return;
      const display = latest.current.greeting;
      if (display) {
        if (!display.preview && (display.expiresAt !== undefined && display.expiresAt < Date.now()
          || currentCompanionGreeting(settings, new Date())?.key !== display.key)) {
          await Promise.resolve();
          if (active && latest.current.greeting?.key === display.key) setShown(null);
        }
        return;
      }
      if (!isActive()) return;
      const candidate = currentCompanionGreeting(settings, new Date());
      if (!candidate) return;
      running = true;
      try {
        if (await claimGreeting(userId, candidate, isActive, controller.signal) && isActive() && candidate.expiresAt >= Date.now()) setShown({ userId, greeting: { ...candidate, preview: false } });
      } finally { running = false; }
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (!active || !userId || !settings.enabled || !settings.entries.some(entry => entry.enabled) || latest.current.greeting || document.visibilityState === 'hidden') return;
      timer = setTimeout(() => { void check(); arm(); }, 60000 - Date.now() % 60000 + 10);
    };
    const onVisibility = () => { setVisible(document.visibilityState !== 'hidden'); void check(); arm(); };
    document.addEventListener('visibilitychange', onVisibility);
    void check(); arm();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [userId, settings, blocked, greeting?.key]);

  const remaining = useRef({ key: '', milliseconds: 30000 });
  useEffect(() => {
    if (!greeting) return;
    if (remaining.current.key !== greeting.key) remaining.current = { key: greeting.key, milliseconds: 30000 };
    if (paused || blocked && !greeting.preview || !visible) return;
    const started = Date.now(); const key = greeting.key;
    const timer = setTimeout(dismiss, remaining.current.milliseconds);
    return () => {
      clearTimeout(timer);
      if (remaining.current.key === key) remaining.current.milliseconds = Math.max(0, remaining.current.milliseconds - (Date.now() - started));
    };
  }, [greeting, blocked, paused, visible, dismiss]);

  return { greeting, dismiss };
}
