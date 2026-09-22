"use client";
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { taskRowInteraction } from '@/components/ui/density';
import { ActivityLogItem } from '@/components/project/ActivityLogPanel';
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
    <ul className="divide-y pb-4">{rows.slice(0,limit).map(({task,entry,parentTitle,action}) => <li key={JSON.stringify([task.projectId,task.id])}>
      <Link prefetch={false} href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}${task.parentTaskId ? '' : '&history=1'}`} className={taskRowInteraction + ' block px-2'}>
        <ActivityLogItem log={{
          id: entry.id, projectId: task.projectId, targetId: task.id, targetType: 'task', targetName: task.title,
          action: action ?? 'update', userId: '', userName: entry.actor, createdAt: new Date(entry.recordedAt ?? entry.at!),
        }} context={<span className="min-w-0 break-words text-xs text-muted-foreground">{task.projectName} / <span>{task.listName || 'リスト名未取得'}</span>{parentTitle && ` / ${parentTitle}`}</span>}
          details={<p className="min-w-0 break-words text-xs text-muted-foreground">{recentChangeText(entry)}</p>} />
      </Link>
    </li>)}</ul>
    {!loading && !failed && !rows.length && <p className="px-5 py-6 text-sm text-muted-foreground">記録された変更はありません。</p>}
    {(rows.length > limit || records.more) && <Button variant="ghost" disabled={loading} className="m-2" onClick={() => { setLimit(value => value + 18); if (rows.length <= limit + 18 && records.more) setPageSize(value => value + 100); }}>ほかの更新を見る</Button>}
  </>;
}
