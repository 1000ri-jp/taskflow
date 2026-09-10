import { describe, expect, it } from 'vitest';
import { assigneeLabel, calendarTaskEntries, groupTaskOutline, resolveTaskView, sortTaskTable, taskDateLabel } from './taskViews';
import { viewList, viewTask } from '@/test/taskViewFixtures';

describe('task views', () => {
  it('resolves explicit URLs before saved views, with safe Kanban defaults', () => {
    expect(resolveTaskView('table', 'outline')).toBe('table');
    expect(resolveTaskView(null, 'outline')).toBe('outline');
    expect(resolveTaskView('bogus', 'calendar')).toBe('calendar');
    expect(resolveTaskView(null, 'bogus')).toBe('board');
  });
  it('groups real lists in order, independently of completion, without mutating shared data', () => {
    const lists = [viewList({ id: 'later', order: 2 }), viewList()];
    const tasks = [viewTask({ id: 'done', isCompleted: true }), viewTask({ id: 'active', order: 2 }), viewTask({ id: 'orphan', listId: 'gone' }), viewTask({ id: 'archive', isArchived: true })];
    const before = JSON.stringify({ lists, tasks });
    const groups = groupTaskOutline(tasks, lists);
    expect(groups.map(g => g.id)).toEqual(['list-1', 'later', '__unclassified__']);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['active', 'done']);
    expect(groups[2].tasks.map(t => t.id)).toEqual(['orphan']);
    expect(JSON.stringify({ lists, tasks })).toBe(before);
  });
  it('sorts outline tasks by earliest due date while keeping incomplete tasks first and missing dates last', () => {
    const tasks = [
      viewTask({ id: 'late', dueDate: new Date(2026, 8, 20), order: 0 }),
      viewTask({ id: 'early', dueDate: new Date(2026, 8, 3), order: 1 }),
      viewTask({ id: 'none', dueDate: null, order: 2 }),
      viewTask({ id: 'done', dueDate: new Date(2026, 7, 31), isCompleted: true, order: 3 }),
    ];
    expect(groupTaskOutline(tasks, [viewList()], 'due-asc')[0].tasks.map(task => task.id)).toEqual(['early', 'late', 'none', 'done']);
  });
  it('sorts actual dates in both directions, always puts missing/invalid dates last, and leaves input untouched', () => {
    const tasks = [viewTask({ id: 'none' }), viewTask({ id: 'late', dueDate: new Date(2026, 8, 10) }), viewTask({ id: 'early', dueDate: new Date(2026, 7, 31) }), viewTask({ id: 'invalid', dueDate: new Date('bad') })];
    expect(sortTaskTable(tasks, [], {}, { field: 'dueDate', direction: 'asc' }).map(t => t.id)).toEqual(['early', 'late', 'none', 'invalid']);
    expect(sortTaskTable(tasks, [], {}, { field: 'dueDate', direction: 'desc' }).map(t => t.id)).toEqual(['late', 'early', 'none', 'invalid']);
    expect(tasks.map(t => t.id)).toEqual(['none', 'late', 'early', 'invalid']);
    expect(taskDateLabel(new Date('bad'))).toBe('—');
  });
  it('sorts assignees and priorities without guessing unassigned names', () => {
    const tasks = [viewTask({ id: 'none' }), viewTask({ id: 'low', priority: 'low', assigneeIds: ['z'] }), viewTask({ id: 'high', priority: 'high', assigneeIds: ['a'] })];
    expect(sortTaskTable(tasks, [], {}, { field: 'priority', direction: 'asc' }).map(t => t.id)).toEqual(['high', 'low', 'none']);
    expect(sortTaskTable(tasks, [], { a: 'Alice', z: 'Zoe' }, { field: 'assignee', direction: 'desc' }).map(t => t.id)).toEqual(['low', 'high', 'none']);
    expect(assigneeLabel([], {})).toBe('未割当');
    expect(assigneeLabel(['missing'], {})).toBe('名前未取得');
  });
  it('separates start/due markers, merges same-day dates, and preserves undated tasks', () => {
    const tasks = [viewTask({ id: 'span', startDate: new Date(2026, 7, 31), dueDate: new Date(2026, 8, 3) }), viewTask({ id: 'same', startDate: new Date(2026, 8, 3, 1), dueDate: new Date(2026, 8, 3, 18) }), viewTask({ id: 'undated', startDate: new Date('bad') }), viewTask({ id: 'archived', dueDate: new Date(2026, 8, 3), isArchived: true })];
    const { entries, undated } = calendarTaskEntries(tasks);
    expect(entries.map(e => [e.task.id, e.kind])).toEqual([['span', '開始'], ['span', '期限'], ['same', '開始・期限']]);
    expect(undated.map(t => t.id)).toEqual(['undated']);
    expect(tasks[0].startDate).toEqual(new Date(2026, 7, 31));
  });
});
