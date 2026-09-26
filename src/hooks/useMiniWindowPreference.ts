'use client';

import { useSyncExternalStore } from 'react';

export const MINI_WINDOW_PREFERENCE_KEY = 'taskflow-mini-window-visible-v1';
const changeEvent = 'taskflow-mini-window-preference';
let volatilePreference: boolean | undefined;

// Custom URLs use the installed Mac app's existing show/hide commands.
export const miniWindowBridge = {
  open(visible: boolean) { window.location.assign(`taskslowth-mini://${visible ? 'show' : 'hide'}`); },
};
function snapshot() {
  if (volatilePreference !== undefined) return volatilePreference;
  try { return localStorage.getItem(MINI_WINDOW_PREFERENCE_KEY) === 'true'; }
  catch { return false; }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === MINI_WINDOW_PREFERENCE_KEY || event.key === null) { volatilePreference = undefined; notify(); }
  };
  window.addEventListener(changeEvent, notify);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(changeEvent, notify); window.removeEventListener('storage', onStorage); };
}
export function useMiniWindowPreference() {
  const visible = useSyncExternalStore(subscribe, snapshot, () => false);
  const setVisible = (next: boolean) => {
    miniWindowBridge.open(next);
    volatilePreference = next;
    try { localStorage.setItem(MINI_WINDOW_PREFERENCE_KEY, String(next)); volatilePreference = undefined; }
    catch { /* Keep the requested state for this tab when storage is unavailable. */ }
    window.dispatchEvent(new Event(changeEvent));
  };
  return { visible, setVisible };
}
