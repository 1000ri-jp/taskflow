import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { taskMatchesBoardFilters, type BoardFilters } from './filters';

const now = new Date(2026, 8, 2, 12);

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    listId: 'list-1',
    title: '確認するタスク',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const todayFilters: BoardFilters = {
  keyword: '',
  labelIds: new Set(),
  dueFilter: 'today',
  showCompleted: true,
};

describe('taskMatchesBoardFilters', () => {
  it('treats incomplete overdue and due-today tasks as today work', () => {
    expect(
      taskMatchesBoardFilters(createTask({ dueDate: new Date(2026, 8, 1) }), todayFilters, now)
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(createTask({ dueDate: new Date(2026, 8, 2, 18) }), todayFilters, now)
    ).toBe(true);
  });

  it('excludes completed and future tasks from today work', () => {
    expect(
      taskMatchesBoardFilters(
        createTask({ dueDate: new Date(2026, 8, 2), isCompleted: true }),
        todayFilters,
        now
      )
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(createTask({ dueDate: new Date(2026, 8, 3) }), todayFilters, now)
    ).toBe(false);
  });
});
