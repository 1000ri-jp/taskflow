import { endOfDay, endOfWeek, isBefore, isWithinInterval, startOfDay } from 'date-fns';
import type { Task } from '@/types';

export interface BoardFilters {
  keyword: string;
  labelIds: Set<string>;
  dueFilter: 'all' | 'today' | 'week' | 'overdue' | 'none';
  showCompleted: boolean;
}

export function taskMatchesBoardFilters(
  task: Task,
  filters: BoardFilters,
  now: Date = new Date()
): boolean {
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    if (
      !task.title.toLowerCase().includes(keyword) &&
      !task.description?.toLowerCase().includes(keyword)
    ) {
      return false;
    }
  }

  if (!filters.showCompleted && task.isCompleted) {
    return false;
  }

  if (filters.labelIds.size > 0) {
    const hasMatchingLabel = task.labelIds.some((id) => filters.labelIds.has(id));
    if (!hasMatchingLabel) return false;
  }

  if (filters.dueFilter === 'all') return true;

  const today = startOfDay(now);
  const todayEnd = endOfDay(now);

  switch (filters.dueFilter) {
    case 'today':
      return Boolean(
        task.dueDate &&
        !task.isCompleted &&
        task.dueDate.getTime() <= todayEnd.getTime()
      );
    case 'week':
      return Boolean(
        task.dueDate &&
        isWithinInterval(task.dueDate, {
          start: today,
          end: endOfWeek(now, { weekStartsOn: 1 }),
        })
      );
    case 'overdue':
      return Boolean(task.dueDate && isBefore(task.dueDate, today) && !task.isCompleted);
    case 'none':
      return !task.dueDate;
  }
}
