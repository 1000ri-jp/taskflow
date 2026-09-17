'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { useSecretaryRefreshSettings } from './useSecretaryRefreshSettings';
import type { ActionRequest, SecretaryView } from '@/lib/secretary/types';
import type { MockSecretary } from '@/lib/secretary/mock';
import type { IncomingActionRequest } from '@/lib/secretary/incomingDecisions';

type Operation = 'read' | 'review' | 'act' | 'incoming' | 'arrival' | 'policy' | 'finished' | 'failure' | 'recover' | 'reset';
export function useSecretary(userId: string) {
  const [view, setView] = useState<SecretaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedIncoming, setFailedIncoming] = useState<IncomingActionRequest | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastAttemptAt, setLastAttemptAt] = useState<number | null>(null);
  const { refreshMinutes } = useSecretaryRefreshSettings(userId);
  const active = useRef(true);
  const autoRef = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pendingRead = useRef(false);
  const [readVersion, setReadVersion] = useState(0);
  const provider = useAISettingsStore(s => s.provider);
  const model = useAISettingsStore(s => s[`${s.provider}Model`]);
  const perform = useCallback(async (operation: Operation, action?: ActionRequest | IncomingActionRequest) => {
    if (controller.current) return false;
    const requestController = new AbortController();
    controller.current = requestController;
    const isCurrent = () => active.current && controller.current === requestController;
    setLastAttemptAt(Date.now());
    setBusy(true); setError(null);
    if (operation === 'incoming') setFailedIncoming(action as IncomingActionRequest);
    try {
      let result: SecretaryView;
      if (isE2EMockAuthEnabled()) {
        const workbench = await import('@/lib/secretary/mock');
        if (!isCurrent()) return false;
        const storageKey = `taskflow-secretary-lab-v1:${userId}`;
        const run = () => {
          requestController.signal.throwIfAborted();
          const now = new Date().toISOString();
          const saved = localStorage.getItem(storageKey);
          let mock: MockSecretary = saved ? JSON.parse(saved) : workbench.createMockSecretary(userId, now);
          if (operation === 'reset') mock = workbench.createMockSecretary(userId, now);
          else if (operation === 'review') mock = workbench.reviewMock(mock, userId, now);
          else if (operation === 'act' && action) mock = workbench.actMock(mock, userId, action as ActionRequest, now);
          else if (operation === 'incoming' && action) mock = workbench.actIncomingMock(mock, userId, action as IncomingActionRequest, now);
          else if (operation !== 'read' && operation !== 'act' && operation !== 'incoming') mock = workbench.changeMock(mock, operation as 'arrival', now);
          let next = workbench.mockView(mock, userId, now);
          if (operation === 'read' && autoRef.current && next.needsReview && next.snapshot.coverage.status !== 'partial') {
            mock = workbench.reviewMock(mock, userId, now); next = workbench.mockView(mock, userId, now);
          }
          localStorage.setItem(storageKey, JSON.stringify(mock));
          return next;
        };
        // Serialize tabs as well as clicks. Missing storage / lock support is reported, not a false save.
        if (!navigator.locks) throw new Error('このブラウザは検証データの排他保存に対応していません。');
        result = await navigator.locks.request(storageKey, run);
      } else {
        const request = async (method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<SecretaryView> => {
          const response = await fetch('/api/secretary', { method, headers: await getAuthHeaders(), cache: 'no-store',
            ...(body ? { body: JSON.stringify(body) } : {}), signal: requestController.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'AI秘書を読み込めませんでした。');
          return data;
        };
        if (operation === 'review') result = await request('POST', { provider, model });
        else if (operation === 'act' || operation === 'incoming') result = await request('PATCH', action);
        else {
          result = await request('GET');
          if (autoRef.current && result.needsReview && result.snapshot.coverage.status !== 'partial') result = await request('POST', { provider, model });
        }
      }
      if (isCurrent()) {
        setView(result);
        if (operation === 'incoming' || operation === 'read') setFailedIncoming(null);
        if (result.reviewWarnings?.length) { setError(result.reviewWarnings.join(' ')); autoRef.current = false; setAuto(false); }
        if (operation === 'act' && action && result.state.history.some(h => h.proposalId === (action as ActionRequest).proposalId && h.afterTask)) {
          window.dispatchEvent(new CustomEvent('taskflow-work-updated', { detail: { origin: 'secretary' } }));
        }
        return true;
      }
      return false;
    } catch (e) {
      if (isCurrent() && !(e instanceof Error && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : '取得・保存できませんでした。');
        autoRef.current = false; setAuto(false);
      }
      return false;
    } finally {
      if (isCurrent()) { controller.current = null; setBusy(false); if (pendingRead.current) { pendingRead.current = false; setReadVersion(value => value + 1); } }
    }
  }, [userId, provider, model]);
  useEffect(() => { if (readVersion > 0) void perform('read'); }, [readVersion, perform]);
  useEffect(() => {
    active.current = true;
    void perform('read');
    const onGoogleUpdated = (event: Event) => {
      if ((event as CustomEvent).detail?.origin === 'secretary') return;
      if (controller.current) pendingRead.current = true; else void perform('read');
    };
    window.addEventListener('taskflow-google-updated', onGoogleUpdated);
    window.addEventListener('taskflow-work-updated', onGoogleUpdated);
    return () => {
      window.removeEventListener('taskflow-google-updated', onGoogleUpdated);
      window.removeEventListener('taskflow-work-updated', onGoogleUpdated);
      active.current = false; pendingRead.current = false;
      controller.current?.abort();
      // Strict Mode immediately starts the effect again. Release the cancelled
      // request now; its later catch/finally must not replace the new request.
      controller.current = null;
    };
  }, [perform]);
  useEffect(() => {
    if (refreshMinutes === 0 || lastAttemptAt === null) return;
    const intervalMs = refreshMinutes * 60_000;
    const tick = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttemptAt >= intervalMs) void perform('read');
    };
    // A manual refresh also starts a new interval. Returning to this page only
    // fetches when that interval has elapsed, including time spent hidden.
    const timer = setTimeout(tick, Math.max(0, lastAttemptAt + intervalMs - Date.now()));
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearTimeout(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [perform, refreshMinutes, lastAttemptAt, busy]);
  useEffect(() => {
    // Today's labels and questions expire at JST midnight, even when periodic reads are off.
    const nextMidnight = Math.floor((Date.now() + 9 * 3600000) / 86400000) * 86400000 + 86400000 - 9 * 3600000;
    const timer = setTimeout(() => {
      if (controller.current) pendingRead.current = true; else void perform('read');
    }, Math.max(1, nextMidnight - Date.now()));
    return () => clearTimeout(timer);
  }, [perform, lastAttemptAt]);
  return { view, error, busy, auto, failedIncoming, retryIncoming: () => failedIncoming && perform('incoming', failedIncoming), setAuto: (value: boolean) => { autoRef.current = value; setAuto(value); },
    refresh: () => perform('read'), review: () => perform('review'), act: (request: ActionRequest) => perform('act', request),
    actIncoming: (request: IncomingActionRequest) => perform('incoming', request),
    testEvent: (event: Exclude<Operation, 'read' | 'review' | 'act' | 'incoming'>) => perform(event) };
}
