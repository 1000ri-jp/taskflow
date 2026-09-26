'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ArrowRight, ArrowUpRight, CalendarClock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ProjectMark } from '@/components/project/ProjectMark';
import { buildNeoCalendarDays } from '@/lib/dashboard/neo-calendar';
import { scheduledWork, taskHref, type WorkBlock } from '@/lib/dashboard/work-blocks';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { GoogleItem } from '@/lib/google/workspace/types';

export interface DayAgendaProps {
  date: Date | null; onClose: () => void; tasks: readonly DashboardTask[]; events: readonly GoogleItem[];
  blocks: readonly WorkBlock[]; saveBlock: (block: WorkBlock) => void; removeBlock: (id: string) => void;
  onContinue?: (task: DashboardTask) => void; canPlan?: boolean; notice?: string | null;
}

function BlockForm({ task, tasks, date, existing, onSave, onCancel }: { task?: DashboardTask; tasks: readonly DashboardTask[]; date: Date; existing?: WorkBlock; onSave: (block: WorkBlock) => void; onCancel: () => void }) {
  const available = tasks.filter(task => !task.isCompleted && !task.isArchived && !task.isAbandoned);
  const key = (task: DashboardTask) => JSON.stringify([task.projectId, task.id]);
  const [chosen, setChosen] = useState(task ? key(task) : '');
  const [start, setStart] = useState(existing ? format(new Date(existing.start), "yyyy-MM-dd'T'HH:mm") : format(date, 'yyyy-MM-dd') + 'T09:00');
  const [end, setEnd] = useState(existing ? format(new Date(existing.end), "yyyy-MM-dd'T'HH:mm") : format(date, 'yyyy-MM-dd') + 'T10:00');
  const [error, setError] = useState('');
  return <form aria-label="作業時間の設定" className="space-y-3 rounded-xl border bg-muted/30 p-4" onSubmit={event => {
    event.preventDefault();
    const selected = available.find(task => key(task) === chosen);
    if (!selected) { setError('作業するタスクを選んでください。'); return; }
    try {
      if (!start || !end || !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())) throw new Error('開始と終了の日時を入力してください。');
      onSave({ id: existing?.id ?? crypto.randomUUID(), projectId: selected.projectId, taskId: selected.id, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    } catch (error) { setError(error instanceof Error ? error.message : '作業時間を保存できませんでした。'); }
  }}>
    <h3 className="text-sm font-semibold">作業時間を決める</h3>
    <p className="text-xs leading-relaxed text-muted-foreground">自分用・このブラウザに保存。タスクの期限やGoogle予定は変わりません。</p>
    <label className="block space-y-1 text-xs">タスク<select aria-label="作業するタスク" className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm" value={chosen} onChange={e => setChosen(e.target.value)} required><option value="">選んでください</option>{available.map(task => <option key={key(task)} value={key(task)}>{task.title} · {task.projectName}</option>)}</select></label>
    <label className="block space-y-1 text-xs">開始<input aria-label="作業の開始" type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm" /></label>
    <label className="block space-y-1 text-xs">終了<input aria-label="作業の終了" type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)} className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm" /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={onCancel}>戻る</Button><Button type="submit" size="sm">作業時間を保存</Button></div>
  </form>;
}

