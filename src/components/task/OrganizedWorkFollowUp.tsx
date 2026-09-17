"use client";

import Link from 'next/link';
import { taskRowInteraction } from '@/components/ui/density';
import { ArrowUpRight } from 'lucide-react';
import type { Task } from '@/types';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';

type Work = Pick<Task, 'id' | 'title'> & Partial<Task>;
export function organizedOpenWork(records: OrganizationPreview[], tasks: Work[], projectId?: string) {
  const current = new Map(tasks.filter(task => task.isCompleted === false && !task.isArchived && !task.isAbandoned).map(task => [JSON.stringify([task.projectId ?? projectId, task.id]), task]));
  const seen = new Set<string>();
  return [...records].filter(record => record.status === 'applied').sort((a,b) => b.createdAt.localeCompare(a.createdAt)).flatMap(record => record.changes.flatMap(change => {
    const key = JSON.stringify([record.projectId, change.taskId]);
    const task = current.get(key);
    if (!task || seen.has(key)) return [];
    seen.add(key);
    return [{ ...task, projectId: record.projectId, organizationSource: record.sourceTitle, organizationChange: change.summary }];
  }));
}
export function OrganizedWorkFollowUp({ records, tasks, projects }: { records: OrganizationPreview[]; tasks: Work[]; projects: {id:string;name:string}[] }) {
  const ongoing = organizedOpenWork(records, tasks, projects.length === 1 ? projects[0].id : undefined);
  if (!ongoing.length) return null;
  const row = (task: typeof ongoing[number]) => <li key={JSON.stringify([task.projectId,task.id])}>
    <Link href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`} className={taskRowInteraction + ' flex items-center gap-3 rounded-md px-3 py-1.5'}>
      <span className="shrink-0 text-xs text-muted-foreground">{task.workState?.status === 'hold' ? '保留' : task.workState?.status === 'wait' ? '待ち' : task.workProgress === 'started' ? '着手' : '未着手'}</span>
      <span className="min-w-0 flex-1"><span className="block break-words text-sm">{task.title}</span><span className="block break-words text-xs text-muted-foreground">{task.organizationSource && `資料：${task.organizationSource}`}{task.organizationSource && task.organizationChange && ' · '}{task.organizationChange}</span></span>
      {task.workState?.reviewAt && <span className="shrink-0 text-xs text-amber-800">見直し {task.workState.reviewAt.slice(0,10)}</span>}
      <span className="max-w-[25%] truncate text-xs text-muted-foreground">{projects.find(project=>project.id===task.projectId)?.name}</span>
      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  </li>;
  return <section aria-label="メモから反映した仕事" className="rounded-xl border bg-card p-2">
    <div className="flex items-center gap-2 px-3 py-1"><h3 className="text-sm font-semibold">メモから反映した仕事</h3><span className="text-xs text-muted-foreground">{ongoing.length}件</span></div>
    <p className="px-3 pb-2 text-xs text-muted-foreground">メモの整理案を採用して反映した、未完了の仕事です。</p>
    <ul>{ongoing.slice(0,3).map(row)}</ul>
    {ongoing.length > 3 && <details><summary className="cursor-pointer px-3 py-1 text-xs text-primary">ほか{ongoing.length-3}件</summary><ul>{ongoing.slice(3).map(row)}</ul></details>}
  </section>;
}
