'use client';

import Link from 'next/link';
import { TriangleAlert, ArrowUpRight } from 'lucide-react';
import { taskRowInteraction } from '@/components/ui/density';
import { completedParentIssues } from '@/lib/dashboard/task-attention';
import { ProjectMark } from '@/components/project/ProjectMark';
import type { NeoReviewRequestsProps } from './NeoReviewRequests';
import type { DashboardTask } from '@/lib/dashboard/brief';

const href = (task: DashboardTask) => `/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`;
export function NeoTaskAttention({tasks, userId, isLoading, error, projectTaskStatus}: NeoReviewRequestsProps) {
  if (!userId) return null;
  const available = projectTaskStatus ? tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready') : isLoading || error ? [] : tasks;
  const issues = completedParentIssues(available);
  const partial = isLoading || !!error || [...(projectTaskStatus?.values() ?? [])].some(state => state.status !== 'ready');
  if (!issues.length) return null;
  const row = ({parent, children}: typeof issues[number]) => <li key={JSON.stringify([parent.projectId,parent.id])} className="min-w-0 space-y-2">
    <Link prefetch={false} href={href(parent)} className={taskRowInteraction + ' flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-sm font-medium'}>
      <ProjectMark name={parent.projectName} icon={parent.projectIcon} iconUrl={parent.projectIconUrl} color={parent.projectColor} />
      <span className="break-words">{parent.title}</span><span className="text-xs font-normal text-muted-foreground">{parent.projectName} / {parent.listName || 'リスト名未取得'}</span><ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
    </Link>
    <p className="text-xs font-medium text-amber-900">親：完了 ／ サブタスク：未完了 {children.length}件</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1">{children.map(child => <Link prefetch={false} key={child.id} href={href(child)} className="min-w-0 break-words text-xs text-primary underline underline-offset-2">{child.title}</Link>)}</div>
  </li>;
  return <section aria-label="完了状態の確認" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
    <div className="flex items-center gap-2"><TriangleAlert className="size-4 text-amber-700" aria-hidden="true" /><h2 className="text-sm font-semibold">完了状態の確認</h2><span className="text-xs text-muted-foreground">{issues.length}件{partial ? '以上' : ''}</span></div>
    <p className="mt-1 text-xs text-amber-900">親は完了ですが、未完了のサブタスクが残っています。</p>
    {partial && <p className="mt-1 text-xs text-muted-foreground">取得できたプロジェクトを確認しています。</p>}
    <ul className="mt-3 space-y-4">{issues.slice(0,5).map(row)}</ul>
    {issues.length > 5 && <details className="mt-3"><summary className="cursor-pointer text-xs text-primary">ほか{issues.length - 5}件</summary><ul className="mt-3 space-y-4">{issues.slice(5).map(row)}</ul></details>}
  </section>;
}
