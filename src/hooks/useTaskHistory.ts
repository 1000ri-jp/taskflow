'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { TaskHistoryPage } from '@/lib/task/history/types';

export function useTaskHistory(projectId: string, taskId: string, userId: string | undefined, enabled: boolean, taskUpdatedAt?: string) {
  const [page, setPage] = useState<TaskHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = `${userId}/${projectId}/${taskId}`;
  const scopeRef = useRef(scope);
  const requestRef = useRef<AbortController | null>(null);
  const read = useCallback(async (cursor?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const current = () => requestRef.current === controller && scopeRef.current === scope && !controller.signal.aborted;
    setBusy(true); setError(null);
    // A refresh rechecks permissions. Do not retain personal excerpts while reauthorizing.
    if (!cursor) setPage(null);
    else setPage(previous => previous ? { ...previous, privateSources: undefined } : null);
    try {
      let result: TaskHistoryPage;
      if (isE2EMockAuthEnabled()) {
        const [{ readOrganizationMock }, { activityEntry }] = await Promise.all([import('@/lib/task/organizationMock'), import('@/lib/task/history/entries')]);
        const logs = readOrganizationMock(projectId).activityLogs.filter(log => log.targetType === 'task' && log.targetId === taskId);
        result = { entries: logs.map((log, i) => activityEntry(String(log.id ?? i), log)), nextCursor: null, activityStatus: 'ready', checkedAt: new Date().toISOString(), mode: 'mock',
          issues: ['隔離データの経緯です。実データの履歴・個人メールは取得しません。'] };
      } else {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
          headers: await getAuthHeaders(), cache: 'no-store', signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) { if (current()) setPage(null); throw new Error(data.error || '経緯を取得できません。'); }
        result = data;
      }
      if (current()) setPage(previous => cursor && previous ? { ...result,
        entries: [...new Map([...previous.entries, ...result.entries].map(e => [e.id, e])).values()],
        nextCursor: result.activityStatus === 'error' ? cursor : result.nextCursor,
      } : result);
    } catch (err) { if (current()) setError(err instanceof Error ? err.message : '経緯を取得できません。'); }
    finally { if (current()) { setBusy(false); requestRef.current = null; } }
  }, [projectId, taskId, scope]);
  useEffect(() => {
    scopeRef.current = scope;
    if (!enabled || !userId) { setPage(null); setBusy(false); return; }
    void read();
    const refresh = () => { void read(); };
    window.addEventListener('taskflow-work-updated', refresh);
    window.addEventListener('taskflow-google-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => { requestRef.current?.abort(); requestRef.current = null;
      window.removeEventListener('taskflow-work-updated', refresh); window.removeEventListener('taskflow-google-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [scope, enabled, userId, read, taskUpdatedAt]);
  // Render must not show the previous task/user while the scope effect is pending.
  return { page: scopeRef.current === scope && enabled ? page : null, error, busy, refresh: () => read(), more: () => page?.nextCursor ? read(page.nextCursor) : Promise.resolve() };
}
