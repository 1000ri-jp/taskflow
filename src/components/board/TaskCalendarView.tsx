'use client';

import { useRef, useState, type DragEvent } from 'react';
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TaskCreationForm } from '@/components/task/TaskCreationForm';
import { calendarTaskEntries, type CalendarTaskEntry } from '@/lib/board/taskViews';
import { cn } from '@/lib/utils';
import { taskRowInteraction } from '@/components/ui/density';
import { taskRoots } from '@/lib/board/taskHierarchy';
import { TaskAssignees, type TaskViewMember } from './TaskViewFields';
import { TaskQuickPreview } from './TaskQuickPreview';
import type { List, Task, Milestone, Label, Tag } from '@/types';
import { milestonePresentation } from '@/lib/milestones';
import { MOAI_LABEL, MOAI_LABEL_ID } from '@/lib/task/moaiLabel';

type CalendarDateChange = (task: Task, kind: CalendarTaskEntry['kind'], date: Date) => void | Promise<void>;
type CalendarMembers = { labels?: Label[]; tags?: Tag[]; names?: Record<string, string>; members?: Record<string, TaskViewMember> };
type CalendarDragStart = (event: DragEvent<HTMLButtonElement>, task: Task, kind: CalendarTaskEntry['kind']) => void;
const draggableTaskClassName = 'cursor-grab hover:ring-1 hover:ring-inset hover:ring-muted-foreground/50 active:cursor-grabbing';

