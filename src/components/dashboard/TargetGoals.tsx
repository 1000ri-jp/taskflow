'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Plus, SlidersHorizontal, Trash2, UserRound, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DashboardTask } from '@/lib/dashboard/brief';
import {
  TARGET_GOAL_CRITERIA,
  type TargetGoal,
  type TargetGoalCriterion,
  type TargetGoalUnit,
  useTargetGoalStore,
} from '@/stores/targetGoalStore';
import { cn } from '@/lib/utils';

const MAX_GOAL_COUNT = 20;

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newUnit(index: number): TargetGoalUnit {
  return { id: newId('unit'), label: `${index + 1}人目`, projectId: null, taskId: null };
}

function newGoal(): TargetGoal {
  return {
    id: newId('goal'),
    title: 'ココナラモニター獲得',
    targetCount: 3,
    criterion: 'order_received',
    units: [newUnit(0), newUnit(1), newUnit(2)],
  };
}

function taskValue(projectId: string | null, taskId: string | null): string {
  return projectId && taskId ? JSON.stringify([projectId, taskId]) : '';
}

function parseTaskValue(value: string): { projectId: string; taskId: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { projectId: parsed[0], taskId: parsed[1] };
    }
  } catch {
    // An empty selection is safer than retaining malformed browser state.
  }
  return null;
}

function resizeUnits(units: TargetGoalUnit[], count: number): TargetGoalUnit[] {
  return Array.from({ length: count }, (_, index) => units[index] ?? newUnit(index));
}

