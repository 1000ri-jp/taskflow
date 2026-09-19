import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  differenceInDays,
  format,
  isToday,
  isWeekend,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import type { Task } from '@/types';

export type ViewMode = 'day' | 'week' | 'month';

export interface DateColumn {
  date: Date;
  label: string;
  subLabel?: string;
  isToday: boolean;
  isWeekend: boolean;
  isFirstOfMonth: boolean;
}

export interface GanttTask extends Task {
  barStart: number;
  barWidth: number;
  listColor: string;
}

// Get the date range for the gantt chart based on tasks
export function getDateRange(
  tasks: Task[],
  viewMode: ViewMode,
  padding: number = 7,
  additionalDates: Date[] = []
): { start: Date; end: Date } {
  const today = new Date();

  // Filter tasks with dates
  const tasksWithDates = tasks.filter((t) => t.startDate || t.dueDate);

  if (tasksWithDates.length === 0 && additionalDates.length === 0) {
    // Default range: 2 weeks before and after today
    return {
      start: addDays(today, -14),
      end: addDays(today, 14),
    };
  }

  const dates: Date[] = [...additionalDates];
  tasksWithDates.forEach((task) => {
    if (task.startDate) dates.push(task.startDate);
    if (task.dueDate) dates.push(task.dueDate);
  });
  dates.push(today);

  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

  // Add padding
  let start: Date;
  let end: Date;

  switch (viewMode) {
    case 'day':
      start = addDays(startOfDay(minDate), -padding);
      end = addDays(endOfDay(maxDate), padding);
      break;
    case 'week':
      start = startOfWeek(addWeeks(minDate, -1), { locale: ja });
      end = endOfWeek(addWeeks(maxDate, 1), { locale: ja });
      break;
    case 'month':
      start = startOfMonth(addMonths(minDate, -1));
      end = endOfMonth(addMonths(maxDate, 1));
      break;
  }

  return { start, end };
}

// Generate date columns for the header
export function generateDateColumns(
  start: Date,
  end: Date,
  viewMode: ViewMode
): DateColumn[] {
  const columns: DateColumn[] = [];

  switch (viewMode) {
    case 'day': {
      const days = eachDayOfInterval({ start, end });
      days.forEach((date) => {
        columns.push({
          date,
          label: format(date, 'd', { locale: ja }),
          subLabel: format(date, 'E', { locale: ja }),
          isToday: isToday(date),
          isWeekend: isWeekend(date),
          isFirstOfMonth: date.getDate() === 1,
        });
      });
      break;
    }
    case 'week': {
      const weeks = eachWeekOfInterval({ start, end }, { locale: ja });
      weeks.forEach((date) => {
        const weekEnd = addDays(date, 6);
        columns.push({
          date,
          label: `${format(date, 'M/d', { locale: ja })}`,
          subLabel: `〜${format(weekEnd, 'M/d', { locale: ja })}`,
          isToday: false,
          isWeekend: false,
          isFirstOfMonth: date.getDate() <= 7,
        });
      });
      break;
    }
    case 'month': {
      const months = eachMonthOfInterval({ start, end });
      months.forEach((date) => {
        columns.push({
          date,
          label: format(date, 'M月', { locale: ja }),
          subLabel: format(date, 'yyyy', { locale: ja }),
          isToday: false,
          isWeekend: false,
          isFirstOfMonth: true,
        });
      });
      break;
    }
  }

  return columns;
}

// Calculate the column width based on view mode
export function getColumnWidth(viewMode: ViewMode): number {
  switch (viewMode) {
    case 'day':
      return 40;
    case 'week':
      return 80;
    case 'month':
      return 120;
  }
}

export interface TaskBarResult {
  start: number;
  width: number;
  plannedEnd?: number;    // 予定終了位置（完了タスクの場合）
  isLate?: boolean;       // 遅延フラグ
  isEarly?: boolean;      // 早期完了フラグ
}

// Calculate bar position and width for a task
export function calculateTaskBar(
  task: Task,
  rangeStart: Date,
  viewMode: ViewMode,
  columnWidth: number
): TaskBarResult | null {
  const startDate = task.startDate || task.dueDate;
  const plannedEndDate = task.dueDate || task.startDate;

  if (!startDate || !plannedEndDate) {
    return null;
  }

  let unitDivisor: number;
  switch (viewMode) {
    case 'day':
      unitDivisor = 1;
      break;
    case 'week':
      unitDivisor = 7;
      break;
    case 'month':
      unitDivisor = 30;
      break;
  }

  const startOffset = differenceInDays(startDate, rangeStart) / unitDivisor;
  const plannedDuration = Math.max(
    1,
    (differenceInDays(plannedEndDate, startDate) + 1) / unitDivisor
  );

  // 完了タスクの場合、completedAtを使用
  if (task.isCompleted && task.completedAt) {
    const actualDuration = Math.max(
      1,
      (differenceInDays(task.completedAt, startDate) + 1) / unitDivisor
    );
    const isLate = task.completedAt > plannedEndDate;
    const isEarly = task.completedAt < plannedEndDate;

    return {
      start: startOffset * columnWidth,
      width: actualDuration * columnWidth,
      plannedEnd: isEarly ? (startOffset + plannedDuration) * columnWidth : undefined,
      isLate,
      isEarly,
    };
  }

  return {
    start: startOffset * columnWidth,
    width: plannedDuration * columnWidth,
  };
}

// Group tasks by list
export function groupTasksByList(
  tasks: Task[],
  listColors: Record<string, string>
): GanttTask[][] {
  const grouped: Record<string, Task[]> = {};

  tasks.forEach((task) => {
    if (!grouped[task.listId]) {
      grouped[task.listId] = [];
    }
    grouped[task.listId].push(task);
  });

  return Object.entries(grouped).map(([listId, listTasks]) =>
    listTasks.map((task) => ({
      ...task,
      barStart: 0,
      barWidth: 0,
      listColor: listColors[listId] || '#6b7280',
    }))
  );
}

// Get month headers for the top row
export function getMonthHeaders(
  columns: DateColumn[],
  viewMode: ViewMode
): { month: string; span: number }[] {
  if (viewMode === 'month') {
    return columns.map((col) => ({
      month: format(col.date, 'yyyy年M月', { locale: ja }),
      span: 1,
    }));
  }

  const headers: { month: string; span: number }[] = [];
  let currentMonth = '';
  let currentSpan = 0;

  columns.forEach((col, index) => {
    const monthLabel = format(col.date, 'yyyy年M月', { locale: ja });

    if (monthLabel !== currentMonth) {
      if (currentMonth) {
        headers.push({ month: currentMonth, span: currentSpan });
      }
      currentMonth = monthLabel;
      currentSpan = 1;
    } else {
      currentSpan++;
    }

    // Last column
    if (index === columns.length - 1) {
      headers.push({ month: currentMonth, span: currentSpan });
    }
  });

  return headers;
}

// Format date for display
export function formatTaskDate(date: Date | null): string {
  if (!date) return '-';
  return format(date, 'M/d', { locale: ja });
}

// Get today's position
export function getTodayPosition(
  rangeStart: Date,
  viewMode: ViewMode,
  columnWidth: number
): number {
  const today = new Date();
  let unitDivisor: number;

  switch (viewMode) {
    case 'day':
      unitDivisor = 1;
      break;
    case 'week':
      unitDivisor = 7;
      break;
    case 'month':
      unitDivisor = 30;
      break;
  }

  const offset = differenceInDays(today, rangeStart) / unitDivisor;
  return offset * columnWidth;
}
