import { format, isSameDay } from 'date-fns';
import type { List, Task } from '@/types';
import { sortBoardTasks, type BoardSort } from './sort';

export const TASK_VIEWS = [
  { id: 'board', label: 'カンバン' },
  { id: 'outline', label: '計画リスト' },
  { id: 'table', label: 'テーブル' },
  { id: 'calendar', label: 'カレンダー' },
] as const;
export type TaskView = typeof TASK_VIEWS[number]['id'];
export const isTaskView = (value: unknown): value is TaskView => TASK_VIEWS.some(view => view.id === value);
export const resolveTaskView = (urlView: unknown, saved: unknown): TaskView => isTaskView(urlView) ? urlView : isTaskView(saved) ? saved : 'board';
export const validTaskDate = (value: Date | null | undefined): value is Date => value instanceof Date && Number.isFinite(value.getTime());
export const taskDateLabel = (date: Date | null | undefined) => validTaskDate(date) ? format(date, 'yyyy/M/d') : '—';

export function groupTaskOutline(tasks: readonly Task[], lists: readonly List[], sortMode: BoardSort = 'manual') {
  const active = tasks.filter(task => !task.isArchived);
  const sortTasks = (groupTasks: Task[]) => sortMode === 'manual'
    ? groupTasks.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.order - b.order)
    : sortBoardTasks(groupTasks, sortMode);
  const groups = [...lists].sort((a, b) => a.order - b.order).map(list => ({
    id: list.id, name: list.name, color: list.color,
    tasks: sortTasks(active.filter(task => task.listId === list.id)),
  }));
  const orphaned = sortTasks(active.filter(task => !lists.some(list => list.id === task.listId)));
  if (orphaned.length) groups.push({ id: '__unclassified__', name: '分類不明（元の列が見つかりません）', color: '#94a3b8', tasks: orphaned });
  return groups;
}

export type TableSortField = 'title' | 'list' | 'status' | 'assignee' | 'startDate' | 'dueDate' | 'priority';
export interface TaskTableSort { field: TableSortField; direction: 'asc' | 'desc' }
export function assigneeLabel(ids: readonly string[], names: Record<string, string>) {
  if (!ids.length) return '未割当';
  return ids.map(id => names[id] || '名前未取得').join('・');
}
export function taskReviewState(task: Pick<Task, 'id' | 'taskKind' | 'isCompleted' | 'isArchived' | 'isAbandoned' | 'parentTaskId'>, tasks: readonly Task[]) {
  const requests = task.taskKind === 'review_request'
    ? [task]
    : tasks.filter(candidate => candidate.parentTaskId === task.id && candidate.taskKind === 'review_request' && !candidate.isArchived && !candidate.isAbandoned);
  if (!requests.length) return null;
  const pendingCount = requests.filter(request => !request.isCompleted).length;
  return {
    label: pendingCount ? `確認依頼中${requests.length > 1 ? ` ${pendingCount}/${requests.length}` : ''}` : '確認済み',
    completed: pendingCount === 0,
  };
}
export function sortTaskTable(tasks: readonly Task[], lists: readonly List[], names: Record<string, string>, sort: TaskTableSort) {
  const value = (task: Task): string | number | null => {
    switch (sort.field) {
      case 'title': return task.title;
      case 'list': return lists.find(list => list.id === task.listId)?.name ?? null;
      case 'status': return task.isCompleted ? 1 : 0;
      case 'assignee': return task.assigneeIds.length ? assigneeLabel(task.assigneeIds, names) : null;
      case 'startDate': case 'dueDate': {
        const date = task[sort.field];
        return validTaskDate(date) ? date.getTime() : null;
      }
      case 'priority': return task.priority ? { high: 0, medium: 1, low: 2 }[task.priority] : null;
    }
  };
  return tasks.filter(task => !task.isArchived).sort((a, b) => {
    const av = value(a), bv = value(b);
    // Unset values stay last in either direction; ties retain input order.
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    const compared = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ja');
    return compared * (sort.direction === 'asc' ? 1 : -1);
  });
}

export interface CalendarTaskEntry { task: Task; date: Date; kind: '開始' | '期限' | '開始・期限'; key: string }
export function calendarTaskEntries(tasks: readonly Task[]) {
  const entries: CalendarTaskEntry[] = [];
  const undated: Task[] = [];
  for (const task of tasks) {
    if (task.isArchived) continue;
    const start = validTaskDate(task.startDate) ? task.startDate : null;
    const due = validTaskDate(task.dueDate) ? task.dueDate : null;
    if (!start && !due) { undated.push(task); continue; }
    if (start && due && isSameDay(start, due)) {
      entries.push({ task, date: due, kind: '開始・期限', key: `${task.id}:both` });
    } else {
      if (start) entries.push({ task, date: start, kind: '開始', key: `${task.id}:start` });
      if (due) entries.push({ task, date: due, kind: '期限', key: `${task.id}:due` });
    }
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.task.order - b.task.order);
  return { entries, undated };
}
