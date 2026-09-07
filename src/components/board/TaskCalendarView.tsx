'use client';

import { useRef, useState } from 'react';
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { calendarTaskEntries, type CalendarTaskEntry } from '@/lib/board/taskViews';
import { cn } from '@/lib/utils';
import type { List, Task } from '@/types';

type CalendarDateChange = (task: Task, kind: CalendarTaskEntry['kind'], date: Date) => void | Promise<void>;

export function TaskCalendarView({ tasks, lists, onTaskClick, onDateChange }: { tasks: Task[]; lists: List[]; onTaskClick: (id: string) => void; onDateChange?: CalendarDateChange }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const start = startOfWeek(mode === 'month' ? startOfMonth(anchor) : anchor, { weekStartsOn: 1 });
  const end = endOfWeek(mode === 'month' ? endOfMonth(anchor) : anchor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const { entries, undated } = calendarTaskEntries(tasks);
  const today = new Date();
  const move = (direction: number) => setAnchor(value => mode === 'month' ? addMonths(value, direction) : addWeeks(value, direction));
  return <section aria-label="タスクカレンダー" className="space-y-3 p-3">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={mode === 'month' ? '前の月' : '前の週'} onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="min-w-28 text-center text-sm font-semibold">{mode === 'month' ? format(anchor, 'yyyy年M月') : `${format(start, 'yyyy/M/d')}〜${format(end, 'M/d')}`}</h2>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={mode === 'month' ? '次の月' : '次の週'} onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>今日</Button>
      </div>
      <div role="group" aria-label="カレンダーの表示期間" className="flex gap-1">
        <Button type="button" size="sm" variant={mode === 'month' ? 'default' : 'outline'} aria-pressed={mode === 'month'} onClick={() => setMode('month')}>月</Button>
        <Button type="button" size="sm" variant={mode === 'week' ? 'default' : 'outline'} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>週</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">実データの開始日・期限を表示します（開催日ではありません）。作業期間の重なりはガントチャートで確認できます。</p>
    <div className="overflow-x-auto rounded-lg border bg-background">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs">{['月', '火', '水', '木', '金', '土', '日'].map(day => <div key={day} className="py-2">{day}</div>)}</div>
        <div className="grid grid-cols-7">{days.map(date => {
          const dayEntries = entries.filter(entry => isSameDay(entry.date, date));
          const dateKey = format(date, 'yyyy-MM-dd');
          return <section key={dateKey} aria-label={format(date, 'yyyy年M月d日')} onDragOver={onDateChange ? (event) => { event.preventDefault(); setDragOverDate(dateKey); } : undefined} onDragLeave={onDateChange ? () => setDragOverDate(current => current === dateKey ? null : current) : undefined} onDrop={onDateChange ? (event) => {
            event.preventDefault();
            setDragOverDate(null);
            const raw = event.dataTransfer.getData('application/x-taskflow-calendar') || event.dataTransfer.getData('text/plain');
            if (!raw) return;
            try {
              const payload = JSON.parse(raw) as { taskId?: unknown; kind?: unknown };
              const task = tasks.find(candidate => candidate.id === payload.taskId);
              const kind = payload.kind === '開始' || payload.kind === '期限' || payload.kind === '開始・期限' ? payload.kind : null;
              if (task && kind) void onDateChange(task, kind, startOfDay(date));
            } catch { /* Ignore drops from other sources. */ }
          } : undefined} className={cn('min-w-0 border-r border-b p-2', mode === 'week' ? 'min-h-64' : 'min-h-28', !isSameMonth(date, anchor) && mode === 'month' && 'bg-muted/30', isSameDay(date, today) && 'bg-blue-50/60', dragOverDate === dateKey && 'bg-blue-100/80 ring-2 ring-inset ring-blue-400')}>
            <time dateTime={format(date, 'yyyy-MM-dd')} className={cn('mb-2 block text-xs tabular-nums', isSameDay(date, today) && 'font-bold text-blue-700')}>{format(date, mode === 'week' ? 'M/d' : 'd')}{isSameDay(date, today) && ' 今日'}</time>
            <div className="space-y-1">{dayEntries.slice(0, 3).map(entry => <CalendarEntry key={entry.key} entry={entry} lists={lists} onTaskClick={onTaskClick} onDateChange={onDateChange} />)}</div>
            {dayEntries.length > 3 && <details className="mt-1"><summary className="cursor-pointer text-xs text-blue-600">他{dayEntries.length - 3}件</summary><div className="mt-1 space-y-1">{dayEntries.slice(3).map(entry => <CalendarEntry key={entry.key} entry={entry} lists={lists} onTaskClick={onTaskClick} onDateChange={onDateChange} />)}</div></details>}
          </section>;
        })}</div>
      </div>
    </div>
    {!entries.some(entry => entry.date >= start && entry.date <= end) && <p className="text-sm text-muted-foreground">この期間に開始日・期限のあるタスクはありません。</p>}
    <details className="rounded-lg border bg-background p-3">
      <summary className="cursor-pointer text-sm">日付未設定（{undated.length}件）</summary>
      <div className="mt-2 space-y-2">{undated.map(task => <button key={task.id} type="button" className="block text-left text-sm hover:underline" onClick={() => onTaskClick(task.id)}>{task.title}<span className="ml-2 text-xs text-muted-foreground">{lists.find(list => list.id === task.listId)?.name ?? '分類不明'} · {task.isCompleted ? '完了' : '未完了'}</span></button>)}
        {!undated.length && <p className="text-xs text-muted-foreground">日付未設定のタスクはありません。</p>}
      </div>
    </details>
  </section>;
}

function CalendarEntry({ entry, lists, onTaskClick, onDateChange }: { entry: CalendarTaskEntry; lists: List[]; onTaskClick: (id: string) => void; onDateChange?: CalendarDateChange }) {
  const list = lists.find(list => list.id === entry.task.listId);
  const draggedRef = useRef(false);
  const handleClick = () => {
    // Browsers may dispatch a synthetic click after HTML5 drag-and-drop.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onTaskClick(entry.task.id);
  };
  return <button type="button" draggable={!!onDateChange} onDragStart={onDateChange ? (event) => { draggedRef.current = true; event.dataTransfer.effectAllowed = 'move'; const payload = JSON.stringify({ taskId: entry.task.id, kind: entry.kind }); event.dataTransfer.setData('application/x-taskflow-calendar', payload); event.dataTransfer.setData('text/plain', payload); } : undefined} className={cn('block w-full rounded border-l-4 bg-muted/60 px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', entry.task.isCompleted && 'text-muted-foreground')}
    style={{ borderLeftColor: list?.color ?? '#94a3b8' }} title={`${entry.task.title} · ${list?.name ?? '分類不明'} · ${entry.kind} ${format(entry.date, 'yyyy/M/d')}`}
    onClick={handleClick}>
    <span className="block text-[10px] text-muted-foreground">{entry.kind}{entry.task.isCompleted ? ' · 完了' : ''}</span>
    <span className="block break-words leading-snug">{entry.task.title}</span>
  </button>;
}