function GoalEditor({
  goal,
  tasks,
  tasksLoading,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: {
  goal: TargetGoal;
  tasks: DashboardTask[];
  tasksLoading: boolean;
  canDelete: boolean;
  onSave: (goal: TargetGoal) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TargetGoal>(() => ({ ...goal, units: resizeUnits(goal.units, goal.targetCount) }));
  const sortedTasks = useMemo(() => [...tasks]
    .filter((task) => !task.isArchived)
    .sort((a, b) => `${a.projectName}\u0000${a.title}`.localeCompare(`${b.projectName}\u0000${b.title}`, 'ja')), [tasks]);

  const updateUnit = (index: number, changes: Partial<TargetGoalUnit>) => {
    setDraft((current) => ({ ...current, units: current.units.map((unit, unitIndex) => unitIndex === index ? { ...unit, ...changes } : unit) }));
  };

  return (
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>達成目標を設定</DialogTitle>
        <DialogDescription>人数枠ごとに、達成条件を表すタスクを別プロジェクトから紐づけます。元のタスクは変更しません。</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">目標名</span>
          <Input aria-label="目標名" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={160} />
        </label>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">達成条件</span>
            <select
              aria-label="達成条件"
              className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              value={draft.criterion}
              onChange={(event) => setDraft((current) => ({ ...current, criterion: event.target.value as TargetGoalCriterion }))}
            >
              {TARGET_GOAL_CRITERIA.map((criterion) => <option key={criterion.value} value={criterion.value}>{criterion.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">目標人数</span>
            <Input aria-label="目標人数" type="number" min={1} max={MAX_GOAL_COUNT} value={draft.targetCount}
              onChange={(event) => {
                const nextCount = Math.min(MAX_GOAL_COUNT, Math.max(1, Number(event.target.value) || 1));
                setDraft((current) => ({ ...current, targetCount: nextCount, units: resizeUnits(current.units, nextCount) }));
              }} />
          </label>
        </div>

        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">人数ごとの達成タスク</p>
            <p className="mt-1 text-xs text-muted-foreground">選択したタスクが完了すると、その人数を達成として数えます。</p>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            {draft.units.map((unit, index) => (
              <div key={unit.id} className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-center">
                <Input aria-label={`${index + 1}人目の表示名`} value={unit.label} maxLength={100}
                  onChange={(event) => updateUnit(index, { label: event.target.value })} placeholder={`${index + 1}人目`} />
                <select
                  aria-label={`${unit.label || `${index + 1}人目`}の達成タスク`}
                  className="border-input h-9 min-w-0 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  value={taskValue(unit.projectId, unit.taskId)}
                  onChange={(event) => {
                    const selected = parseTaskValue(event.target.value);
                    updateUnit(index, { projectId: selected?.projectId ?? null, taskId: selected?.taskId ?? null });
                  }}
                  disabled={tasksLoading}
                >
                  <option value="">達成タスクを選択…</option>
                  {sortedTasks.map((task) => <option key={`${task.projectId}/${task.id}`} value={taskValue(task.projectId, task.id)}>{task.projectName} ／ {task.title}</option>)}
                </select>
              </div>
            ))}
          </div>
          {tasksLoading && <p role="status" className="text-xs text-muted-foreground">タスクを読み込み中…</p>}
          {!tasksLoading && tasks.length === 0 && <p className="text-xs text-amber-700">選択できるタスクがありません。プロジェクトのタスクを読み込んでから設定してください。</p>}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {canDelete && <Button type="button" variant="ghost" className="text-rose-700 hover:text-rose-800 sm:mr-auto" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" />この目標を削除</Button>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>キャンセル</Button>
          <Button type="button" onClick={() => onSave({ ...draft, title: draft.title.trim() || '達成目標', units: resizeUnits(draft.units, draft.targetCount) })}>保存</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function GoalPerson({ unit, task }: { unit: TargetGoalUnit; task?: DashboardTask }) {
  const completed = Boolean(task?.isCompleted && !task.isAbandoned);
  const unavailable = Boolean(unit.projectId && unit.taskId);
  const statusLabel = task
    ? `${unit.label}：${completed ? '達成' : '未達成'}、${task.title}（${task.projectName}）`
    : `${unit.label}：未達成、${unavailable ? '紐づけたタスクを現在表示できません' : '達成タスク未設定'}`;
  const personClassName = cn(
    'relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
    completed && 'border-violet-600 bg-violet-600 text-white shadow-sm',
    task && !completed && 'border-violet-200 bg-violet-50 text-violet-400 hover:bg-violet-100',
    !task && 'border-dashed border-slate-300 bg-slate-50 text-slate-300',
  );
  const personIcon = <>
    <UserRound aria-hidden="true" className="h-4 w-4" strokeWidth={2.2} />
    {completed && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white">
      <Check className="h-2 w-2" strokeWidth={3} />
    </span>}
  </>;

  return <li>
    {task ? <Link
      href={`/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`}
      aria-label={statusLabel}
      title={statusLabel}
      className={cn(personClassName, 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600')}
    >
      {personIcon}
    </Link> : <span role="img" aria-label={statusLabel} title={statusLabel} className={personClassName}>{personIcon}</span>}
  </li>;
}

export function TargetGoals({ tasks, tasksLoading, tasksError }: { tasks: DashboardTask[]; tasksLoading: boolean; tasksError: Error | null }) {
  const { goals, hydrate, save, remove, persistenceFailed } = useTargetGoalStore();
  const [editingGoal, setEditingGoal] = useState<TargetGoal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => { hydrate(); }, [hydrate]);

  const openNew = () => { setEditingGoal(newGoal()); setDialogOpen(true); };
  const openEdit = (goal: TargetGoal) => { setEditingGoal(goal); setDialogOpen(true); };
  const closeEditor = () => { setDialogOpen(false); setEditingGoal(null); };
  const taskMap = useMemo(() => new Map(tasks.map((task) => [`${task.projectId}/${task.id}`, task])), [tasks]);

  return <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm" aria-labelledby="target-goals-heading">
    <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <UsersRound aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <h2 id="target-goals-heading" className="font-semibold tracking-tight">達成目標</h2>
        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">人数カウント</span>
      </div>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 self-start sm:self-auto" onClick={openNew}><Plus className="h-3.5 w-3.5" />目標を追加</Button>
    </div>
    <p className="border-b bg-violet-50/60 px-5 py-2 text-xs text-violet-900">別プロジェクトのタスクを人数枠に紐づけ、進捗を数えます。</p>
    <div className="space-y-3 bg-white px-4 py-4 sm:px-5">
      {persistenceFailed && <p role="alert" className="text-xs text-amber-700">ブラウザに保存できませんでした。表示中の設定はこの画面の間だけ有効です。</p>}
      {tasksError && <p className="text-xs text-rose-700">一部のタスクを取得できないため、紐づけ先が表示できない場合があります。</p>}
      {goals.length === 0 ? <p className="rounded-lg border border-dashed bg-white px-4 py-5 text-center text-sm text-muted-foreground">目標はまだありません。「目標を追加」から、例えばモニター3人の目標を作れます。</p> : <div className="grid gap-3 lg:grid-cols-2">
        {goals.map((goal) => {
          const units = resizeUnits(goal.units, goal.targetCount);
          const completedCount = units.filter((unit) => unit.projectId && unit.taskId && taskMap.get(`${unit.projectId}/${unit.taskId}`)?.isCompleted && !taskMap.get(`${unit.projectId}/${unit.taskId}`)?.isAbandoned).length;
          return <article key={goal.id} className="rounded-lg border bg-white p-4" aria-label={`${goal.title}の進捗`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <h3 className="min-w-0 break-words font-semibold">{goal.title}</h3>
                <ul className="flex flex-wrap items-center gap-1.5" aria-label={`${goal.title}：${goal.targetCount}人中${completedCount}人達成`}>
                  {units.map((unit) => <GoalPerson key={unit.id} unit={unit} task={unit.projectId && unit.taskId ? taskMap.get(`${unit.projectId}/${unit.taskId}`) : undefined} />)}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-2"><span className="text-lg font-semibold tabular-nums text-violet-700">{completedCount}/{goal.targetCount}</span><Button variant="ghost" size="icon-sm" aria-label={`${goal.title}を編集`} onClick={() => openEdit(goal)}><SlidersHorizontal className="h-4 w-4" /></Button></div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100" aria-label={`${completedCount}/${goal.targetCount}達成`}><div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: `${Math.min(100, completedCount / goal.targetCount * 100)}%` }} /></div>
          </article>;
        })}
      </div>}
    </div>
    <Dialog open={dialogOpen} onOpenChange={(next) => { if (next) setDialogOpen(true); else closeEditor(); }}>
      {editingGoal && <GoalEditor goal={editingGoal} tasks={tasks} tasksLoading={tasksLoading} canDelete={goals.some((goal) => goal.id === editingGoal.id)} onSave={(goal) => { save(goal); closeEditor(); }} onDelete={() => { remove(editingGoal.id); closeEditor(); }} onClose={closeEditor} />}
    </Dialog>
  </section>;
}
