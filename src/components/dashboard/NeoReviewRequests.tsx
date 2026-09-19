'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, CircleAlert, ClipboardCheck, Clock3, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { taskRowInteraction } from '@/components/ui/density';
import { useNotifications } from '@/contexts/NotificationContext';
import type { ProjectTaskStatus } from '@/hooks/useMyTasks';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { reviewRequestContent, reviewRequester, selectNeoReviewRequests } from '@/lib/dashboard/review-requests';
import { cn } from '@/lib/utils';
import { isNeoAutomationReminder } from '@/lib/dashboard/neo-brief';
import type { Notification } from '@/types';
import type { TaskViewMember } from '@/components/board/TaskViewFields';
import { NeoBriefTaskHeading } from './NeoBriefTaskRow';
import { orderReviewItems, reviewPosition, reviewTaskAttention } from '@/lib/dashboard/review-queue';

export interface NeoReviewRequestsProps {
  tasks: readonly DashboardTask[];
  userId: string | null;
  isLoading: boolean;
  error: Error | null;
  projectTaskStatus?: ReadonlyMap<string, ProjectTaskStatus>;
  isSample?: boolean;
  embedded?: boolean;
  calls?: readonly Notification[];
  members?: readonly TaskViewMember[];
}

export function NeoReviewRequests({ tasks, userId, isLoading, error, projectTaskStatus, isSample = false, embedded = false, calls = [], members = [] }: NeoReviewRequestsProps) {
  const headingId = useId();
  const { notifications } = useNotifications();
  const [display, setDisplay] = useState({ userId, limit: 3 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const limit = display.userId === userId ? display.limit : 3;
  const statuses = [...(projectTaskStatus?.values() ?? [])];
  const hasError = Boolean(error) || statuses.some(item => item.status === 'error');
  const isPending = !userId || isLoading || statuses.some(item => item.status === 'loading');
  // Only current successful project snapshots may supply task details during partial loading/failure.
  const available = useMemo(() => projectTaskStatus ? tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready')
    : isPending || hasError ? [] : tasks, [hasError, isPending, projectTaskStatus, tasks]);
  const requests = useMemo(() => selectNeoReviewRequests(available, userId), [available, userId]);
  const orderedRequests = useMemo(() => orderReviewItems(requests, `review:${userId ?? 'anonymous'}`, task => JSON.stringify([task.projectId, task.id]), task => reviewTaskAttention(task)), [requests, userId]);
  const selectedPosition = reviewPosition(orderedRequests, selectedKey, task => JSON.stringify([task.projectId, task.id]));
  const selectedRequest = orderedRequests[selectedPosition] ?? null;
  const allVisible = showAll && display.userId === userId;
  const displayedRequests = allVisible ? orderedRequests : orderedRequests.slice(selectedPosition).concat(orderedRequests.slice(0, selectedPosition)).slice(0, limit);
  const state = hasError ? statuses.some(item => item.status === 'ready') ? 'partial' : 'error' : isPending ? 'loading' : 'ready';
  const now = new Date();
  const memberById = Object.fromEntries(members.map(member => [member.id, member]));
  const names = Object.fromEntries(members.map(member => [member.id, member.displayName]));

  const moveSelection = (offset: number) => {
    if (!orderedRequests.length) return;
    const next = (selectedPosition + offset + orderedRequests.length) % orderedRequests.length;
    setSelectedKey(JSON.stringify([orderedRequests[next].projectId, orderedRequests[next].id]));
    setShowAll(false);
  };
  return <section aria-labelledby={headingId} className={embedded ? "overflow-hidden border-t" : "overflow-hidden rounded-2xl border bg-card shadow-sm"} data-testid="neo-review-requests" data-state={state}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
      <h2 id={headingId} aria-label="依頼内容" className="inline-flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />次の確認</h2>
      {requests.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{requests.length}件{state !== 'ready' ? '以上' : ''}</span>}
      {isSample && <span className="text-xs text-amber-800">架空データ</span>}
      {state === 'ready' && requests.length === 0 && <p className="text-xs text-muted-foreground">いまはありません。</p>}
    </div>
    {state !== 'ready' && <p role={hasError ? 'alert' : 'status'} className={cn('px-5 pb-3 text-xs', hasError ? 'text-amber-800' : 'text-muted-foreground')}>
      {state === 'error' ? '依頼内容を取得できません。' : state === 'partial' ? '一部の依頼内容を取得できません。取得できた分を表示しています。' : '依頼内容を読み込み中…'}
    </p>}
    {orderedRequests.length > 0 && <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2" aria-label="確認案件の移動"><span className="text-xs font-medium tabular-nums">{selectedPosition + 1} / {orderedRequests.length}{state === 'partial' ? '件以上' : '件'}</span><span className="text-xs text-muted-foreground">{reviewTaskAttention(selectedRequest ?? orderedRequests[0]).label}</span><span className="min-w-0 break-words text-xs text-muted-foreground">{reviewTaskAttention(selectedRequest ?? orderedRequests[0]).reason}</span><div className="ml-auto flex flex-wrap gap-1"><Button variant="ghost" size="sm" onClick={() => moveSelection(-1)} aria-label="前へ"><ChevronLeft className="size-3.5" />前へ</Button><Button variant="ghost" size="sm" onClick={() => moveSelection(1)} aria-label="次の件"><ChevronRight className="size-3.5" />次の件</Button><Button variant="outline" size="sm" aria-expanded={allVisible} onClick={() => setShowAll(value => !value)}>{allVisible ? '一件ずつ見る' : 'ほかの件を見る（一覧）'}</Button></div></div>}
    {displayedRequests.length > 0 && <ul>{displayedRequests.map(task => {
      const requester = reviewRequester(task, userId, notifications, members);
      const call = calls.find(call => call.projectId === task.projectId && call.taskId === task.id);
      const attention = reviewTaskAttention(task, now);
      const AttentionIcon = attention.level === 'now' ? CircleAlert : attention.level === 'soon' ? Clock3 : Info;
      const attentionClass = attention.level === 'now' ? 'border-l-2 border-rose-200 bg-rose-50' : attention.level === 'soon' ? 'border-l-2 border-amber-200 bg-amber-50' : 'border-l-2 border-transparent';
      return <li key={JSON.stringify([task.projectId, task.id])} className="px-5 py-1.5">
        <div className={cn('rounded-md px-2 py-1', attentionClass)}><Link prefetch={false} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`}
          className={taskRowInteraction + ' block rounded-md'}>
          <NeoBriefTaskHeading task={task} tasks={tasks} now={now} members={memberById} names={names} requester={requester} assigneeLimit={3} displayTitle={reviewRequestContent(task)} />
          <p className={cn('mt-1 flex items-start gap-1 break-words pl-8 text-xs', attention.level === 'now' ? 'text-rose-800' : attention.level === 'soon' ? 'text-amber-800' : 'text-muted-foreground')}><AttentionIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{attention.reason}</p>
          {task.workState && <p className="mt-1 break-words pl-8 text-xs text-amber-800">{task.workState.status === 'hold' ? '保留' : '待ち'}：{task.workState.reason} ／ 再開の条件：{task.workState.resumeCondition || '要確認'}{task.workState.reviewAt && ` ／ ${new Date(task.workState.reviewAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}に再確認`}</p>}
          {call && <p className="mt-1 pl-8 text-xs text-primary">{isNeoAutomationReminder(call) ? '全員分の確認状況 · 自動確認' : '呼びかけあり'}</p>}
        </Link></div>
      </li>;
    })}</ul>}
    {!allVisible && orderedRequests.length > limit && <Button variant="ghost" size="sm" className="m-2 text-xs" onClick={() => { setShowAll(true); setDisplay({ userId, limit: limit + 3 }); }}>ほかの依頼を見る（残り{orderedRequests.length - limit}件）</Button>}
  </section>;
}