export function agendaTime(event: GoogleItem) {
  if (event.allDay) return '終日';
  const start = new Date(event.at), end = event.end ? new Date(event.end) : null;
  return format(start, 'H:mm') + (end ? '–' + format(end, format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd') ? 'H:mm' : 'M/d H:mm') : '');
}

export function NeoDayAgenda(props: DayAgendaProps) {
  return <Sheet open={!!props.date} onOpenChange={open => { if (!open) props.onClose(); }}>
    <SheetContent className="w-full gap-0 sm:max-w-[480px]" aria-describedby="neo-day-description">
      <SheetHeader className="border-b px-6 py-5 pr-12"><SheetTitle>{props.date ? format(props.date, 'M月d日（EEEE）', { locale: ja }) : '一日の予定'}</SheetTitle><SheetDescription id="neo-day-description">予定・作業時間・タスクの期限</SheetDescription></SheetHeader>
      {props.date && <AgendaContent key={format(props.date, 'yyyy-MM-dd')} {...props} date={props.date} />}
    </SheetContent>
  </Sheet>;
}

function AgendaContent({ date, tasks, events, blocks, saveBlock, removeBlock, onContinue, canPlan, notice }: DayAgendaProps & { date: Date }) {
  const [editing, setEditing] = useState<{ task?: DashboardTask; block?: WorkBlock } | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const work = scheduledWork(tasks, blocks);
  const day = buildNeoCalendarDays(tasks, [...events, ...work.map(item => item.event)], date, 1)[0];
  const taskActions = (task: DashboardTask) => <div className="mt-2 flex flex-wrap gap-2">
    <Button size="sm" variant="outline" asChild><Link href={taskHref(task)}>詳細<ArrowUpRight className="size-3.5" /></Link></Button>
    {onContinue && <Button size="sm" variant="ghost" onClick={() => onContinue(task)}>タスクの続きへ<ArrowRight className="size-3.5" /></Button>}
  </div>;
  return <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
    {notice && <p role="status" className="text-xs leading-relaxed text-amber-800">{notice}</p>}
    {receipt && <p role="status" className="text-xs text-emerald-800">{receipt}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {editing ? <BlockForm task={editing.task} tasks={tasks} date={date} existing={editing.block} onCancel={() => setEditing(null)} onSave={block => { saveBlock(block); setEditing(null); setReceipt('作業時間を保存しました。'); setError(''); }} />
      : canPlan && <Button size="sm" variant="outline" onClick={() => { setEditing({}); setReceipt(''); }}><Plus className="size-4" />作業時間を追加</Button>}
    <section aria-label="この日の予定と作業"><h3 className="mb-3 text-xs font-semibold text-muted-foreground">予定・作業時間</h3>
      {day.events.length ? <ul className="space-y-3">{day.events.map(event => {
        const reservation = work.find(item => item.event.id === event.id);
        return <li key={event.id} className="border-b pb-3 last:border-b-0">
          <p className="mb-1 text-xs tabular-nums text-muted-foreground">{agendaTime(event)}{reservation ? ' · 作業時間' : ''}</p>
          <p className="break-words text-sm font-medium leading-relaxed">{event.title}</p>
          {reservation ? <>{taskActions(reservation.task)}{canPlan && <div className="mt-2 flex gap-3 text-xs"><button type="button" className="underline" onClick={() => { setEditing({ task: reservation.task, block: reservation.block }); setReceipt(''); }}>時間を変更</button><button type="button" className="text-muted-foreground underline" onClick={() => { try { removeBlock(reservation.block.id); setReceipt('作業時間を取り消しました。'); setError(''); } catch (error) { setError(error instanceof Error ? error.message : '取り消せませんでした。'); } }}>作業時間を取り消す</button></div>}</>
            : event.url && <a href={event.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline">予定の詳細<ArrowUpRight className="size-3" /></a>}
        </li>;
      })}</ul> : <p className="text-sm text-muted-foreground">この日に表示できる予定・作業時間はありません。</p>}
    </section>
    <section aria-label="この日の期限"><h3 className="mb-3 text-xs font-semibold text-muted-foreground">この日が期限 · {day.tasks.length}件</h3>
      <ul className="space-y-3">{day.tasks.map(task => <li key={task.projectId + '/' + task.id} className="rounded-xl border p-4">
        <div className="flex items-start gap-2"><ProjectMark name={task.projectName} color={task.projectColor} /><p className="min-w-0 break-words text-sm font-medium leading-relaxed">{task.title}</p></div>
        {taskActions(task)}
        {canPlan && <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-primary" onClick={() => { setEditing({ task }); setReceipt(''); }}><CalendarClock className="size-3.5" />作業時間を決める</button>}
      </li>)}</ul>
      {!day.tasks.length && <p className="text-sm text-muted-foreground">この日が期限のタスクはありません。</p>}
    </section>
  </div>;
}
