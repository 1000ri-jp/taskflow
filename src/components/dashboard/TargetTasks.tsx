'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format, isValid, startOfDay } from 'date-fns';
import { Ban, CheckCircle2, Circle, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';
import { useTargetTaskStore } from '@/stores/targetTaskStore';

const EMPTY_IDS: string[] = [];
function TaskStatus({ task }: { task: DashboardTask }) {
  const overdue = !task.isCompleted && !task.isAbandoned && task.dueDate && isValid(task.dueDate) && startOfDay(task.dueDate) < startOfDay(new Date());
  return <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
    <span className={cn('text-muted-foreground', overdue && 'font-semibold text-rose-700')}>{task.dueDate && isValid(task.dueDate) ? `期限 ${format(task.dueDate, 'yyyy.M.d')}${overdue ? '・期限超過' : ''}` : '期限なし'}</span>
    <span className={task.isAbandoned ? 'text-muted-foreground' : task.isCompleted ? 'text-emerald-700' : 'text-muted-foreground'}>{task.isAbandoned ? '中止' : task.isCompleted ? `完了${task.completedAt && isValid(task.completedAt) ? ` ${format(task.completedAt, 'M/d')}` : ''}` : '未完了'}</span>
  </span>;
}

export function TargetTasks({ project, month, tasks, isLoading, error }: {
  project: Pick<Project, 'id' | 'name'>;
  month: string;
  tasks: DashboardTask[];
  isLoading: boolean;
  error: Error | null;
}) {
  const { selections, save } = useTargetTaskStore();
  const selectedIds = selections.find((item) => item.month === month && item.projectId === project.id)?.taskIds ?? EMPTY_IDS;
  // Never resolve an ID from another project or retain a cached task title.
  const available = tasks.filter((task) => task.projectId === project.id && !task.isArchived);
  const selected = selectedIds.flatMap((id) => available.find((task) => task.id === id) ?? []);
  const missingCount = selectedIds.length - selected.length;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const candidates = available.filter((task) => (!task.isAbandoned || draft.includes(task.id)) && task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const unavailableDraft = draft.filter((id) => !available.some((task) => task.id === id));

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{selectedIds.length ? isLoading || error ? `${selectedIds.length}件選択中` : `${selected.filter((task) => task.isCompleted && !task.isAbandoned).length} / ${selectedIds.length} 完了` : '的は未選択'}</span>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setDraft([...selectedIds]); setSearch(''); } }}>
        <DialogTrigger asChild><Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" aria-label={`${project.name}の的を選択`}><SlidersHorizontal className="h-3 w-3" />タスクを選択</Button></DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{project.name}の的を選択</DialogTitle><DialogDescription>{month.replace('-', '.')}の目標にするタスクを選んでください。選択だけをこのブラウザに保存し、元のタスクは変更しません。</DialogDescription></DialogHeader>
          <Input aria-label="的にするタスクを検索" placeholder="タスク名で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
          {isLoading ? <p role="status" className="text-sm text-muted-foreground">タスクを読み込み中…</p>
            : error ? <p role="alert" className="text-sm text-rose-700">タスクを取得できませんでした。選択内容は保持しています。</p>
            : <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
              {candidates.length === 0 && <p className="p-3 text-sm text-muted-foreground">選択できるタスクがありません。</p>}
              {candidates.map((task) => <label key={task.id} className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted">
                <Checkbox className="mt-0.5" aria-label={task.title} checked={draft.includes(task.id)} onCheckedChange={(checked) => setDraft((ids) => checked === true ? [...new Set([...ids, task.id])] : ids.filter((id) => id !== task.id))} />
                <span className="min-w-0 space-y-1"><span className="block break-words text-sm font-medium">{task.title}</span><TaskStatus task={task} /></span>
              </label>)}
              {unavailableDraft.length > 0 && <div className="space-y-1 p-2 text-xs text-muted-foreground"><p>現在表示できないタスク：{unavailableDraft.length}件（削除・アーカイブ等）</p><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraft((ids) => ids.filter((id) => !unavailableDraft.includes(id)))}>表示できないタスクを選択から外す</Button></div>}
            </div>}
          <p className="text-xs text-muted-foreground">{draft.length}件選択中。期限のないタスクや完了済みのタスクも選べます。来月の選択は別に保存されます。</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={isLoading || Boolean(error)} onClick={() => setDraft([])}>すべて外す</Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button size="sm" disabled={isLoading || Boolean(error)} onClick={() => { save(month, project.id, draft); setOpen(false); }}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {isLoading ? <p role="status" className="text-xs text-muted-foreground">タスクを読み込み中…</p>
      : error ? <p role="alert" className="text-xs text-rose-700">一部のタスクを取得できませんでした。選択内容は保持しています。</p> : null}
    {!isLoading && selectedIds.length === 0 && <p className="text-xs leading-relaxed text-muted-foreground">「タスクを選択」から今月の的を選んでください。</p>}
    {!isLoading && selected.map((task) => {
      const Icon = task.isAbandoned ? Ban : task.isCompleted ? CheckCircle2 : Circle;
      return <Link key={task.id} href={`/projects/${encodeURIComponent(project.id)}/board?task=${encodeURIComponent(task.id)}`} className="flex items-start gap-2 rounded py-1 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-blue-600">
        <Icon aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground', task.isCompleted && !task.isAbandoned && 'text-emerald-600')} />
        <span className="min-w-0 space-y-1"><span className={cn('block break-words text-sm font-medium', (task.isCompleted || task.isAbandoned) && 'text-muted-foreground line-through')}>{task.title}</span><TaskStatus task={task} /></span>
      </Link>;
    })}
    {!isLoading && !error && missingCount > 0 && <p className="text-xs text-muted-foreground">選択したタスクのうち{missingCount}件は現在表示できません（削除・アーカイブ等）。選択は保持しています。</p>}
  </div>;
}
