'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getTaskSubtasks, moveTaskSubtask } from '@/lib/task/subtasks';
import { CalendarDays, GripVertical, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { sourceCommentHref } from '@/lib/task/commentSubmission';
import { validTaskDate } from '@/lib/board/taskViews';
import { type TaskViewMember } from '@/components/board/TaskViewFields';
import type { Task } from '@/types';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { useAuthStore } from '@/stores/authStore';
import { AssigneeSelector } from './AssigneeSelector';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { WorkflowInput } from '@/lib/task/workflow';
import { TaskRecordLink } from './TaskRecordLink';
import { TaskSubtaskCreator, type AddSubtask } from './TaskSubtaskCreator';

export function TaskRelations({ task, tasks, names, members = {}, onAddSubtask, onReorderSubtasks }: { task: Task; tasks: Task[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; onDeleteSubtask?: (taskId: string) => Promise<void>; onAddSubtask?: AddSubtask; onReorderSubtasks?: (expectedIds: string[], orderedIds: string[]) => Promise<void> }) {
  const userId = useAuthStore(s => s.user?.id);
  const dndId = useId();
  const [removed, setRemoved] = useState<string | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const archived = tasks.find(t => t.id === removed && t.projectId === task.projectId && t.isArchived);
  const scopedTasks = tasks.filter(item => item.projectId === task.projectId);
  const parent = scopedTasks.find(item => item.id === task.parentTaskId);
  const related = [...new Set(task.relatedTaskIds ?? [])].filter(id => id !== task.id);
  const mergedFrom = [...new Set(task.mergedFromTaskIds ?? [])].filter(id => id !== task.id);
  const mergedInto = task.mergedIntoTaskId && task.mergedIntoTaskId !== task.id ? task.mergedIntoTaskId : null;
  const savedChildren = getTaskSubtasks(task, tasks);
  const savedIds = savedChildren.map(item => item.id);
  const children = orderOverride
    ? [...savedChildren].sort((a, b) => {
      const aIndex = orderOverride.indexOf(a.id), bIndex = orderOverride.indexOf(b.id);
      if (aIndex < 0) return bIndex < 0 ? 0 : 1;
      if (bIndex < 0) return -1;
      return aIndex - bIndex;
    })
    : savedChildren;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    if (orderOverride && savedIds.length === orderOverride.length && savedIds.every((id, index) => id === orderOverride[index])) setOrderOverride(null);
  }, [orderOverride, savedIds]);
  const handleReorder = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !onReorderSubtasks || reorderBusy) return;
    let orderedIds: string[];
    try { orderedIds = moveTaskSubtask(children.map(item => item.id), String(active.id), String(over.id)); }
    catch (error) { setReorderError(error instanceof Error ? error.message : 'サブタスクの順序を確認できません。'); return; }
    setReorderError('');
    setOrderOverride(orderedIds);
    setReorderBusy(true);
    try { await onReorderSubtasks(children.map(item => item.id), orderedIds); }
    catch (error) {
      setOrderOverride(null);
      setReorderError(error instanceof Error ? error.message : '並べ替えを保存できませんでした。もう一度お試しください。');
    } finally { setReorderBusy(false); }
  };
  const sourceTaskId = task.sourceCommentTaskId ?? task.parentTaskId;
  const sourceHref = task.sourceCommentId && sourceTaskId ? sourceCommentHref(task.projectId, sourceTaskId, task.sourceCommentId) : null;
  if (!task.parentTaskId && !children.length && !sourceHref && !related.length && !mergedFrom.length && !mergedInto && !archived) return null;
  return <section aria-label="タスクのつながり" className="mt-3 space-y-2 text-sm">
    {task.parentTaskId && <div className="space-y-1">
      <p className="font-medium">{task.taskKind === 'review_request' ? '共有の確認依頼' : 'サブタスク'}</p>
      <Link className="block text-xs text-blue-600 hover:underline" href={`/projects/${task.projectId}/board?task=${task.parentTaskId}`}>親タスク：{parent?.title ?? '親タスクを開く'}</Link>
      {task.taskKind === 'review_request' && <p className="text-xs text-muted-foreground">依頼先全員に共通のタスクです。完了は親タスクとは別に管理します。</p>}
    </div>}
    {sourceHref && <Link className="inline-block text-xs text-blue-600 hover:underline" href={sourceHref}>元コメントを開く</Link>}
    {(children.length > 0 || archived) && <section aria-label="サブタスク" className="min-w-0 rounded-lg border bg-white">
      <div className="flex items-center gap-3 px-3 py-2">
        <h3 className="font-medium">サブタスク</h3>
        <span className="text-xs text-muted-foreground">{children.length}件</span>
      </div>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => void handleReorder(event)}
        accessibility={{ screenReaderInstructions: { draggable: 'スペースでつかみ、上下矢印で移動、スペースで確定、Escapeで取り消します。' } }}>
        <SortableContext items={children.map(child => child.id)} strategy={verticalListSortingStrategy}>
          <ul aria-label="サブタスク一覧" className="border-t px-3 py-1">
            {children.map(child => <SortableSubtaskRow key={child.id} task={child} tasks={tasks} names={names} members={members}
              onRemoved={() => setRemoved(child.id)} userId={userId ?? ''} dragDisabled={!onReorderSubtasks || reorderBusy} />)}
          </ul>
        </SortableContext>
      </DndContext>
      {reorderError && <p role="alert" className="px-3 pb-1 text-xs text-destructive">{reorderError}</p>}
      {archived && userId && <RestoreSubtask key={archived.id} task={archived} userId={userId} onRestored={() => setRemoved(null)} />}
      {onAddSubtask && <div className="px-3 pb-2"><TaskSubtaskCreator key={`subtask-inline:${task.projectId}/${task.id}`} inline task={task} onAdd={onAddSubtask} /></div>}
    </section>}
    {children.length > 0 && <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">サブタスクの以前の記録</summary><div className="space-y-2 py-2">{children.map(child => <TaskRecordLink key={child.id} projectId={task.projectId} taskId={child.id} task={child} names={names} record inline label={child.title || '名称未設定のサブタスク'} />)}</div></details>}
    {!!related.length && <div className="space-y-1"><h3 className="font-medium">関連する仕事</h3><div className="flex flex-col items-start gap-1">{related.map(id => {const item=scopedTasks.find(t=>t.id===id);return <TaskRecordLink key={id} projectId={task.projectId} taskId={id} task={item} names={names} label={item?.title??'関連する仕事を確認'}/>;})}</div></div>}
    {mergedInto && <div className="space-y-1"><h3 className="font-medium">この仕事の統合先</h3><TaskRecordLink projectId={task.projectId} taskId={mergedInto} task={scopedTasks.find(t=>t.id===mergedInto)} names={names} label={scopedTasks.find(t=>t.id===mergedInto)?.title??'統合先を確認'}/></div>}
    {!!mergedFrom.length && <div className="space-y-1"><h3 className="font-medium">統合元の記録（{mergedFrom.length}件）</h3><p className="text-xs text-muted-foreground">元の本文・コメント・添付・手順を確認できます。</p><div className="flex flex-col items-start gap-1">{mergedFrom.map((id,index) => {const item=scopedTasks.find(t=>t.id===id);return <TaskRecordLink key={id} projectId={task.projectId} taskId={id} task={item} names={names} record label={item?.title??`統合元の記録 ${index+1}を開く`}/>;})}</div></div>}
  </section>;
}

