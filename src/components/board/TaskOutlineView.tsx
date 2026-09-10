'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTaskChecklists } from '@/lib/firebase/firestore';
import { sortedChecklistItems } from '@/lib/utils/checklist';
import { assigneeLabel, groupTaskOutline, taskReviewState } from '@/lib/board/taskViews';
import { CHECKLIST_ASSIGNEE_STORAGE_KEY, checklistAssigneeKey, useChecklistAssigneeStore } from '@/stores/checklistAssigneeStore';
import { TaskAssignees, TaskDate, TaskFlowStateBadge, TaskPriority, TaskStatus, type TaskViewMember } from './TaskViewFields';
import { cn } from '@/lib/utils';
import type { List, Task } from '@/types';

interface Props { projectId: string; viewerId: string; tasks: Task[]; lists: List[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; onTaskClick: (id: string) => void }
export function TaskOutlineView({ tasks, lists, ...props }: Props) {
  const groups = groupTaskOutline(tasks, lists, 'due-asc');
  return <section aria-label="計画リスト" className="space-y-3 p-3">
    <p className="text-xs text-muted-foreground">現在の列を分類として縦に表示し、期限が早い順に並べています。タスク左の矢印でチェックリストを展開し、タスク名から詳細を開けます。</p>
    {!tasks.length && <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">表示条件に合うタスクはありません。</p>}
    {groups.filter(group => group.tasks.length).map(group => <details key={group.id} open className="rounded-lg border bg-background">
      <summary className="cursor-pointer rounded-t-lg bg-muted/40 px-4 py-3 text-sm font-semibold">
        <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} /> {group.name}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{group.tasks.length}件 · 完了 {group.tasks.filter(task => task.isCompleted).length}件</span>
      </summary>
      <div className="hidden grid-cols-[minmax(240px,1fr)_75px_150px_105px_55px] gap-3 border-t px-4 py-2 text-xs text-muted-foreground lg:grid" aria-hidden="true">
        <span>タスク／チェックリスト</span><span>状態</span><span>担当者</span><span>期限</span><span>優先度</span>
      </div>
      <div className="divide-y">{group.tasks.filter(task => !task.parentTaskId || !group.tasks.some(parent => parent.id === task.parentTaskId)).map(task => <OutlineTask key={task.id} task={task} siblings={group.tasks} ancestors={[]} {...props} />)}</div>
    </details>)}
  </section>;
}

function OutlineTask({ task, siblings, ancestors, projectId, viewerId, names, members, onTaskClick }: Omit<Props, 'tasks' | 'lists'> & { task: Task; siblings: Task[]; ancestors: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const children = siblings.filter(child => child.parentTaskId === task.id && child.id !== task.id && !ancestors.includes(child.id));
  const reviewState = taskReviewState(task, siblings);
  return <div>
    <div className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(240px,1fr)_75px_150px_105px_55px] lg:items-center lg:gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${task.title}のチェックリストを${expanded ? '折りたたむ' : '展開'}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
          <button type="button" className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onTaskClick(task.id)}>{task.title}</button>
          {reviewState && <TaskFlowStateBadge label={reviewState.label} completed={reviewState.completed} />}
        </div>
      </div>
      <TaskStatus task={task} /><TaskAssignees task={task} names={names} members={members} iconOnly />
      <span><span className="mr-1 text-xs text-muted-foreground lg:hidden">期限</span><TaskDate date={task.dueDate} /></span>
      <span><span className="mr-1 text-xs text-muted-foreground lg:hidden">優先度</span><TaskPriority task={task} /></span>
    </div>
    {expanded && <OutlineChecklists task={task} projectId={projectId} viewerId={viewerId} names={names} />}
    {children.length > 0 && <div className="ml-6 border-l-2 border-blue-100">
      <p className="px-4 pt-2 text-xs text-blue-700">共有の確認依頼・子タスク（{children.length}件）</p>
      {children.map(child => <OutlineTask key={child.id} task={child} siblings={siblings} ancestors={[...ancestors, task.id]} projectId={projectId} viewerId={viewerId} names={names} members={members} onTaskClick={onTaskClick} />)}
    </div>}
  </div>;
}

function OutlineChecklists({ task, projectId, viewerId, names }: { task: Task; projectId: string; viewerId: string; names: Record<string, string> }) {
  const { byItem, hydrate } = useChecklistAssigneeStore();
  useEffect(() => {
    hydrate();
    const sync = (event: StorageEvent) => { if (event.key === CHECKLIST_ASSIGNEE_STORAGE_KEY || event.key === null) hydrate(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [hydrate]);
  const query = useQuery({ queryKey: ['outline-checklists', viewerId, projectId, task.id], queryFn: () => getTaskChecklists(projectId, task.id), staleTime: 0, retry: 1 });
  return <div className="ml-9 mr-4 mb-3 space-y-3 border-l-2 pl-4" aria-label={`${task.title}のチェックリスト`}>
    {query.isPaused ? <p role="status" className="text-xs text-muted-foreground">オフラインのため読み込み待ちです。</p> : query.isError ? <div role="alert" className="text-xs text-destructive">チェックリストを取得できません。<Button type="button" variant="ghost" size="sm" onClick={() => { void query.refetch(); }}>再試行</Button></div> : query.isPending ? <p role="status" className="text-xs text-muted-foreground">チェックリストを読み込み中…</p> : <>
      {!query.data.length && <p className="text-xs text-muted-foreground">チェックリストはありません。詳細画面から追加できます。</p>}
      {[...query.data].sort((a, b) => a.order - b.order).map(checklist => <section key={checklist.id}>
        <h4 className="mb-2 text-xs font-semibold">{checklist.title}<span className="ml-2 font-normal text-muted-foreground">{checklist.items.filter(item => item.isChecked).length}/{checklist.items.length}</span></h4>
        <ul className="space-y-2">{sortedChecklistItems(checklist.items).map(item => {
          const ids = byItem[checklistAssigneeKey([viewerId, projectId, task.id, checklist.id, item.id])] ?? [];
          return <li key={item.id} className="flex items-start gap-2 text-xs">
            {item.isChecked ? <CheckCircle2 aria-label="完了" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Circle aria-label="未完了" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 break-words leading-relaxed">
              <span className={cn('min-w-0 break-words', item.isChecked && 'text-muted-foreground line-through')}>{item.text}</span>
              {ids.length > 0 && <span className="ml-2 text-[11px] text-muted-foreground" title={`担当：${assigneeLabel(ids, names)}（このブラウザ）`}>担当：{assigneeLabel(ids, names)}（このブラウザ）</span>}
            </span>
          </li>;
        })}</ul>
      </section>)}
    </>}
  </div>;
}
