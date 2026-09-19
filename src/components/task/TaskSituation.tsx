'use client';
import { STAGE_LABELS } from '@/lib/task/automationTypes';
import { sourceCommentHref } from '@/lib/task/commentSubmission';
import { startOfDay } from 'date-fns';
import { taskSituation } from '@/lib/task/history/presentation';
import { isTaskOverdue } from '@/lib/utils/task';
import { getTaskSubtasks } from '@/lib/task/subtasks';
import type { Task } from '@/types';
export function TaskSituation({ task, tasks, names }: { task: Task; tasks: Task[]; names: Record<string, string> }) {
  const scopedTasks = tasks.filter(item => item.projectId === task.projectId);
  const state = taskSituation(task, scopedTasks, names, []);
  const subtasks = getTaskSubtasks(task, scopedTasks);
  const progress = subtasks.length ? `サブタスク ${subtasks.filter(item => item.isCompleted).length}/${subtasks.length}件完了` : null;
  const affected = tasks.filter(t => !t.isArchived && !t.isAbandoned && !t.isCompleted && t.dependsOnTaskIds.includes(task.id));
  const overdue = !task.isAbandoned && !task.isArchived && isTaskOverdue(task, startOfDay(new Date()));
  return <section aria-label="いまの状況と次の担当" className={`mb-3 rounded-lg border bg-white px-3 py-2 text-sm ${overdue ? 'border-red-200' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-muted-foreground">いま </span><strong className={overdue ? 'font-bold text-red-700' : 'font-medium'}>{state.situation}</strong></p>
      {progress && progress !== state.situation && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
    {task.automation?.merchant && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" aria-label="注文の状況">
      <span className="rounded-full border px-2 py-0.5">{task.automation.merchant}</span>
      {task.automation.stage && <span className="rounded-full bg-muted px-2 py-0.5">{STAGE_LABELS[task.automation.stage]}</span>}
      {task.automation.expectedDate && <span>到着予定 {task.automation.expectedDate}</span>}
      {task.automation.sourceCommentId && <a className="underline" href={sourceCommentHref(task.projectId,task.id,task.automation.sourceCommentId)}>購入報告を見る</a>}
      {['partial','unavailable','conflict','revoked'].includes(task.automation.check) && <span className="text-amber-800">最新の状況は未確認</span>}
    </div>}
    <p className="mt-1 break-words text-xs leading-relaxed"><span className="text-muted-foreground">次に </span>{state.next}</p>
    {overdue && affected.length > 0 && <p className="mt-1 text-xs text-red-700">期限超過 · {affected.map(t => t.title).join('、')}への影響を確認</p>}
    {task.review?.requestedAt && <p className="mt-1 text-xs text-muted-foreground">確認依頼：{new Date(task.review.requestedAt).toLocaleString('ja-JP')} · 返答の記録から表示</p>}
    {task.workState && !task.isCompleted && !task.isAbandoned && !task.isArchived && <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p>{task.workState.reason}</p>
      {task.workState.reviewAt && <p>再確認：{new Date(task.workState.reviewAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} · 条件を確認してから再開</p>}
    </div>}
  </section>;
}
