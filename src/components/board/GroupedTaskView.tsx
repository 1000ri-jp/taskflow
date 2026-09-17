"use client";
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { taskSituation } from '@/lib/task/history/presentation';
import { taskRowInteraction } from '@/components/ui/density';
import type { Milestone, Task } from '@/types';
export function GroupedTaskView({ tasks, allTasks, milestones, groupBy, onTaskClick }: { tasks: Task[]; allTasks: Task[]; milestones: Milestone[]; groupBy: 'stage'|'assignee'|'purpose'; onTaskClick: (id: string) => void }) {
  const people = useMeetingMembers([{ memberIds: [...new Set(tasks.flatMap(t => t.assigneeIds))] }], true);
  const names = Object.fromEntries(people.users.map(p => [p.id, p.displayName]));
  const groups = new Map<string, { label: string; tasks: Task[] }>();
  for (const task of tasks) {
    const state = taskSituation(task, allTasks, names, []);
    const purposes = [...new Set([...(task.milestoneId ? [task.milestoneId] : []), ...milestones.filter(m => m.requiredTaskIds?.includes(task.id)).map(m => m.id)])];
    const keys = groupBy === 'assignee' ? task.assigneeIds.length ? task.assigneeIds : ['__none__']
      : groupBy === 'purpose' ? purposes.length ? purposes : ['__none__']
      : [state.situation.replace(/（.*）/, '')];
    for (const key of new Set(keys)) {
      const label = groupBy === 'assignee' ? key === '__none__' ? '担当未設定' : names[key] ?? '担当者名は未取得'
        : groupBy === 'purpose' ? key === '__none__' ? 'プロジェクト共通' : milestones.find(m => m.id === key)?.title ?? '節目は未取得' : key;
      if (!groups.has(key)) groups.set(key, { label, tasks: [] });
      groups.get(key)!.tasks.push(task);
    }
  }
  return <div className="grid gap-4 p-3 md:grid-cols-2 xl:grid-cols-3">
    {!tasks.length && <p className="text-sm text-muted-foreground">該当する仕事はありません。</p>}
    {[...groups].map(([id, group]) => <section key={id} className="min-w-0 rounded border bg-background"><h3 className="border-b px-3 py-2 text-sm font-medium">{group.label} <span className="text-xs text-muted-foreground">{group.tasks.length}件</span></h3><div className="divide-y">{group.tasks.map(task => { const state = taskSituation(task, allTasks, names, []); return <button key={task.id} type="button" className={taskRowInteraction + ' block w-full space-y-1 p-3 text-left'} onClick={() => onTaskClick(task.id)}><p className="text-sm font-medium break-words">{task.title}</p><p className="text-xs text-muted-foreground break-words">{state.situation} · {state.next}</p>{task.completionCriteria && <p className="text-xs break-words">完了条件：{task.completionCriteria}</p>}</button>; })}</div></section>)}
  </div>;
}
