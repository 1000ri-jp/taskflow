'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, rectIntersection, type DragEndEvent, type DragStartEvent, type CollisionDetection } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { TASK_STATUSES, taskStatus } from '@/lib/task/status';
import { groupTaskFamilies } from '@/lib/board/taskHierarchy';
import { taskVersion } from '@/lib/task/workflow';
import { ProgressTaskCard, ProgressTaskOperation, type ProgressTaskController } from './ProgressTaskCard';
import { ProgressColumn } from './ProgressColumn';
import { TaskCard } from './TaskCard';
import type { TaskViewMember } from './TaskViewFields';
import type { Task, List, Label, Tag } from '@/types';

const collision: CollisionDetection = args => {
  const pointed = pointerWithin(args);
  return pointed.length ? pointed : rectIntersection(args);
};

export function TaskProgressView({ projectId, viewerId, tasks, allTasks, lists, labels = [], tags = [], names, members, canEdit = false, onTaskClick, onMoveTask }: {
  projectId: string; viewerId: string; tasks: Task[]; allTasks: Task[]; lists: List[]; labels?: Label[]; tags?: Tag[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; canEdit?: boolean;
  onTaskClick: (id: string) => void; onMoveTask?: (id: string, listId: string) => Promise<void>;
}) {
  const matched = [...new Map(tasks.filter(task => task.projectId === projectId).map(task => [task.id, task])).values()];
  const families = groupTaskFamilies(matched, allTasks.filter(task => task.projectId === projectId), { includeArchived: true });
  const familyById = new Map(families.map(family => [family.task.id, family]));
  const visible = families.map(family => family.task);
  const groups = TASK_STATUSES.map(status => ({ ...status, tasks: visible.filter(task => taskStatus(task, allTasks) === status.id)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ja')) }));
  const controllers = useRef(new Map<string, ProgressTaskController>());
  const drag = useRef<{ id: string; version: string } | null>(null);
  const saving = useRef(false);
  const ignoreClick = useRef(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const onLockedChange = useCallback((id: string, value: boolean) => setLocked(current => current[id] === value ? current : { ...current, [id]: value }), []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [errorTaskId, setErrorTaskId] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const openTask = (id: string) => { if (ignoreClick.current) { ignoreClick.current = false; return; } onTaskClick(id); };
  const clearDrag = () => { drag.current = null; setActiveTask(null); };
  const start = ({ active }: DragStartEvent) => {
    const task = visible.find(task => task.id === active.id);
    if (!task || !canEdit || saving.current || controllers.current.get(task.id)?.locked !== false) return;
    drag.current = { id: task.id, version: taskVersion(task) }; ignoreClick.current = true;
    setActiveTask(task); setNotice(''); setError(''); setErrorTaskId(task.id);
  };
  const end = async ({ active, over }: DragEndEvent) => {
    const source = drag.current; clearDrag();
    if (!source || !over || source.id !== active.id || !canEdit || saving.current) return;
    const task = visible.find(task => task.id === source.id);
    if (!task || taskVersion(task) !== source.version) { setError('仕事の情報が更新されました。内容を確認してから、もう一度移動してください。'); return; }
    const overTask = visible.find(task => task.id === over.id);
    const target = TASK_STATUSES.find(status => `progress:${status.id}` === over.id)?.id ?? (overTask ? taskStatus(overTask, allTasks) : undefined);
    const controller = controllers.current.get(task.id);
    if (!target || taskStatus(task, allTasks) === target || !controller || controller.locked) return;
    saving.current = true; setBusy(true);
    try {
      if (await controller.moveTo(target)) setNotice(`${task.title}を「${TASK_STATUSES.find(status => status.id === target)!.label}」にしました。`);
    } catch (error) { setError(error instanceof Error ? error.message : '変更できませんでした。'); }
    finally { saving.current = false; setBusy(false); }
  };
  const moveList = async (id: string, listId: string) => {
    if (!canEdit || saving.current || !onMoveTask) return;
    saving.current = true; setBusy(true); setError(''); setNotice(''); setErrorTaskId(id);
    try { await onMoveTask(id, listId); setNotice('リストを移動しました。'); }
    catch (error) { setError(error instanceof Error ? error.message : 'リストを移動できませんでした。'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <DndContext sensors={sensors} collisionDetection={collision} onDragStart={start} onDragEnd={end} onDragCancel={clearDrag}>
    <div aria-label="カンバン進捗" className="flex h-full min-h-72 flex-col gap-3 p-3"
      onPointerDownCapture={() => { if (!drag.current) ignoreClick.current = false; }}
      onKeyDownCapture={event => { if (!drag.current && ['Enter', ' '].includes(event.key)) ignoreClick.current = false; }}>
      <p className="text-xs text-muted-foreground">{canEdit ? '列へのドラッグで進捗を変更。右クリックでリストを移動できます。' : 'カードを開くと詳細を確認できます。'} 待機は、前提の完了で自動解除されます。</p>
      {(busy || notice) && <p role="status" className="text-xs text-muted-foreground">{busy ? '変更を保存中…' : notice}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}{errorTaskId && <button type="button" className="ml-2 underline underline-offset-2" onClick={() => onTaskClick(errorTaskId)}>詳細を開く</button>}</p>}
      {visible.map(task => <ProgressTaskOperation key={`${viewerId}:${projectId}:${task.id}`} task={task} allTasks={allTasks} viewerId={viewerId} canEdit={canEdit && !familyById.get(task.id)?.isContext} busy={busy} onLockedChange={onLockedChange}
        controllerRef={controller => { if (controller) controllers.current.set(task.id, controller); else controllers.current.delete(task.id); }} />)}
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-3">
        {groups.map(group => <ProgressColumn key={`${viewerId}:${projectId}:${group.id}`} status={group} tasks={group.tasks} projectId={projectId} viewerId={viewerId} disabled={!canEdit || busy}>
          {(task, displaySettings) => <ProgressTaskCard key={`${viewerId}:${task.id}`} locked={locked[task.id] ?? true}
            task={task} childrenTasks={familyById.get(task.id)?.children ?? []} isContext={familyById.get(task.id)?.isContext} allTasks={allTasks} projectId={projectId} viewerId={viewerId} canEdit={canEdit && !familyById.get(task.id)?.isContext} busy={busy} lists={lists} labels={labels} tags={tags} names={names} members={members} displaySettings={displaySettings}
            onTaskClick={openTask} onMoveTask={onMoveTask ? moveList : undefined} />}
        </ProgressColumn>)}
      </div>
    </div>
    <DragOverlay>{activeTask && <TaskCard projectId={projectId} task={activeTask} allTasks={allTasks} listName={lists.find(list => list.id === activeTask.listId)?.name ?? ''} listColor={lists.find(list => list.id === activeTask.listId)?.color ?? '#94a3b8'} labels={labels} tags={tags} onClick={() => {}} isDragging disableDragging />}</DragOverlay>
  </DndContext>;
}
