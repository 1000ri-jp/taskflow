'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Circle, CircleCheck, Loader2, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { recalculateDates } from '@/lib/utils/task';
import { replaceTaskCalendarDay, updateMiniTaskSchedule, type MiniTaskSchedulePatch } from '@/lib/task/miniTaskActions';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { Task } from '@/types';

export type MiniTaskFeedback = {
  task: Task;
  action: 'complete' | 'reopen' | 'progress' | 'schedule';
  ok: boolean;
  message: string;
};

export type BriefTaskControls = { progress: ReactNode; schedule: ReactNode; actions: ReactNode };
export type BriefTaskControlsRenderer = (controls: BriefTaskControls) => ReactNode;

type Props = {
  renderControls?: BriefTaskControlsRenderer;
  task: DashboardTask;
  allTasks: readonly DashboardTask[];
  userId: string;
  onFeedback: (feedback: MiniTaskFeedback) => void;
};

type DateField = 'startDate' | 'dueDate';

export function DesktopBriefTaskActions(props: Props) {
  if (props.task.taskKind === 'review_request') return props.renderControls?.({ progress: null, schedule: null, actions: null }) ?? null;
  return <DesktopBriefTaskActionControls {...props} />;
}

function DesktopBriefTaskActionControls({ task, allTasks, userId, onFeedback, renderControls }: Props) {
  const flowAction = useRef<'complete' | 'reopen' | 'progress' | null>(null);
  const reportedError = useRef('');
  const [dateField, setDateField] = useState<DateField>('dueDate');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const flow = useTaskWorkflow(task, userId, 'mini-status', receipt => {
    const action = receipt?.action === 'reopen' ? 'reopen' : flowAction.current === 'progress' ? 'progress' : receipt?.action === 'complete' ? 'complete' : flowAction.current === 'complete' ? 'complete' : 'reopen';
    onFeedback({ task, action, ok: true, message: action === 'complete' ? '完了にしました。' : action === 'reopen' ? '完了を取り消しました。' : '進捗を保存しました。' });
  });

  useEffect(() => {
    if (!flow.error || reportedError.current === flow.error) return;
    reportedError.current = flow.error;
    onFeedback({ task, action: flowAction.current === 'progress' ? 'progress' : flowAction.current === 'complete' ? 'complete' : 'reopen', ok: false, message: flow.error });
  }, [flow.error, onFeedback, task]);

  const runWorkflow = (action: 'complete' | 'reopen' | 'progress') => {
    flowAction.current = action;
    reportedError.current = '';
    void flow.run(action === 'progress' ? (task.workProgress === 'started' ? 'reset' : 'start') : action);
  };

  const saveDate = async (field: DateField, selected: Date | undefined) => {
    if (!selected || scheduleBusy) return;
    const current = field === 'startDate' ? task.startDate : task.dueDate;
    const next = replaceTaskCalendarDay(selected, current);
    if (current?.getTime() === next.getTime()) return;
    const patch: MiniTaskSchedulePatch = field === 'startDate'
      ? { startDate: next }
      : { dueDate: next, durationDays: recalculateDates(task, { dueDate: next }).durationDays, isDueDateFixed: true };
    setScheduleBusy(true);
    try {
      await updateMiniTaskSchedule({ projectId: task.projectId, task, allTasks, patch });
      onFeedback({ task, action: 'schedule', ok: true, message: `${field === 'startDate' ? '開始日' : '期限'}を保存しました。` });
    } catch (error) {
      onFeedback({ task, action: 'schedule', ok: false, message: error instanceof Error ? error.message : '日付を保存できませんでした。' });
    } finally {
      setScheduleBusy(false);
    }
  };

  const dateLabel = (field: DateField) => {
    const date = field === 'startDate' ? task.startDate : task.dueDate;
    return date ? format(date, 'M/d', { locale: ja }) : '—';
  };

  const progress = !task.parentTaskId && <button
        type="button"
        aria-label={`${task.title}の進捗`}
        aria-pressed={task.workProgress === 'started'}
        title={task.workProgress === 'started' ? '未着手に戻す' : '着手にする'}
        disabled={!flow.ready || flow.locked || task.isCompleted || task.isArchived}
        onClick={() => runWorkflow('progress')}
        className="h-6 max-w-14 rounded border border-input bg-background px-1 text-[10px] text-muted-foreground disabled:opacity-50"
      >
        {task.workProgress === 'started' ? '着手' : '未着手'}
      </button>;

  const schedule = <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${task.title}の日付を変更`} title="開始日・期限を変更" className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={scheduleBusy || task.isArchived}>
          <CalendarDays className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-1rem)] p-2">
        <div className="mb-1 flex gap-1" role="tablist" aria-label="変更する日付">
          {(['startDate', 'dueDate'] as const).map(field => <button key={field} type="button" role="tab" aria-selected={dateField === field} className={`rounded px-2 py-1 text-xs ${dateField === field ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} onClick={() => setDateField(field)}>{field === 'startDate' ? `開始 ${dateLabel(field)}` : `期限 ${dateLabel(field)}`}</button>)}
        </div>
        <Calendar
          mode="single"
          selected={dateField === 'startDate' ? task.startDate ?? undefined : task.dueDate ?? undefined}
          defaultMonth={dateField === 'startDate' ? task.startDate ?? task.dueDate ?? new Date() : task.dueDate ?? task.startDate ?? new Date()}
          disabled={dateField === 'startDate' && task.dueDate ? { after: task.dueDate } : dateField === 'dueDate' && task.startDate ? { before: task.startDate } : undefined}
          onSelect={date => void saveDate(dateField, date)}
          className="[--cell-size:--spacing(7)] p-1"
        />
        {scheduleBusy && <p role="status" className="px-1 pb-1 text-xs text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden="true" />保存中…</p>}
      </PopoverContent>
    </Popover>;

  const actions = <div className="flex shrink-0 items-center gap-1" onClick={event => event.stopPropagation()}>
    <button
      type="button"
      role="checkbox"
      aria-checked={task.isCompleted}
      aria-label={`${task.title}を${task.isCompleted ? '未完了に戻す' : '完了にする'}`}
      title={task.isCompleted ? '完了を取り消す' : '完了'}
      disabled={!flow.ready || flow.locked || task.isArchived}
      onClick={() => runWorkflow(task.isCompleted ? 'reopen' : 'complete')}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-50 aria-checked:bg-primary/10 aria-checked:text-primary"
    >
      {flow.busy && flowAction.current !== 'progress' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : task.isCompleted ? <CircleCheck className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
    </button>
    {!renderControls && progress}
    {!renderControls && schedule}
    {(flow.success || flow.error) && <span role={flow.error ? 'alert' : 'status'} className={`sr-only ${flow.error ? 'text-destructive' : 'text-emerald-700'}`}>{flow.error || flow.success}</span>}
    {task.isCompleted && <span className="sr-only"><RotateCcw aria-hidden="true" /></span>}
  </div>;
  return renderControls ? renderControls({ progress, schedule, actions }) : actions;
}
