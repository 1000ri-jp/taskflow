'use client';

import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { Button } from '@/components/ui/button';
import { TaskOutlineView } from './TaskOutlineView';
import { TaskTableView } from './TaskTableView';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskProgressView } from './TaskProgressView';
import type { MoveTaskToList } from './TaskListPicker';
import type { TaskView } from '@/lib/board/taskViews';
import type { List, Task, Milestone, Label, Tag } from '@/types';

export function AlternateTaskViews({ view, projectId, viewerId, projectMemberIds, tasks, allTasks = tasks, milestones = [], onMilestoneClick, selectedListId, lists, labels = [], tags = [], canEdit = false, onTaskClick, onMoveTask, onDateChange, onAddTask }: {
  view: Exclude<TaskView, 'board'>; projectId: string; viewerId: string; projectMemberIds: string[]; tasks: Task[]; allTasks?: Task[]; milestones?: Milestone[]; selectedListId?: string | null; onMilestoneClick?: (id: string) => void; lists: List[]; labels?: Label[]; tags?: Tag[]; canEdit?: boolean; onTaskClick: (id: string) => void; onMoveTask?: MoveTaskToList; onDateChange?: (task: Task, kind: '開始' | '期限' | '開始・期限', date: Date) => void | Promise<void>; onAddTask?: (listId: string, title: string, dueDate: Date, assigneeIds?: string[]) => void | Promise<void>;
}) {
  // Resolve actual assignees, including historical members, rather than inventing names.
  const members = useMeetingMembers([{ memberIds: [...new Set([...projectMemberIds, ...tasks.flatMap(task => task.assigneeIds)])] }], true);
  const names = Object.fromEntries(members.users.map(member => [member.id, member.displayName]));
  const memberDetails = Object.fromEntries(members.users.map(member => [member.id, member]));
  return <div className={view === 'progress' ? 'flex h-full min-w-0 flex-col' : 'min-w-0'}>
    {members.isLoading && <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">担当者名を読み込み中…</p>}
    {members.hasError && <p role="alert" className="px-3 pt-2 text-xs text-destructive">担当者名を取得できません。<Button type="button" variant="ghost" size="sm" onClick={members.refresh}>再試行</Button></p>}
    {view === 'progress' ? <TaskProgressView members={memberDetails} projectId={projectId} viewerId={viewerId} canEdit={canEdit} labels={labels} tags={tags} onMoveTask={onMoveTask} tasks={tasks} allTasks={allTasks} lists={lists} names={names} onTaskClick={onTaskClick} /> : view === 'outline' ? <TaskOutlineView projectId={projectId} viewerId={viewerId} tasks={tasks} allTasks={allTasks} lists={lists} names={names} members={memberDetails} onTaskClick={onTaskClick} onMoveTask={onMoveTask} /> : view === 'table' ? <TaskTableView members={memberDetails} viewerId={viewerId} tasks={tasks} allTasks={allTasks} lists={lists} names={names} onTaskClick={onTaskClick} onMoveTask={onMoveTask} /> : <TaskCalendarView labels={labels} tags={tags} names={names} members={memberDetails} selectedListId={selectedListId} milestones={milestones} onMilestoneClick={onMilestoneClick} tasks={tasks} allTasks={allTasks} lists={lists} onTaskClick={onTaskClick} onDateChange={onDateChange} onAddTask={onAddTask} />}
  </div>;
}
