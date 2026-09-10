'use client';

import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { Button } from '@/components/ui/button';
import { TaskOutlineView } from './TaskOutlineView';
import { TaskTableView } from './TaskTableView';
import { TaskCalendarView } from './TaskCalendarView';
import type { TaskView } from '@/lib/board/taskViews';
import type { List, Task } from '@/types';

export function AlternateTaskViews({ view, projectId, viewerId, projectMemberIds, tasks, lists, onTaskClick, onDateChange, onAddTask }: {
  view: Exclude<TaskView, 'board'>; projectId: string; viewerId: string; projectMemberIds: string[]; tasks: Task[]; lists: List[]; onTaskClick: (id: string) => void; onDateChange?: (task: Task, kind: '開始' | '期限' | '開始・期限', date: Date) => void | Promise<void>; onAddTask?: (listId: string, title: string, dueDate: Date) => void | Promise<void>;
}) {
  // Resolve actual assignees, including historical members, rather than inventing names.
  const members = useMeetingMembers([{ memberIds: [...new Set([...projectMemberIds, ...tasks.flatMap(task => task.assigneeIds)])] }], view !== 'calendar');
  const names = Object.fromEntries(members.users.map(member => [member.id, member.displayName]));
  const memberDetails = Object.fromEntries(members.users.map(member => [member.id, member]));
  return <div className="min-w-0">
    {view !== 'calendar' && members.isLoading && <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">担当者名を読み込み中…</p>}
    {view !== 'calendar' && members.hasError && <p role="alert" className="px-3 pt-2 text-xs text-destructive">担当者名を取得できません。<Button type="button" variant="ghost" size="sm" onClick={members.refresh}>再試行</Button></p>}
    {view === 'outline' ? <TaskOutlineView projectId={projectId} viewerId={viewerId} tasks={tasks} lists={lists} names={names} members={memberDetails} onTaskClick={onTaskClick} /> : view === 'table' ? <TaskTableView tasks={tasks} lists={lists} names={names} onTaskClick={onTaskClick} /> : <TaskCalendarView tasks={tasks} lists={lists} onTaskClick={onTaskClick} onDateChange={onDateChange} onAddTask={onAddTask} />}
  </div>;
}
