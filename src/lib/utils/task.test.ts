import { describe, it, expect } from 'vitest';
import {
  sortTasksByDueDate,
  sortTasksByPriority,
  sortTasksByOrder,
  filterTasksByLabel,
  filterTasksByAssignee,
  filterOverdueTasks,
  filterTasksDueSoon,
  getTaskProgress,
  isTaskOverdue,
} from './task';
import type { Task } from '@/types';

// Helper to create mock task
const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  projectId: 'project-1',
  listId: 'list-1',
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
  createdBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('sortTasksByDueDate', () => {
  it('should sort tasks by due date in ascending order', () => {
    const tasks = [
      createMockTask({ id: '1', dueDate: new Date('2024-12-20') }),
      createMockTask({ id: '2', dueDate: new Date('2024-12-15') }),
      createMockTask({ id: '3', dueDate: new Date('2024-12-25') }),
    ];
    const sorted = sortTasksByDueDate(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['2', '1', '3']);
  });

  it('should place tasks without due date at the end', () => {
    const tasks = [
      createMockTask({ id: '1', dueDate: null }),
      createMockTask({ id: '2', dueDate: new Date('2024-12-15') }),
      createMockTask({ id: '3', dueDate: null }),
    ];
    const sorted = sortTasksByDueDate(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['2', '1', '3']);
  });

  it('should handle empty array', () => {
    expect(sortTasksByDueDate([])).toEqual([]);
  });
});

describe('sortTasksByPriority', () => {
  it('should sort tasks by priority (high > medium > low)', () => {
    const tasks = [
      createMockTask({ id: '1', priority: 'low' }),
      createMockTask({ id: '2', priority: 'high' }),
      createMockTask({ id: '3', priority: 'medium' }),
    ];
    const sorted = sortTasksByPriority(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['2', '3', '1']);
  });

  it('should place tasks without priority at the end', () => {
    const tasks = [
      createMockTask({ id: '1', priority: null }),
      createMockTask({ id: '2', priority: 'high' }),
      createMockTask({ id: '3', priority: null }),
    ];
    const sorted = sortTasksByPriority(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['2', '1', '3']);
  });
});

describe('sortTasksByOrder', () => {
  it('should sort tasks by order in ascending order', () => {
    const tasks = [
      createMockTask({ id: '1', order: 2 }),
      createMockTask({ id: '2', order: 0 }),
      createMockTask({ id: '3', order: 1 }),
    ];
    const sorted = sortTasksByOrder(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['2', '3', '1']);
  });
});

describe('filterTasksByLabel', () => {
  it('should return tasks that have the specified label', () => {
    const tasks = [
      createMockTask({ id: '1', labelIds: ['bug', 'urgent'] }),
      createMockTask({ id: '2', labelIds: ['feature'] }),
      createMockTask({ id: '3', labelIds: ['bug'] }),
    ];
    const filtered = filterTasksByLabel(tasks, 'bug');
    expect(filtered.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('should return empty array when no tasks match', () => {
    const tasks = [
      createMockTask({ id: '1', labelIds: ['feature'] }),
    ];
    expect(filterTasksByLabel(tasks, 'bug')).toEqual([]);
  });
});

describe('filterTasksByAssignee', () => {
  it('should return tasks assigned to the specified user', () => {
    const tasks = [
      createMockTask({ id: '1', assigneeIds: ['user-1', 'user-2'] }),
      createMockTask({ id: '2', assigneeIds: ['user-3'] }),
      createMockTask({ id: '3', assigneeIds: ['user-1'] }),
    ];
    const filtered = filterTasksByAssignee(tasks, 'user-1');
    expect(filtered.map((t) => t.id)).toEqual(['1', '3']);
  });
});

describe('filterOverdueTasks', () => {
  it('should return tasks with due date in the past', () => {
    const now = new Date('2024-12-16');
    const tasks = [
      createMockTask({ id: '1', dueDate: new Date('2024-12-10') }), // overdue
      createMockTask({ id: '2', dueDate: new Date('2024-12-20') }), // not overdue
      createMockTask({ id: '3', dueDate: new Date('2024-12-15') }), // overdue
      createMockTask({ id: '4', dueDate: null }), // no due date
    ];
    const filtered = filterOverdueTasks(tasks, now);
    expect(filtered.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('should not include completed tasks', () => {
    const now = new Date('2024-12-16');
    const tasks = [
      createMockTask({ id: '1', dueDate: new Date('2024-12-10'), isCompleted: true }),
      createMockTask({ id: '2', dueDate: new Date('2024-12-10'), isCompleted: false }),
    ];
    const filtered = filterOverdueTasks(tasks, now);
    expect(filtered.map((t) => t.id)).toEqual(['2']);
  });
});

describe('filterTasksDueSoon', () => {
  it('should return tasks due within specified days', () => {
    const now = new Date('2024-12-16');
    const tasks = [
      createMockTask({ id: '1', dueDate: new Date('2024-12-17') }), // 1 day
      createMockTask({ id: '2', dueDate: new Date('2024-12-20') }), // 4 days
      createMockTask({ id: '3', dueDate: new Date('2024-12-18') }), // 2 days
      createMockTask({ id: '4', dueDate: new Date('2024-12-10') }), // past
    ];
    const filtered = filterTasksDueSoon(tasks, 3, now);
    expect(filtered.map((t) => t.id)).toEqual(['1', '3']);
  });
});

describe('getTaskProgress', () => {
  it('should calculate progress from checklist items', () => {
    const checklistItems = [
      { id: '1', text: 'Item 1', isChecked: true, order: 0 },
      { id: '2', text: 'Item 2', isChecked: false, order: 1 },
      { id: '3', text: 'Item 3', isChecked: true, order: 2 },
      { id: '4', text: 'Item 4', isChecked: false, order: 3 },
    ];
    const progress = getTaskProgress(checklistItems);
    expect(progress).toEqual({ completed: 2, total: 4, percentage: 50 });
  });

  it('should return 0% for empty checklist', () => {
    const progress = getTaskProgress([]);
    expect(progress).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('should return 100% when all items are checked', () => {
    const checklistItems = [
      { id: '1', text: 'Item 1', isChecked: true, order: 0 },
      { id: '2', text: 'Item 2', isChecked: true, order: 1 },
    ];
    const progress = getTaskProgress(checklistItems);
    expect(progress).toEqual({ completed: 2, total: 2, percentage: 100 });
  });
});

describe('isTaskOverdue', () => {
  it('should return true for overdue task', () => {
    const task = createMockTask({ dueDate: new Date('2024-12-10') });
    expect(isTaskOverdue(task, new Date('2024-12-16'))).toBe(true);
  });

  it('should return false for task not yet due', () => {
    const task = createMockTask({ dueDate: new Date('2024-12-20') });
    expect(isTaskOverdue(task, new Date('2024-12-16'))).toBe(false);
  });

  it('should return false for task without due date', () => {
    const task = createMockTask({ dueDate: null });
    expect(isTaskOverdue(task, new Date('2024-12-16'))).toBe(false);
  });

  it('should return false for completed task', () => {
    const task = createMockTask({ dueDate: new Date('2024-12-10'), isCompleted: true });
    expect(isTaskOverdue(task, new Date('2024-12-16'))).toBe(false);
  });
});
