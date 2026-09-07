'use client';

import Link from 'next/link';
import { format, isValid, startOfDay } from 'date-fns';
import { useEffect, useState } from 'react';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { recommendMonthlyTargets } from '@/lib/dashboard/target-recommendations';
import { cn } from '@/lib/utils';

export function RecommendedTargets({ projectId, tasks, isLoading, error }: {
  projectId: string;
  tasks: DashboardTask[];
  isLoading: boolean;
  error: Error | null;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  const recommendations = recommendMonthlyTargets(tasks, projectId, now);
  if (isLoading) return <p role="status" className="text-xs text-muted-foreground">おすすめを読み込み中…</p>;
  return <div className="space-y-3">
    {error && <p role="alert" className="text-xs text-rose-700">一部のタスクを取得できませんでした。取得できた範囲の候補を表示しています。</p>}
    {!error && recommendations.length === 0 && <p className="text-xs text-muted-foreground">今月おすすめする未完了タスクはありません。</p>}
    {recommendations.map(({ task, reason, isBlocked }, index) => {
      const due = task.dueDate && isValid(task.dueDate) ? task.dueDate : null;
      const overdue = due && startOfDay(due) < startOfDay(now);
      return <Link key={task.id} href={`/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(task.id)}`} className="flex items-start gap-2 rounded py-1 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-blue-600">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">{index + 1}</span>
        <span className="min-w-0 space-y-1">
          <span className="block break-words text-sm font-medium">{task.title}</span>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className={cn('text-muted-foreground', overdue && 'font-semibold text-rose-700')}>{due ? `期限 ${format(due, 'yyyy.M.d')}` : '期限なし'}</span>
            <span className={cn('break-words text-muted-foreground', isBlocked && 'text-amber-700')}>{reason}</span>
          </span>
        </span>
      </Link>;
    })}
  </div>;
}
