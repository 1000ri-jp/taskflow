'use client';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { automationRequest } from '@/lib/task/automationClient';
/** Reuses the same server worker as the scheduled job; only explicit existing grants can write. */
export function TaskAutomationRunner() {
  const uid = useAuthStore(s => s.user?.id);
  useEffect(() => {
    if (!uid || isE2EMockAuthEnabled()) return;
    let running = false; let stopped = false; let lastRun = 0;
    const run = async () => {
      if (running || stopped || document.visibilityState === 'hidden' || Date.now()-lastRun < 30000) return;
      lastRun = Date.now();
      running = true;
      try {
        const view = await automationRequest();
        if (!stopped && useAuthStore.getState().user?.id === uid && (view.grants.some(g => g.rule.enabled) || view.reminders.length)) {
          await automationRequest({ action: 'run' }); window.dispatchEvent(new Event('taskflow-automation-updated'));
        }
      } catch { /* Acquisition failures remain visible in the task; never infer a negative outcome. */ }
      finally { running = false; }
    };
    void run(); const timer = window.setInterval(run, 15 * 60000);
    window.addEventListener('taskflow-automation-request', run);
    window.addEventListener('taskflow-task-opened', run);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('taskflow-automation-request', run); window.removeEventListener('taskflow-task-opened',run); };
  }, [uid]);
  return null;
}
