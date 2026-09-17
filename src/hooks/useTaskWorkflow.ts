"use client";
import { useEffect, useRef, useState } from 'react';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { taskVersion, type WorkflowAction, type WorkflowInput, type WorkDetails, type WorkflowReceipt } from '@/lib/task/workflow';
import type { CommentAttachment, Task } from '@/types';
export function useTaskWorkflow(task: Task, userId: string, channel = 'actions', onRecorded?: (receipt: WorkflowReceipt | null) => void) {
  const key = `taskflow.workflow.v1:${JSON.stringify([userId, task.projectId, task.id, channel])}`;
  const [pending, setPending] = useState<WorkflowInput | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [receipt, setReceipt] = useState<WorkflowReceipt | null>(null);
  const guard = useRef(false); const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => {
      if (!mounted.current) return;
      try { const raw = sessionStorage.getItem(key); if (raw) { setPending(JSON.parse(raw)); setError('前回の結果を確認するため、同じ操作を再試行してください。'); } setReady(true); }
      catch { setError('送信状態を読み込めません。ブラウザの保存設定を確認してください。'); }
    });
    return () => { mounted.current = false; };
  }, [key]);
  const run = async (action: WorkflowAction, note = '', details?: WorkDetails, attachments?: CommentAttachment[], fields?: Pick<WorkflowInput, 'subtaskPatch' | 'parentTaskId'>) => {
    if (!ready || guard.current) return false;
    guard.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const input = pending ?? { id: crypto.randomUUID(), action, expectedVersion: taskVersion(task), ...fields, note, ...(details ? { details } : {}), ...(attachments ? { attachments } : {}) };
      sessionStorage.setItem(key, JSON.stringify(input)); setPending(input);
      const recorded = await sendWorkflow(task.projectId, task.id, input);
      sessionStorage.removeItem(key);
      onRecorded?.(recorded ?? null);
      if (mounted.current) { setPending(null); setSuccess('記録しました。'); setReceipt(recorded ?? null); }
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e && typeof e === 'object' && 'code' in e && e.code === 'workflow-rejected') { sessionStorage.removeItem(key); setPending(null); }
      setError(e instanceof Error ? e.message : '結果を確認できません。同じ操作を再試行してください。'); return false;
    } finally { guard.current = false; if (mounted.current) setBusy(false); }
  };
  return { run, busy, pending, ready, error, success, receipt, locked: !ready || busy || !!pending };
}
