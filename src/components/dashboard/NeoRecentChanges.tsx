"use client";
import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { taskRowInteraction } from '@/components/ui/density';
import { ProjectMark } from '@/components/project/ProjectMark';
import { NEO_TASK_LIST_END_CLASS } from './NeoBriefTaskRow';
import { recentChangedTasks, useRecentTaskChanges } from '@/hooks/useRecentTaskChanges';
import { recentChangeText } from '@/lib/task/history/recentChanges';
import type { NeoReviewRequestsProps } from './NeoReviewRequests';

export function NeoRecentChanges({ tasks, userId, isLoading, error, projectTaskStatus }: NeoReviewRequestsProps) {
  const [limit, setLimit] = useState(18);
  const [pageSize, setPageSize] = useState(100);
  const available = projectTaskStatus ? tasks.filter(task => projectTaskStatus.get(task.projectId)?.status === 'ready') : isLoading || error ? [] : tasks;
  const records = useRecentTaskChanges([...new Set(available.map(task => task.projectId))], userId, pageSize);
  const rows = recentChangedTasks(records.changes, available);
  const loading = isLoading || records.isLoading;
  const failed = !!error || records.error || [...(projectTaskStatus?.values() ?? [])].some(state => state.status === 'error');
  return <>
    {failed && <p role="alert" className="px-5 py-3 text-xs text-amber-800">一部の変更を取得できません。取得できた記録を表示しています。</p>}
    {loading && <p role="status" className="px-5 py-3 text-xs text-muted-foreground">変更を読み込み中…</p>}
    <ul className={NEO_TASK_LIST_END_CLASS}>{rows.slice(0,limit).map(({task,entry,parentTitle}) => <li key={JSON.stringify([task.projectId,task.id])}>
      <Link prefetch={false} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}${task.parentTaskId ? '' : '&history=1'}`} className={taskRowInteraction + ' group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-2.5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]'}>
        <ProjectMark name={task.projectName} icon={task.projectIcon} iconUrl={task.projectIconUrl} color={task.projectColor} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="break-words text-sm font-medium">{task.title}</span><span className="text-xs text-muted-foreground">{task.listName || 'リスト名未取得'}</span>{parentTitle && <span className="text-xs text-muted-foreground">{parentTitle}</span>}</div>
        <p className="col-start-2 row-start-2 min-w-0 break-words text-xs leading-relaxed lg:col-start-auto lg:row-start-auto"><span className="text-muted-foreground">{entry.actor} · </span>{recentChangeText(entry)}</p>
        <time className="col-start-2 row-start-3 text-xs tabular-nums text-muted-foreground lg:col-start-auto lg:row-start-auto" dateTime={entry.recordedAt ?? entry.at!}>{format(new Date(entry.recordedAt ?? entry.at!), 'M/d HH:mm')}</time>
        <ArrowUpRight className="col-start-3 row-start-1 size-3.5 text-muted-foreground lg:col-start-auto lg:row-start-auto" aria-hidden="true" />
      </Link>
    </li>)}</ul>
    {!loading && !failed && !rows.length && <p className="px-5 py-6 text-sm text-muted-foreground">記録された変更はありません。</p>}
    {(rows.length > limit || records.more) && <Button variant="ghost" disabled={loading} className="m-2" onClick={() => { setLimit(value => value + 18); if (rows.length <= limit + 18 && records.more) setPageSize(value => value + 100); }}>ほかの更新を見る</Button>}
  </>;
}
