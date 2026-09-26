'use client';

import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { TASK_STATUSES, taskBlockers, taskStatus, type TaskStatusId } from '@/lib/task/status';
import { completionBlockReason } from '@/lib/task/completion';
import type { WorkflowAction } from '@/lib/task/workflow';
import { Button } from '@/components/ui/button';
import type { Task } from '@/types';

const actions: Partial<Record<TaskStatusId, WorkflowAction>> = { not_started: 'reset', started: 'start', completed: 'complete', archived: 'archive' };

export function TaskStatusControl({ task, tasks, userId, disabled = false, showSuccess = true, showCompleteButton = false }: { task: Task; tasks: Task[]; userId: string; disabled?: boolean; showSuccess?: boolean; showCompleteButton?: boolean }) {
  const flow = useTaskWorkflow(task, userId, 'status');
  const status = taskStatus(task, tasks);
  const blockers = taskBlockers(task, tasks);
  const definition = TASK_STATUSES.find(option => option.id === status)!;
  const cannotProgress = task.isAbandoned || task.taskKind === 'review_request' || blockers.length > 0 || !!task.workState;
  const completionBlocked = showCompleteButton && !task.isCompleted ? completionBlockReason(task, tasks) : null;
  const waitingHint = status === 'waiting' && blockers.length > 0
    ? `前提の完了待ち：${blockers.map(blocker => blocker.task?.title || '前提タスクを確認できません').join('、')}` : null;
  return <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${definition.dot}`} aria-hidden="true" />
      <select title="待機は、未完了の前提タスクがあると自動で設定されます。" aria-label={`${task.title}のステータス`} value={status} disabled={disabled || !userId || flow.locked || task.isArchived}
        className={`h-8 max-w-full rounded-md border bg-white px-2 text-xs ${definition.color}`}
        onChange={event => { const action = actions[event.target.value as TaskStatusId]; if (action) void flow.run(action); }}>
        {TASK_STATUSES.map(option => <option key={option.id} value={option.id}
          disabled={option.id === 'waiting' || option.id !== 'archived' && cannotProgress}>{option.label}</option>)}
      </select>
      {showCompleteButton && !task.isCompleted && !task.isArchived && !task.isAbandoned && task.taskKind !== 'review_request' && <Button size="sm" disabled={disabled || !userId || flow.locked || !!completionBlocked} onClick={() => void flow.run('complete')}>完了</Button>}
      {task.workState && !task.isArchived && !task.isCompleted && !task.parentTaskId && <Button size="sm" variant="outline" disabled={disabled || !userId || flow.locked} onClick={()=>void flow.run('resume')}>保留・待ちを解除</Button>}
      {task.isArchived && <Button size="sm" variant="outline" disabled={disabled || !userId || flow.locked} onClick={() => void flow.run('restore')}>復元</Button>}
      {flow.pending && <Button size="sm" variant="outline" disabled={flow.busy || disabled || !userId} onClick={() => void flow.run(flow.pending!.action)}>同じ操作を再試行</Button>}
    </div>
    {(waitingHint || completionBlocked) && <p className="text-xs text-amber-700">{waitingHint || completionBlocked}</p>}
    {flow.error && <p role="alert" className="text-xs text-destructive">{flow.error}</p>}
    {showSuccess && flow.success && <p role="status" className="text-xs text-emerald-700">{flow.success}</p>}
  </div>;
}
