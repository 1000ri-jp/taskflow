'use client';

import { useEffect, useImperativeHandle, type Ref } from 'react';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { progressMoveAction } from '@/lib/board/progressMoves';
import type { TaskStatusId } from '@/lib/task/status';
import type { BoardDisplaySettings } from '@/stores/boardDisplayStore';
import { TaskCard } from './TaskCard';
import { TaskChildrenSummary } from './TaskChildrenSummary';
import { Button } from '@/components/ui/button';
import type { TaskViewMember } from './TaskViewFields';
import type { Task, List, Label, Tag } from '@/types';

export interface ProgressTaskController {
  locked: boolean;
  moveTo: (target: TaskStatusId) => Promise<boolean>;
}

// Kept outside the status columns so a live status update cannot remount an in-flight request.
export function ProgressTaskOperation({ controllerRef, task, allTasks, viewerId, canEdit, busy, onLockedChange }: {
  controllerRef: Ref<ProgressTaskController>; task: Task; allTasks: Task[]; viewerId: string; canEdit: boolean; busy: boolean;
  onLockedChange: (id: string, locked: boolean) => void;
}) {
  const flow = useTaskWorkflow(task, viewerId, 'progress');
  const locked = !canEdit || flow.locked;
  useEffect(() => { onLockedChange(task.id, locked); }, [task.id, locked, onLockedChange]);
  useImperativeHandle(controllerRef, () => ({
    locked,
    moveTo: async target => {
      if (locked) return false;
      const action = progressMoveAction(task, target, allTasks, viewerId);
      return action ? flow.run(action) : false;
    },
  }), [locked, flow, task, allTasks, viewerId]);
  if (!flow.error && !flow.pending) return null;
  return <div className="space-y-1">
    {flow.error && <p role="alert" className="text-xs text-destructive">{task.title}：{flow.error}</p>}
    {flow.pending && !flow.busy && <Button size="sm" variant="outline" disabled={!canEdit || busy} onClick={() => void flow.run(flow.pending!.action)}>{task.title}：同じ操作を再試行</Button>}
  </div>;
}

export function ProgressTaskCard({ task, childrenTasks, isContext = false, allTasks, projectId, viewerId, canEdit, busy, locked, lists, labels, tags, names, members, displaySettings, onTaskClick, onMoveTask }: {
  task: Task; childrenTasks: Task[]; isContext?: boolean; allTasks: Task[]; projectId: string; viewerId: string; canEdit: boolean; busy: boolean; locked: boolean;
  lists: List[]; labels: Label[]; tags: Tag[]; names: Record<string, string>; members?: Record<string, TaskViewMember>; displaySettings?: Partial<BoardDisplaySettings>;
  onTaskClick: (id: string) => void; onMoveTask?: (id: string, listId: string) => Promise<void>;
}) {
  const list = lists.find(list => list.id === task.listId);
  const movable = canEdit && !busy && !locked && !task.isArchived && onMoveTask;
  return <TaskCard projectId={projectId} task={task} listName={list?.name ?? '分類不明'} listColor={list?.color ?? '#94a3b8'}
    labels={labels} tags={tags} allTasks={allTasks} lists={lists} ariaLabel={`${task.title}の詳細を開く`} displaySettings={displaySettings}
    disableDragging={!canEdit || busy || locked} onClick={() => onTaskClick(task.id)}
    onMove={movable ? listId => { void onMoveTask(task.id, listId); } : undefined}
    footer={<>
      {isContext && <p className="px-2.5 py-1 text-[11px] text-muted-foreground">条件に合うサブタスクの親</p>}
      <TaskChildrenSummary task={task} childrenTasks={childrenTasks} allTasks={allTasks} viewerId={viewerId} names={names} members={members} lists={lists} rowLayout="single-line"
      onTaskClick={onTaskClick} onMoveTask={movable ? onMoveTask : undefined} /></>} />;
}