function SortableSubtaskRow({ task, members, userId, onRemoved, dragDisabled }: {
  task: Task; tasks: Task[]; names: Record<string, string>; members: Record<string, TaskViewMember>;
  userId: string; onRemoved: () => void; dragDisabled: boolean;
}) {
  const flow = useTaskWorkflow(task, userId, 'subtask');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dateOpen, setDateOpen] = useState(false);
  const dueDate = validTaskDate(task.dueDate) ? task.dueDate : undefined;
  const saving = useRef(false);
  const save = async (patch: NonNullable<WorkflowInput['subtaskPatch']>) => {
    if (saving.current || !userId) return;
    saving.current = true;
    try { if (await flow.run('edit_subtask', '', undefined, undefined, {subtaskPatch: patch})) {setEditing(false);setDateOpen(false);} }
    finally {saving.current=false;}
  };
  const people = Object.entries(members).map(([id, person]) => ({...person, id, displayName: person.displayName || '名前は未取得'}));
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: dragDisabled || flow.locked || editing,
  });
  return <li ref={setNodeRef} id={`task-subtask-${task.id}`} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={cn('rounded', isDragging && 'relative z-10 bg-muted shadow-sm')}>
    <fieldset disabled={flow.locked || !userId} className="group flex min-w-0 items-center gap-1 rounded py-0.5 hover:bg-muted/50">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={dragDisabled || flow.locked || !userId || editing}
        aria-label={`${task.title}をドラッグして並べ替え`} title="ドラッグして並べ替え"
        className="flex h-6 w-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 cursor-grab active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </button>
      <input type="checkbox" className="size-4 shrink-0 accent-primary" aria-label={`${task.title}を${task.isCompleted ? '未完了に戻す' : '完了にする'}`} checked={task.isCompleted} onChange={() => void flow.run(task.isCompleted ? 'reopen' : 'complete')} />
      {editing ? <input className="h-7 min-w-0 flex-1 rounded border px-1 text-sm" aria-label="サブタスク名を編集" autoFocus maxLength={500} value={title} onChange={e=>setTitle(e.target.value)} onBlur={()=>{if(title.trim() && title.trim()!==task.title)void save({title:title.trim()});else setEditing(false);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save({title:title.trim()});}if(e.key==='Escape'){setTitle(task.title);setEditing(false);}}} /> : <button type="button" title={task.title} className={cn('min-h-7 min-w-0 flex-1 truncate text-left', task.isCompleted && 'text-muted-foreground line-through')} onClick={()=>{setTitle(task.title);setEditing(true);}}>{task.title || '名称未設定のサブタスク'}</button>}
      <Popover modal open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:bg-muted" aria-label={`${task.title}の期日`}>
            <CalendarDays className="size-3.5" />{dueDate ? format(dueDate, 'M/d') : ''}
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={`${task.title}の期日の設定`} className="w-auto max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-2 p-3">
          <Calendar
            mode="single"
            defaultMonth={dueDate}
            selected={dueDate}
            disabled={flow.locked || !userId}
            onSelect={date => void save({ dueDate: date ? format(date, 'yyyy-MM-dd') : null })}
          />
          <Button size="sm" variant="ghost" disabled={flow.locked || !userId} onClick={() => void save({ dueDate: null })}>期日を外す</Button>
        </PopoverContent>
      </Popover>
      <AssigneeSelector compact membersOverride={people} projectMemberIds={people.map(p=>p.id)} assigneeIds={task.assigneeIds} onUpdate={ids=>void save({assigneeIds:ids})} />
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive" aria-label={`${task.title}を削除`} onClick={async()=>{if(await flow.run('archive'))onRemoved();}}><Trash2 className="size-3.5" /></button>
    </fieldset>
    {flow.error && <p role="alert" className="py-1 text-xs text-destructive">{flow.error}</p>}
    {flow.pending && <Button size="sm" variant="outline" disabled={flow.busy} onClick={()=>void flow.run(flow.pending!.action)}>同じ操作を再試行</Button>}
  </li>;
}
function RestoreSubtask({task,userId,onRestored}:{task:Task;userId:string;onRestored:()=>void}) {
 const flow=useTaskWorkflow(task,userId,'subtask-restore');
 return <div className="px-3 py-1 text-xs"><span>「{task.title}」を削除しました。</span><button type="button" className="ml-2 underline" disabled={flow.busy || !flow.ready} onClick={async()=>{if(await flow.run('restore'))onRestored();}}>元に戻す</button>{flow.error&&<p role="alert">{flow.error}</p>}</div>;
}
