"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMyTasks } from '@/hooks/useMyTasks';
import { completedParentIssues, readTaskCheckDecisions, saveTaskCheckDecision, TASK_CHECK_DECISION_EVENT, TASK_CHECK_READ_UNTIL, taskCheckKey, taskCheckStorageKey } from '@/lib/dashboard/task-attention';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { taskVersion, type WorkflowInput } from '@/lib/task/workflow';
import { recurrenceRequest } from '@/lib/task/recurrenceClient';
import { Button } from '@/components/ui/button';
import { civilDate } from '@/lib/task/recurrence';

export { taskCheckKey } from '@/lib/dashboard/task-attention';

export function CompanionTaskChecks({ userId, enabled = true, children }: { userId: string; enabled?: boolean; children: (check: ReactNode) => ReactNode }) {
  return enabled ? <ConnectedTaskChecks userId={userId}>{children}</ConnectedTaskChecks> : children(null);
}

function ConnectedTaskChecks({ userId, children }: { userId: string; children: (check: ReactNode) => ReactNode }) {
  const { allProjectTasks, projects, projectTaskStatus, isLoading, error } = useMyTasks();
  const available = projectTaskStatus ? allProjectTasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready') : isLoading || error ? [] : allProjectTasks;
  const issues = completedParentIssues(available).filter(issue => issue.parent.assigneeIds.includes(userId) || issue.children.some(task => task.assigneeIds.includes(userId)) || projects.some(project => project.id === issue.parent.projectId && project.ownerId === userId));
  const storageKey = taskCheckStorageKey(userId);
  const [decisions, setDecisions] = useState(() => readTaskCheckDecisions(userId));
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState<ReturnType<typeof completedParentIssues>[number] | null>(null);
  const [result, setResult] = useState('');
  const scopeActive = useRef(true);
  useEffect(() => { scopeActive.current = true; return () => { scopeActive.current = false; }; }, []);
  useEffect(() => { if (!result) return; const timer = setTimeout(() => setResult(''), 5000); return () => clearTimeout(timer); }, [result]);
  useEffect(() => {
    const syncStorage = (event: StorageEvent) => { if (event.key === storageKey) setDecisions(readTaskCheckDecisions(userId)); };
    const syncDecision = (event: Event) => { if ((event as CustomEvent<{ userId?: string }>).detail?.userId === userId) setDecisions(readTaskCheckDecisions(userId)); };
    window.addEventListener('storage', syncStorage);
    window.addEventListener(TASK_CHECK_DECISION_EVENT, syncDecision);
    return () => { window.removeEventListener('storage', syncStorage); window.removeEventListener(TASK_CHECK_DECISION_EVENT, syncDecision); };
  }, [storageKey, userId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const issue = pending ?? issues.find(issue => (decisions[taskCheckKey(issue.parent, issue.children)] ?? 0) <= now);
  const defer = (key: string, until: number) => {
    setDecisions(() => saveTaskCheckDecision(userId, key, until));
  };
  return children(result ? <section aria-label="モアイの保存結果" className="space-y-2 p-4"><p className="text-sm font-semibold">モアイ</p><p role="status" className="text-sm">{result}</p><Button size="sm" variant="ghost" onClick={() => setResult('')}>閉じる</Button></section> : issue ? <details key={JSON.stringify([issue.parent.projectId, issue.parent.id])} className="min-w-0 rounded-lg border bg-background/95">
    <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium leading-snug hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
      <span className="min-w-0 break-words">{issue.parent.title} · 未完了サブタスク {issue.children.length}件</span>
    </summary>
    <div className="border-t"><TaskCheck issue={issue} saving={pending !== null} isScopeActive={() => scopeActive.current} onBegin={() => setPending(issue)} onSettled={() => setPending(null)} onSaved={setResult} onLater={() => defer(taskCheckKey(issue.parent, issue.children), Date.now() + 60 * 60 * 1000)} onRead={() => defer(taskCheckKey(issue.parent, issue.children), TASK_CHECK_READ_UNTIL)} /></div>
  </details> : null);
}

function TaskCheck({ issue, saving, isScopeActive, onBegin, onSettled, onSaved, onLater, onRead }: { issue: ReturnType<typeof completedParentIssues>[number]; saving: boolean; isScopeActive: () => boolean; onBegin: () => void; onSettled: () => void; onSaved: (message: string) => void; onLater: () => void; onRead: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const guard = useRef(false);
  const reopenAttempt = useRef<WorkflowInput | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const complete = async () => {
    if (guard.current || saving) return;
    guard.current = true; setBusy(true); setError(''); onBegin();
    try {
      for (const task of issue.children) {
        if (!isScopeActive()) return;
        if (saved.includes(task.id)) continue;
        await recurrenceRequest(task.projectId, task.id, { action: 'complete', patch: { isCompleted: true } });
        if (active.current) setSaved(ids => [...ids, task.id]);
      }
      if (isScopeActive()) onSaved(`「${issue.parent.title}」のサブタスク${issue.children.length}件を完了にしました。`);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '完了を保存できませんでした。'); }
    finally { guard.current = false; if (active.current) setBusy(false); if (isScopeActive()) onSettled(); }
  };
  const keepWorking = async () => {
    if (guard.current || saving) return;
    guard.current = true; setBusy(true); setError(''); onBegin();
    const input = reopenAttempt.current ?? { id: crypto.randomUUID(), action: 'start' as const, expectedVersion: taskVersion(issue.parent) };
    reopenAttempt.current = input;
    try {
      await sendWorkflow(issue.parent.projectId, issue.parent.id, input);
      if (isScopeActive()) onSaved(`「${issue.parent.title}」を「着手」に戻しました。`);
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'workflow-rejected') reopenAttempt.current = null;
      if (active.current) setError(cause instanceof Error ? cause.message : '着手に戻せませんでした。もう一度お試しください。');
    } finally { guard.current = false; if (active.current) setBusy(false); if (isScopeActive()) onSettled(); }
  };
  const allSaved = issue.children.every(task => saved.includes(task.id));
  return <section aria-label="モアイからの確認" className="space-y-3 p-4">
    <p className="text-sm font-semibold">モアイ</p>
    <p className="text-xs text-muted-foreground">{issue.parent.projectName} / {issue.parent.listName || 'リスト名未取得'}</p>
    <p className="break-words text-sm leading-relaxed">「{issue.parent.title}」は{civilDate(issue.parent.completedAt) ? `${civilDate(issue.parent.completedAt)}に` : ''}完了になっています。次のサブタスクも完了していますか？</p>
    <ul className="space-y-1.5 text-sm">{issue.children.map(task => <li key={task.id} className="break-words"><span className={saved.includes(task.id) ? 'text-emerald-700' : ''}>{saved.includes(task.id) ? '✓ ' : '・'}{task.title}</span><span className="ml-1 text-xs text-muted-foreground">{saved.includes(task.id) ? '保存済み' : '未完了の記録'}</span></li>)}</ul>
    <p className="text-xs text-muted-foreground">「サブタスクを完了にする」は上の未完了記録を完了にします。「親を着手に戻す」は親を「着手」に戻します。</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}{saved.length > 0 && ' 保存できた作業は再送しません。'}</p>}
    {allSaved ? <p role="status" className="text-sm text-emerald-700">完了を保存しました。</p> : <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || saving} onClick={complete}>{busy || saving ? '保存中…' : error ? '残りのサブタスクを完了にする' : 'サブタスクを完了にする'}</Button>
      <Button size="sm" variant="outline" disabled={busy || saving} onClick={keepWorking}>親を着手に戻す</Button>
      <Button size="sm" variant="ghost" disabled={busy || saving} onClick={onLater}>1時間後</Button>
      <Button size="sm" variant="ghost" disabled={busy || saving} onClick={onRead}>既読にする</Button>
    </div>}
  </section>;
}