export function TaskCalendarView({ tasks, allTasks = tasks, milestones = [], onMilestoneClick, selectedListId, lists, labels = [], tags = [], names = {}, members = {}, onTaskClick, onDateChange, onAddTask }: CalendarMembers & { tasks: Task[]; allTasks?: Task[]; milestones?: Milestone[]; selectedListId?: string | null; onMilestoneClick?: (id: string) => void; lists: List[]; onTaskClick: (id: string) => void; onDateChange?: CalendarDateChange; onAddTask?: (listId: string, title: string, dueDate: Date, assigneeIds?: string[]) => void | Promise<void> }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [newTaskDate, setNewTaskDate] = useState<Date | null>(null);
  const [newTaskListId, setNewTaskListId] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [isSavingDate, setIsSavingDate] = useState(false);
  const [dateError, setDateError] = useState('');
  const draggedTask = useRef<{ taskId: string; projectId: string; kind: CalendarTaskEntry['kind']; undated: boolean } | null>(null);
  const suppressClick = useRef(false);
  const savingDate = useRef(false);
  const preferredListId = selectedListId ? lists.find(list => list.id === selectedListId)?.id ?? '' : lists[0]?.id ?? '';
  const start = startOfWeek(mode === 'month' ? startOfMonth(anchor) : anchor, { weekStartsOn: 1 });
  const end = endOfWeek(mode === 'month' ? endOfMonth(anchor) : anchor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const { entries, undated: allUndated } = calendarTaskEntries(tasks);
  const undated = allUndated.filter(task => !task.isCompleted);
  const roots = taskRoots(allTasks);
  const milestoneColors = new Map(milestones.map(milestone => {
    const namedLists = lists.filter(list => list.name.trim() === milestone.title.trim());
    const linkedListIds = new Set(allTasks.filter(task => !task.isArchived && task.milestoneId === milestone.id).map(task => task.listId));
    const list = namedLists.length === 1 ? namedLists[0]
      : namedLists.length === 0 && linkedListIds.size === 1 ? lists.find(list => linkedListIds.has(list.id)) : undefined;
    return [milestone.id, list?.color || '#94a3b8'];
  }));
  const today = new Date();
  const move = (direction: number) => setAnchor(value => mode === 'month' ? addMonths(value, direction) : addWeeks(value, direction));
  const startDrag: CalendarDragStart | undefined = onDateChange && !isSavingDate ? (event, task, kind) => {
    if (savingDate.current || task.isArchived) { event.preventDefault(); return; }
    draggedTask.current = { taskId: task.id, projectId: task.projectId, kind, undated: undated.some(item => item.id === task.id) };
    suppressClick.current = true;
    setDateError('');
    event.dataTransfer.effectAllowed = 'move';
    const payload = JSON.stringify({ taskId: task.id, kind });
    event.dataTransfer.setData('application/x-taskflow-calendar', payload);
    event.dataTransfer.setData('text/plain', payload);
  } : undefined;
  return <section aria-label="タスクカレンダー" className="space-y-3 p-3"
    onPointerDownCapture={() => { suppressClick.current = false; }}
    onKeyDownCapture={() => { suppressClick.current = false; }}
    onClickCapture={event => {
      // Suppress a drag's synthetic click, but a fresh pointer/key action opens normally.
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    }}
    onDragEnd={() => { draggedTask.current = null; setDragOverDate(null); }}>
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
    <p className="text-xs text-muted-foreground">実データの開始日・期限を表示します（開催日ではありません）。作業期間の重なりはガントチャートで確認できます。日付をクリックすると、その日を期限にしたタスク追加ポップアップが開きます。</p>
    {isSavingDate && <p role="status" className="text-xs text-muted-foreground">日付を保存中…</p>}
    {dateError && <p role="alert" className="text-xs text-destructive">{dateError}</p>}
    <div className="overflow-x-auto rounded-lg border bg-white">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 border-b bg-white text-center text-xs">{['月', '火', '水', '木', '金', '土', '日'].map(day => <div key={day} className="py-2">{day}</div>)}</div>
        <div className="grid grid-cols-7">{days.map(date => {
          const dayEntries = entries.filter(entry => isSameDay(entry.date, date));
          const dateKey = format(date, 'yyyy-MM-dd');
          const groups = new Map<string, CalendarTaskEntry[]>();
          dayEntries.forEach(entry => { const id = roots.get(entry.task.id)?.id ?? entry.task.id; groups.set(id, [...(groups.get(id) ?? []), entry]); });
          const dayGroups = [...groups.values()];
          const renderGroup = (items: CalendarTaskEntry[]) => <CalendarFamily key={items[0].key} entries={items} root={roots.get(items[0].task.id)} lists={lists} allTasks={allTasks} labels={labels} tags={tags} names={names} members={members} onTaskClick={onTaskClick} onDragStart={startDrag} />;
          return <section key={dateKey} aria-label={format(date, 'yyyy年M月d日')} onClick={onAddTask ? (event) => { if ((event.target as HTMLElement).closest('button, a, input, select, textarea, summary')) return; setNewTaskDate(startOfDay(date)); setNewTaskListId(preferredListId); setIsAddingTask(true); } : undefined} onDragOver={onDateChange ? (event) => { if (!draggedTask.current || savingDate.current) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverDate(dateKey); } : undefined} onDragLeave={onDateChange ? () => setDragOverDate(current => current === dateKey ? null : current) : undefined} onDrop={onDateChange ? async (event) => {
            event.preventDefault();
            setDragOverDate(null);
            const source = draggedTask.current;
            draggedTask.current = null;
            if (!source || savingDate.current) return;
            const raw = event.dataTransfer.getData('application/x-taskflow-calendar') || event.dataTransfer.getData('text/plain');
            if (!raw) return;
            let payload: { taskId?: unknown; kind?: unknown };
            try {
              payload = JSON.parse(raw);
            } catch { return; /* Ignore drops from other sources. */ }
            if (!payload || payload.taskId !== source.taskId || payload.kind !== source.kind) return;
            const task = tasks.find(candidate => candidate.id === source.taskId && candidate.projectId === source.projectId && !candidate.isArchived);
            if (!task || (source.undated && task.isCompleted)) return;
            savingDate.current = true;
            setIsSavingDate(true);
            try { await onDateChange(task, source.kind, startOfDay(date)); }
            catch (error) { setDateError(`日付を保存できませんでした。${error instanceof Error ? error.message : 'もう一度ドラッグしてお試しください。'}`); }
            finally { savingDate.current = false; setIsSavingDate(false); }
          } : undefined} className={cn('min-w-0 border-r border-b bg-white p-2', mode === 'week' ? 'min-h-64' : 'min-h-28', onAddTask && 'cursor-pointer hover:bg-blue-50/40', dragOverDate === dateKey && 'bg-blue-100/80 ring-2 ring-inset ring-blue-400')}>
            <time dateTime={format(date, 'yyyy-MM-dd')} className={cn('mb-2 block text-xs tabular-nums', !isSameMonth(date, anchor) && mode === 'month' && 'text-muted-foreground', isSameDay(date, today) && 'font-bold text-blue-700')}>{format(date, mode === 'week' ? 'M/d' : 'd')}{isSameDay(date, today) && ' 今日'}</time>
            <div className="space-y-1">
              {milestones.filter(item => item.dueDate && isSameDay(item.dueDate, date) && item.status !== 'cancelled').map(item => {
                const detail = [item.description?.trim(), milestonePresentation(item, allTasks).achieved ? '達成' : item.kind === 'date' && milestonePresentation(item, allTasks).label === '日付経過' ? '日付経過' : null].filter(Boolean).join(' · ');
                const color = milestoneColors.get(item.id) ?? '#94a3b8';
                return <button key={item.id} type="button" aria-label={`マイルストーン：${item.title}`} className="block w-full rounded-sm border border-solid px-2 py-1.5 text-left text-xs transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring" style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 8%, var(--background))` }} onClick={() => onMilestoneClick?.(item.id)}>
                  <span className="mb-1 flex items-start gap-1 text-[10px] text-muted-foreground"><span className="shrink-0 text-xs leading-none" aria-hidden="true">🚩</span><span className="min-w-0 break-words">{detail || 'マイルストーン'}</span></span>
                  <span className="line-clamp-2 break-words font-normal leading-snug">{item.title}</span>
                </button>;
              })}
              {dayGroups.slice(0, 3).map(renderGroup)}
            </div>
            {dayGroups.length > 3 && <details className="mt-1"><summary className="cursor-pointer text-xs text-blue-600">他{dayGroups.length - 3}件</summary><div className="mt-1 space-y-1">{dayGroups.slice(3).map(renderGroup)}</div></details>}
          </section>;
        })}</div>
      </div>
    </div>
    {!entries.some(entry => entry.date >= start && entry.date <= end) && <p className="text-sm text-muted-foreground">この期間に開始日・期限のあるタスクはありません。</p>}
    <Dialog open={isAddingTask && !!newTaskDate && !!onAddTask} onOpenChange={open => { if (!open) setIsAddingTask(false); }}>
      <DialogContent>
        {newTaskDate && <DialogHeader>
          <DialogTitle>{format(newTaskDate, 'yyyy年M月d日')}にタスクを追加（期限）</DialogTitle>
          <DialogDescription>追加先のリストを選び、期限をこの日にしたタスクを作成します。</DialogDescription>
        </DialogHeader>}
        {isAddingTask && newTaskDate && onAddTask && <TaskCreationForm projectId={lists.find(list => list.id === (newTaskListId || preferredListId))?.projectId || tasks[0]?.projectId || ''} listDefaultAssigneeId={lists.find(list => list.id === (newTaskListId || preferredListId))?.defaultAssigneeId} titleLabel="新しいタスクのタイトル" submitLabel="保存" disabled={!(newTaskListId || preferredListId)} onCancel={() => setIsAddingTask(false)} onSubmit={(title, assignees) => onAddTask(newTaskListId || preferredListId, title, newTaskDate, assignees)}><label className="block text-xs">追加先のリスト<select aria-label="追加先のリスト" className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" required value={newTaskListId || preferredListId} onChange={event => setNewTaskListId(event.target.value)}><option value="" disabled>リストを選択</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label></TaskCreationForm>}
      </DialogContent>
    </Dialog>
    {milestones.some(item => !item.dueDate) && <button type="button" className="text-xs text-violet-800 hover:underline" onClick={() => onMilestoneClick?.('__list__')}>期限未設定の節目 {milestones.filter(item => !item.dueDate).length}件を確認</button>}
    <details className="rounded-lg border bg-background p-3">
      <summary className="cursor-pointer text-sm">日付未設定（{undated.length}件）</summary>
      {onDateChange && undated.length > 0 && <p className="mt-2 text-xs text-muted-foreground">上のカレンダーの日へドラッグすると、期限を設定できます。</p>}
      <div className="mt-2 space-y-2">{undated.map(task => <TaskQuickPreview key={task.id} task={task} allTasks={allTasks} lists={lists} names={names}><button type="button" draggable={!!startDrag} onDragStart={startDrag ? event => startDrag(event, task, '期限') : undefined} className={cn(taskRowInteraction, 'block w-full rounded px-1.5 py-0.5 text-left text-sm', startDrag && draggableTaskClassName)} onClick={() => onTaskClick(task.id)}><span className={task.isCompleted ? 'line-through' : undefined}>{task.title || '名称未設定のタスク'}</span>{task.parentTaskId && <span className="ml-1 text-xs text-muted-foreground">（親：{allTasks.find(parent => parent.id === task.parentTaskId)?.title ?? '表示できません'}）</span>}<span className="ml-2 text-xs text-muted-foreground">{lists.find(list => list.id === task.listId)?.name ?? '分類不明'} · {task.isCompleted ? '完了' : '未完了'}</span><CalendarTaskLabels task={task} labels={labels} tags={tags} /></button></TaskQuickPreview>)}
        {!undated.length && <p className="text-xs text-muted-foreground">日付未設定のタスクはありません。</p>}
      </div>
    </details>
  </section>;
}

function CalendarEntry({ entry, allTasks, lists, labels = [], tags = [], names = {}, members, onTaskClick, onDragStart }: CalendarMembers & { entry: CalendarTaskEntry; allTasks: Task[]; lists: List[]; onTaskClick: (id: string) => void; onDragStart?: CalendarDragStart }) {
  const list = lists.find(list => list.id === entry.task.listId);
  const title = entry.task.title || '名称未設定のタスク';
  const completionLabel = entry.task.isCompleted ? '完了' : '未完了';
  const CompletionIcon = entry.task.isCompleted ? Check : Circle;
  const parent = entry.task.parentTaskId ? allTasks.find(task => task.id === entry.task.parentTaskId && task.projectId === entry.task.projectId) : undefined;
  const parentTitle = entry.task.parentTaskId ? parent ? parent.title.trim() || '名称未設定の親タスク' : '親タスクを表示できません' : null;
  return <TaskQuickPreview task={entry.task} allTasks={allTasks} lists={lists} names={names}><button type="button" draggable={!!onDragStart} onDragStart={onDragStart ? event => onDragStart(event, entry.task, entry.kind) : undefined} className={cn(taskRowInteraction, 'block w-full rounded border-l-4 bg-muted/60 px-1.5 py-1 text-left text-xs', entry.task.isCompleted && 'text-muted-foreground', onDragStart && draggableTaskClassName)}
    style={{ borderLeftColor: list?.color ?? '#94a3b8' }} aria-label={`${entry.kind} ${completionLabel} ${title}`}
    onClick={() => onTaskClick(entry.task.id)}>
    <span className="mb-0.5 flex min-h-[18px] items-center justify-between gap-1">
      <span className="flex min-w-0 flex-1 items-center text-[10px] text-muted-foreground">
        {parentTitle && <span className="min-w-0 truncate">{parentTitle}</span>}
        {parentTitle && <span aria-hidden="true" className="shrink-0"> · </span>}
        <span className="shrink-0 whitespace-nowrap">{entry.kind}</span>
        <span aria-hidden="true" className="shrink-0 whitespace-nowrap"> · </span>
        <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium leading-none text-foreground', entry.task.isCompleted ? 'border-muted-foreground/40 bg-muted' : 'border-border bg-background')}>
          <CompletionIcon aria-hidden="true" className="size-2.5" />{completionLabel}
        </span>
      </span>
      <TaskAssignees task={entry.task} names={names} members={members} iconOnly compact maxVisible={5} />
    </span>
    <span className={cn('line-clamp-2 break-words leading-snug', entry.task.isCompleted && 'line-through')}>{title}</span>
    <CalendarTaskLabels task={entry.task} labels={labels} tags={tags} />
  </button></TaskQuickPreview>;
}

function CalendarFamily({ entries, root, ...props }: CalendarMembers & { entries: CalendarTaskEntry[]; root?: Task; allTasks: Task[]; lists: List[]; onTaskClick: (id: string) => void; onDragStart?: CalendarDragStart }) {
  if (entries.length === 1) return <CalendarEntry entry={entries[0]} {...props} />;
  const list = props.lists.find(item => item.id === (root ?? entries[0].task).listId);
  return <details className="rounded border-l-4 bg-muted/60 p-1.5" style={{ borderLeftColor: list?.color ?? '#94a3b8' }}>
    <summary className="cursor-pointer break-words text-xs" title={list?.name ?? '分類不明'}><span className={root?.isCompleted ? 'line-through' : undefined}>{root?.title || entries[0].task.title || '名称未設定のタスク'}</span><span className="mt-0.5 block text-[10px] text-blue-700">この日の開始・期限 {entries.length}件</span><CalendarTaskLabels task={root ?? entries[0].task} labels={props.labels} tags={props.tags} /></summary>
    <div className="mt-1 space-y-1">{entries.map(entry => <CalendarEntry key={entry.key} entry={entry} {...props} />)}</div>
  </details>;
}


function CalendarTaskLabels({ task, labels = [], tags = [] }: { task: Task; labels?: Label[]; tags?: Tag[] }) {
  const badges = [
    ...labels.filter(label => label.projectId === task.projectId && task.labelIds.includes(label.id) && label.id !== MOAI_LABEL_ID && label.name !== MOAI_LABEL.name).map(label => ({ ...label, key: `label:${label.id}` })),
    ...tags.filter(tag => tag.projectId === task.projectId && task.tagIds?.includes(tag.id)).map(tag => ({ ...tag, key: `tag:${tag.id}` })),
  ];
  if (!badges.length) return null;
  return <span className="mt-1 flex min-w-0 flex-wrap gap-1" aria-label="ラベル・タグ">{badges.map(badge => <span key={badge.key} className="max-w-full break-words rounded px-1 py-0.5 text-[10px] font-normal leading-tight" style={{ color: badge.color, backgroundColor: `color-mix(in srgb, ${badge.color} 12%, var(--background))` }}>{badge.name}</span>)}</span>;
}
