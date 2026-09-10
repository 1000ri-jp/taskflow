import { describe, it, expect } from 'vitest';
import {
  getDateRange,
  generateDateColumns,
  getColumnWidth,
  calculateTaskBar,
  getMonthHeaders,
  getTodayPosition,
  formatTaskDate,
} from './gantt';
import type { Task } from '@/types';

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  projectId: 'p1',
  listId: 'l1',
  title: 'Test Task',
  description: '',
  order: 0,
  assigneeIds: [],
  labelIds: [],
  tagIds: [],
  dependsOnTaskIds: [],
  priority: null,
  startDate: null,
  dueDate: null,
  durationDays: null,
  isDueDateFixed: false,
  isCompleted: false,
  completedAt: null,
  isAbandoned: false,
  isArchived: false,
  archivedAt: null,
  archivedBy: null,
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('getDateRange', () => {
  it('returns default range when no tasks with dates', () => {
    const tasks = [createTask()];
    const { start, end } = getDateRange(tasks, 'day');

    const today = new Date();
    const expectedStart = new Date(today);
    expectedStart.setDate(today.getDate() - 14);
    const expectedEnd = new Date(today);
    expectedEnd.setDate(today.getDate() + 14);

    expect(start.toDateString()).toBe(expectedStart.toDateString());
    expect(end.toDateString()).toBe(expectedEnd.toDateString());
  });

  it('includes task dates in range', () => {
    const startDate = new Date('2025-01-01');
    const dueDate = new Date('2025-01-31');
    const tasks = [createTask({ startDate, dueDate })];
    const { start, end } = getDateRange(tasks, 'day', 7);

    expect(start <= startDate).toBe(true);
    expect(end >= dueDate).toBe(true);
  });
});

describe('generateDateColumns', () => {
  it('generates day columns', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-01-05');
    const columns = generateDateColumns(start, end, 'day');

    expect(columns.length).toBe(5);
    expect(columns[0].label).toBe('1');
  });

  it('generates week columns', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-01-31');
    const columns = generateDateColumns(start, end, 'week');

    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0].subLabel).toContain('〜');
  });

  it('generates month columns', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-03-31');
    const columns = generateDateColumns(start, end, 'month');

    expect(columns.length).toBe(3);
    expect(columns[0].label).toBe('1月');
    expect(columns[1].label).toBe('2月');
    expect(columns[2].label).toBe('3月');
  });

  it('marks today correctly', () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 2);
    const end = new Date(today);
    end.setDate(today.getDate() + 2);

    const columns = generateDateColumns(start, end, 'day');
    const todayColumn = columns.find((c) => c.isToday);

    expect(todayColumn).toBeDefined();
  });
});

describe('getColumnWidth', () => {
  it('returns 40 for day view', () => {
    expect(getColumnWidth('day')).toBe(40);
  });

  it('returns 80 for week view', () => {
    expect(getColumnWidth('week')).toBe(80);
  });

  it('returns 120 for month view', () => {
    expect(getColumnWidth('month')).toBe(120);
  });
});

describe('calculateTaskBar', () => {
  it('returns null when task has no dates', () => {
    const task = createTask();
    const result = calculateTaskBar(task, new Date('2025-01-01'), 'day', 40);

    expect(result).toBeNull();
  });

  it('calculates bar position for task with dates', () => {
    const task = createTask({
      startDate: new Date('2025-01-05'),
      dueDate: new Date('2025-01-10'),
    });
    const rangeStart = new Date('2025-01-01');
    const result = calculateTaskBar(task, rangeStart, 'day', 40);

    expect(result).not.toBeNull();
    expect(result!.start).toBe(4 * 40); // 4 days offset
    expect(result!.width).toBe(6 * 40); // 6 days duration (inclusive)
  });

  it('uses dueDate when startDate is missing', () => {
    const task = createTask({
      dueDate: new Date('2025-01-05'),
    });
    const rangeStart = new Date('2025-01-01');
    const result = calculateTaskBar(task, rangeStart, 'day', 40);

    expect(result).not.toBeNull();
    expect(result!.start).toBe(4 * 40);
    expect(result!.width).toBe(40); // minimum 1 day
  });
});

describe('getMonthHeaders', () => {
  it('groups day columns by month', () => {
    const start = new Date('2025-01-15');
    const end = new Date('2025-02-15');
    const columns = generateDateColumns(start, end, 'day');
    const headers = getMonthHeaders(columns, 'day');

    expect(headers.length).toBe(2);
    expect(headers[0].month).toContain('1月');
    expect(headers[1].month).toContain('2月');
  });

  it('returns one header per column for month view', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-03-31');
    const columns = generateDateColumns(start, end, 'month');
    const headers = getMonthHeaders(columns, 'month');

    expect(headers.length).toBe(3);
    headers.forEach((h) => expect(h.span).toBe(1));
  });
});

describe('getTodayPosition', () => {
  it('calculates today position in day view', () => {
    const today = new Date();
    const rangeStart = new Date(today);
    rangeStart.setDate(today.getDate() - 5);

    const position = getTodayPosition(rangeStart, 'day', 40);

    expect(position).toBe(5 * 40);
  });
});

describe('formatTaskDate', () => {
  it('returns dash for null date', () => {
    expect(formatTaskDate(null)).toBe('-');
  });

  it('formats date correctly', () => {
    const date = new Date('2025-01-15');
    expect(formatTaskDate(date)).toBe('1/15');
  });
});
