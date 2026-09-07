'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { sourceCommentHref } from '@/lib/task/commentSubmission';
import { assigneeLabel, taskReviewState } from '@/lib/board/taskViews';
import { TaskFlowStateBadge } from '@/components/board/TaskViewFields';
import type { Task } from '@/types';

export function TaskRelations({ task, tasks, names }: { task: Task; tasks: Task[]; names: Record<string, string> }) {
  const parent = tasks.find(item => item.id === task.parentTaskId);
  const children = tasks.filter(item => item.parentTaskId === task.id && !item.isArchived);
  if (!task.parentTaskId && !children.length) return null;
  return <section aria-label="親タスクと確認依頼" className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
    {task.parentTaskId && <div className="space-y-1">
      <p className="font-medium">共有の確認依頼</p>
      <Link className="block text-xs text-blue-600 hover:underline" href={`/projects/${task.projectId}/board?task=${task.parentTaskId}`}>親タスク：{parent?.title ?? '親タスクを開く'}</Link>
      {task.sourceCommentId && <Link className="inline-block text-xs text-blue-600 hover:underline" href={sourceCommentHref(task.projectId, task.parentTaskId, task.sourceCommentId)}>元コメントを開く</Link>}
      <p className="text-xs text-muted-foreground">依頼先全員に共通のタスクです。完了は親タスクとは別に管理します。</p>
    </div>}
    {children.length > 0 && <div className="space-y-2">
      <h3 className="font-medium">確認依頼・子タスク（{children.length}件）</h3>
      {children.map(child => {
        const reviewState = taskReviewState(child, tasks);
        return <Link key={child.id} href={`/projects/${task.projectId}/board?task=${child.id}`} className="block rounded bg-background p-2 hover:bg-muted">
          <span className="flex flex-wrap items-center gap-2 break-words">{reviewState && <TaskFlowStateBadge label={reviewState.label} completed={reviewState.completed} />}<span>{child.isCompleted ? '✓ 完了 ' : '○ 未完了 '}{child.title}</span></span>
          <span className="mt-1 block text-xs text-muted-foreground">{assigneeLabel(child.assigneeIds, names)} · {child.dueDate ? `期限 ${format(child.dueDate, 'yyyy/M/d')}` : '期限なし'}</span>
        </Link>;
      })}
    </div>}
  </section>;
}
