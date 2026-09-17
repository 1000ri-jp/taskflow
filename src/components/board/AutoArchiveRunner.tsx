'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { runAutoArchive } from '@/lib/board/autoArchiveClient';
import { autoArchiveDay, nextAutoArchiveMidnight } from '@/lib/board/autoArchiveSchedule';

/** No browser preferences are grants. The server decides from saved shared policies. */
export function AutoArchiveRunner() {
  const uid = useAuthStore(state => state.user?.id);
  const sessionUid = useAuthStore(state => state.firebaseUser?.uid);
  useEffect(() => {
    if (!uid || uid !== sessionUid || isE2EMockAuthEnabled()) return;
    let running = false;
    let stopped = false;
    let checkedDay: string | null = null;
    let pendingSave = false;
    let timer: number;
    const current = () => !stopped && useAuthStore.getState().user?.id === uid && useAuthStore.getState().firebaseUser?.uid === uid;
    const run = async (saved = false) => {
      if (saved) pendingSave = true;
      if (running || !current() || document.visibilityState === 'hidden') return;
      const day = autoArchiveDay(new Date());
      if (!pendingSave && checkedDay === day) return;
      pendingSave = false;
      running = true;
      try { await runAutoArchive(current); if (current()) checkedDay = day; }
      catch { /* Retry an interrupted check on return; saved project errors stay visible. */ }
      finally {
        running = false;
        if (current() && (pendingSave || autoArchiveDay(new Date()) !== day)) void run();
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void run(); schedule(); }, nextAutoArchiveMidnight(new Date()) - Date.now());
    };
    const saved = () => { void run(true); };
    const visible = () => { void run(); schedule(); };
    void run();
    schedule();
    window.addEventListener('taskflow-auto-archive-request', saved);
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('taskflow-auto-archive-request', saved);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [uid, sessionUid]);
  return null;
}
