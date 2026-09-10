import type { List, Task } from '@/types';

export const viewTask = (data: Partial<Task> = {}): Task => ({
  id: 'task-1', projectId: 'project-1', listId: 'list-1', title: '出展準備', description: '', order: 0,
  assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
  startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false,
  isCompleted: false, completedAt: null, isAbandoned: false,
  isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'user-1',
  createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1), ...data,
});
export const viewList = (data: Partial<List> = {}): List => ({
  id: 'list-1', projectId: 'project-1', name: '東京ゲームダンジョン', color: '#2563eb', order: 0,
  autoCompleteOnEnter: false, autoUncompleteOnExit: false, autoSetStartDateOnEnter: false,
  createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1), ...data,
});
