'use client';
import { format } from 'date-fns';
import { useLatestTaskActivity } from '@/hooks/useLatestTaskActivity';
import { recentChangeText } from '@/lib/task/history/recentChanges';
export function RecentTaskChange({ projectId, taskId, userId, updatedAt }: { projectId: string; taskId: string; userId: string | null; updatedAt: Date }) {
  const { status, entry } = useLatestTaskActivity(projectId, taskId, userId);
  if (status === 'loading') return <span className="text-muted-foreground">変更内容を取得中…</span>;
  if (status === 'error') return <span className="text-amber-800">変更内容を取得できません</span>;
  if (!entry) return <span className="text-muted-foreground">変更内容の記録なし</span>;
  const recordedAt = Date.parse(entry.recordedAt ?? entry.at ?? '');
  const older = !Number.isFinite(recordedAt) || recordedAt < updatedAt.getTime() - 1000;
  return <span className="break-words">
    {older && <span className="text-muted-foreground">直近の変更は記録なし。前回{Number.isFinite(recordedAt) ? `（${format(new Date(recordedAt), 'M/d HH:mm')}）` : ''}： </span>}
    <span className="text-muted-foreground">{entry.actor} · </span>{recentChangeText(entry)}
  </span>;
}
