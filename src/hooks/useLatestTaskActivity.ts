'use client';
import { useEffect, useState } from 'react';
import { subscribeToLatestTaskActivity } from '@/lib/firebase/latestTaskActivity';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { historyDate } from '@/lib/task/history/entries';
import { recentActivityEntry } from '@/lib/task/history/recentChanges';
import type { HistoryEntry } from '@/lib/task/history/types';

type Result = { scope: string; status: 'ready' | 'error'; entry: HistoryEntry | null };
export function useLatestTaskActivity(projectId: string, taskId: string, userId: string | null) {
  const scope = JSON.stringify([userId, projectId, taskId]);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const receive = (entry: HistoryEntry | null) => { if (active) setResult({ scope, status: 'ready', entry }); };
    const fail = () => { if (active) setResult({ scope, status: 'error', entry: null }); };
    if (isE2EMockAuthEnabled()) {
      const refresh = () => { void import('@/lib/task/organizationMock').then(({ readOrganizationMock }) => {
        const log = readOrganizationMock(projectId).activityLogs.filter(row => row.targetType === 'task' && row.targetId === taskId)
          .sort((a, b) => (Date.parse(historyDate(b.createdAt) ?? '') || 0) - (Date.parse(historyDate(a.createdAt) ?? '') || 0))[0];
        receive(log ? recentActivityEntry(String(log.id), log) : null);
      }).catch(fail); };
      refresh(); window.addEventListener('taskflow-work-updated', refresh);
      return () => { active = false; window.removeEventListener('taskflow-work-updated', refresh); };
    }
    const unsubscribe = subscribeToLatestTaskActivity(projectId, taskId, receive, fail);
    return () => { active = false; unsubscribe(); };
  }, [projectId, taskId, userId, scope]);
  return result?.scope === scope && userId ? result : { status: 'loading' as const, entry: null };
}
