'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskCreationForm } from './TaskCreationForm';
import type { Task } from '@/types';
export type AddSubtask = (parent: Task, title: string, assigneeIds?: string[]) => Promise<unknown>;
export function TaskSubtaskCreator({ task, onAdd, inline = false }: { task: Task; onAdd: AddSubtask; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  if (task.parentTaskId || task.isArchived || task.isAbandoned) return null;
  return <div className={open ? 'w-full' : undefined}>{open
    ? <TaskCreationForm projectId={task.projectId} parent={task} label="サブタスクの追加" titleLabel="サブタスク名" onSubmit={(title, assignees) => onAdd(task, title, assignees)} onCancel={() => setOpen(false)} />
    : <Button type="button" variant={inline ? 'ghost' : 'outline'} size="sm" className={inline ? 'h-8 justify-start px-0 text-muted-foreground' : undefined} onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />サブタスク</Button>}
  </div>;
}
