'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sunrise, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useAuthStore } from '@/stores/authStore';
import { useMyTasks, type MyTask, type ProjectTaskStatus } from '@/hooks/useMyTasks';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { useNotifications, NotificationProvider, NotificationSnapshotProvider, type NotificationContextType } from '@/contexts/NotificationContext';
import { NeoMorningBrief } from '@/components/dashboard/NeoMorningBrief';
import { DesktopMoaiEntry } from './DesktopMoaiEntry';
import { DesktopMiniLogin } from './DesktopMiniLogin';
import { DesktopBriefTaskActions, type MiniTaskFeedback, type BriefTaskControlsRenderer } from './DesktopBriefTaskActions';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { TaskViewMember } from '@/components/board/TaskViewFields';
import type { Notification } from '@/types';
import type { DashboardTask } from '@/lib/dashboard/brief';

const CACHE_PREFIX = 'taskflow.desktop-mini.snapshot.v1:';
const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'completedAt', 'achievedAt', 'archivedAt', 'dueDate', 'startDate', 'uploadedAt', 'reviewAt']);

type DesktopSnapshot = {
  userId: string;
  tasks: MyTask[];
  projectTaskStatus: Array<[string, 'ready']>;
  members: TaskViewMember[];
  notifications: Notification[];
  updatedAt: string;
};

function reviveDates(value: unknown, key = '', path: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map(item => reviveDates(item, '', path));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, reviveDates(childValue, childKey, [...path, childKey])]));
  // The snapshot envelope keeps updatedAt as an ISO string for validation and
  // display. Task/notification updatedAt fields still revive to Date objects.
  if (typeof value === 'string' && DATE_KEYS.has(key) && !(key === 'updatedAt' && path.length === 1) && Number.isFinite(Date.parse(value))) return new Date(value);
  return value;
}

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

function readSnapshot(userId: string): DesktopSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = reviveDates(JSON.parse(raw)) as Partial<DesktopSnapshot>;
    if (parsed.userId !== userId || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.projectTaskStatus) || !Array.isArray(parsed.members) || !Array.isArray(parsed.notifications) || typeof parsed.updatedAt !== 'string' || !Number.isFinite(Date.parse(parsed.updatedAt))) return null;
    return parsed as DesktopSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: DesktopSnapshot) {
  try { localStorage.setItem(cacheKey(snapshot.userId), JSON.stringify(snapshot)); } catch { /* Cache is an enhancement; live data remains authoritative. */ }
}

function formatUpdatedAt(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, 'M/d H:mm:ss', { locale: ja }) : '';
}

function allProjectsReady(projectTaskStatus: ReadonlyMap<string, ProjectTaskStatus>) {
  return [...projectTaskStatus.values()].every(status => status.status === 'ready');
}

function MiniUndo({ task, userId, onFeedback }: { task: MyTask; userId: string; onFeedback: (feedback: MiniTaskFeedback) => void }) {
  const flow = useTaskWorkflow(task, userId, 'mini-undo');
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    if (busy || !flow.ready) return;
    setBusy(true);
    const ok = await flow.run('reopen');
    if (ok) onFeedback({ task, action: 'reopen', ok: true, message: '完了を取り消しました。' });
    setBusy(false);
  };
  return <>
    <button type="button" onClick={() => void undo()} disabled={busy || flow.locked} className="shrink-0 rounded-md border border-current/20 px-2 py-1 text-xs font-medium hover:bg-black/5 disabled:cursor-wait disabled:opacity-50">{busy ? '保存中…' : '取り消す'}</button>
    {flow.error && <span role="alert" className="block basis-full text-xs">{flow.error}</span>}
  </>;
}

function DesktopMiniContent({ active, embedded = false }: { active: boolean; embedded?: boolean }) {
  const userId = useAuthStore(state => state.user?.id ?? null);
  const { allProjectTasks, projects, projectTaskStatus, isLoading, error } = useMyTasks(active);
  const members = useMeetingMembers(projects, Boolean(userId) && active);
  const notifications = useNotifications();
  const [now, setNow] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [feedback, setFeedback] = useState<MiniTaskFeedback | null>(null);
  const savedLiveSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) { setSnapshot(null); return; }
    setSnapshot(readSnapshot(userId));
  }, [userId]);

  // Keep the same shared subscriptions as the site. This timer only refreshes
  // the displayed clock; it never polls or calls AI.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, [active]);

  // Local fictional data is opt-in and uses the existing isolated workbench.
  useEffect(() => {
    if (!active || !isE2EMockAuthEnabled()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') !== 'mini') return;
    void import('@/lib/task/organizationMock').then(({ addStrictDeadlineExampleData, mutateOrganizationMock, ORGANIZATION_MOCK_PROJECT }) => mutateOrganizationMock(ORGANIZATION_MOCK_PROJECT, work => {
      addStrictDeadlineExampleData(work.data);
    })).catch(() => {});
  }, [active]);

  const liveSuccess = Boolean(userId) && !isLoading && !error && !notifications.isLoading && !notifications.error && allProjectsReady(projectTaskStatus);
  const liveSignature = useMemo(() => liveSuccess ? JSON.stringify([
    userId,
    allProjectTasks,
    [...projectTaskStatus.entries()],
    members.users,
    notifications.notifications,
  ]) : null, [allProjectTasks, liveSuccess, members.users, notifications.notifications, projectTaskStatus, userId]);
  useEffect(() => {
    if (!liveSuccess || !userId || !liveSignature || savedLiveSignature.current === liveSignature) return;
    savedLiveSignature.current = liveSignature;
    const next: DesktopSnapshot = {
      userId,
      tasks: allProjectTasks,
      projectTaskStatus: [...projectTaskStatus.entries()].filter(([, status]) => status.status === 'ready').map(([projectId]) => [projectId, 'ready']),
      members: members.users,
      notifications: notifications.notifications,
      updatedAt: new Date().toISOString(),
    };
    setSnapshot(next);
    writeSnapshot(next);
  }, [allProjectTasks, liveSignature, liveSuccess, members.users, notifications.notifications, projectTaskStatus, userId]);

  useEffect(() => {
    if (liveSuccess) return;
    savedLiveSignature.current = null;
  }, [liveSuccess]);

  const refresh = () => window.dispatchEvent(new Event('taskflow-work-updated'));
  const failed = error || notifications.error;
  const showingSnapshot = Boolean(snapshot && userId && (isLoading || notifications.isLoading || failed));
  const displayTasks = useMemo(() => showingSnapshot ? snapshot?.tasks ?? [] : allProjectTasks, [allProjectTasks, showingSnapshot, snapshot]);
  const displayStatuses = useMemo(() => showingSnapshot ? new Map<string, ProjectTaskStatus>(snapshot?.projectTaskStatus.map(([id]) => [id, { status: 'ready' }]) ?? []) : projectTaskStatus, [projectTaskStatus, showingSnapshot, snapshot]);
  const displayMembers = showingSnapshot ? snapshot?.members ?? [] : members.users;
  const staleText = showingSnapshot
    ? failed ? `更新できていません。最後に取得: ${formatUpdatedAt(snapshot?.updatedAt)}` : '更新中です。最後に取得できた内容を表示しています。'
    : null;
  const displayError = failed ? new Error('更新できていません') : error;
  const notificationValue: NotificationContextType = useMemo(() => showingSnapshot && snapshot ? { ...notifications, notifications: snapshot.notifications, isLoading: false } : notifications, [notifications, showingSnapshot, snapshot]);
  const handleFeedback = useCallback((next: MiniTaskFeedback) => setFeedback(next), []);
  const taskActions = useCallback((task: DashboardTask, renderControls?: BriefTaskControlsRenderer) => <DesktopBriefTaskActions renderControls={renderControls} key={`${task.projectId}:${task.id}`} task={task} allTasks={displayTasks} userId={userId ?? ''} onFeedback={handleFeedback} />, [displayTasks, handleFeedback, userId]);
  const feedbackTask = feedback ? allProjectTasks.find(task => task.projectId === feedback.task.projectId && task.id === feedback.task.id) : null;

  if (!userId) return <DesktopMiniLogin />;

  return <main className={embedded ? 'h-full min-h-0 overflow-y-auto bg-background p-3 text-foreground' : 'min-h-screen overflow-y-auto bg-background p-3 text-foreground sm:p-4'} data-testid="desktop-mini-app">
    <div className={embedded ? 'w-full space-y-3' : 'mx-auto w-full max-w-2xl space-y-3'}>
      <header className="flex items-center gap-3 px-1 py-1">
        <Sunrise className="size-5 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xs text-muted-foreground">TaskSlowth Mini</h1>
          <time dateTime={format(now, 'yyyy-MM-dd')} className="text-base font-semibold">{format(now, 'yyyy年M月d日（E）', { locale: ja })}</time>
        </div>
        <DesktopMoaiEntry />
        <button type="button" onClick={refresh} aria-label="更新" title="TaskSlowthの共有データを再確認" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><RefreshCw className="size-4" aria-hidden="true" /></button>
      </header>
      {feedback && <div role={feedback.ok ? 'status' : 'alert'} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${feedback.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}><span className="min-w-0 flex-1 break-words">{feedback.task.title}：{feedback.message}</span>{feedback.ok && feedback.action === 'complete' && feedbackTask && <MiniUndo task={feedbackTask} userId={userId} onFeedback={handleFeedback} />}<button type="button" aria-label="操作結果を閉じる" onClick={() => setFeedback(null)} className="px-1 text-base leading-none opacity-70 hover:opacity-100">×</button></div>}
      {staleText && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{staleText}</p>}
      {!staleText && isLoading && <p role="status" className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">TaskSlowthの内容を読み込んでいます…</p>}
      {!staleText && error && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">TaskSlowthを更新できません。取得できた内容は表示していません。</p>}
      <NotificationSnapshotProvider value={notificationValue}>
        <section aria-label="今日のブリーフィング" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3"><h2 className="font-semibold">今日のブリーフィング</h2></div>
          <NeoMorningBrief tasks={displayTasks} userId={userId} isLoading={isLoading && !showingSnapshot} error={displayError} projectTaskStatus={displayStatuses} members={displayMembers} now={now} isSample={false} miniLayout showFooterNote={false} taskLinkTarget="_blank" taskActions={taskActions} />
        </section>
      </NotificationSnapshotProvider>
    </div>
  </main>;
}

export function DesktopMiniApp() {
  return <DesktopMiniShell />;
}

export function DesktopMiniPanel() {
  return <DesktopMiniContent active embedded />;
}

function DesktopMiniShell() {
  const userId = useAuthStore(state => state.user?.id ?? null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    const suspend = () => setActive(false);
    const resume = () => setActive(true);
    const visibility = () => document.visibilityState === 'visible' ? resume() : suspend();
    window.addEventListener('taskflow-mini-hidden', suspend);
    window.addEventListener('taskflow-mini-visible', resume);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('taskflow-mini-hidden', suspend);
      window.removeEventListener('taskflow-mini-visible', resume);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  // Keep the ephemeral pairing key alive while the user moves to the browser
  // or hides Mini during sign-in. Ordinary data subscriptions still suspend.
  if (!userId) return <DesktopMiniLogin />;
  if (!active) return <main className="flex min-h-screen items-center justify-center bg-background p-4 text-xs text-muted-foreground">TaskSlowth Miniは一時停止中です。</main>;
  return <NotificationProvider enabled={active}>
    <div hidden={!active} aria-hidden={!active}>
      <DesktopMiniContent active={active} />
    </div>
  </NotificationProvider>;
}
