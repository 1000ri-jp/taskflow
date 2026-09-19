import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { buildProjectProgress } from './progress';

describe('project task progress', () => {
  const now = new Date(2026, 8, 12, 12);

  it('counts all participants and children, excluding archived and abandoned work', () => {
    const tasks = [
      viewTask({ id: 'parent', assigneeIds: ['other'] }),
      viewTask({ id: 'child', parentTaskId: 'parent', isCompleted: true }),
      viewTask({ id: 'archived', isArchived: true }),
      viewTask({ id: 'abandoned', isAbandoned: true }),
      viewTask({ id: 'elsewhere', projectId: 'other-project' }),
    ];
    const summaries = buildProjectProgress(['project-1', 'empty'], tasks, now);
    expect(summaries.get('project-1')).toEqual({ total: 2, completed: 1, remaining: 1, overdue: 0 });
    expect(summaries.get('empty')).toEqual({ total: 0, completed: 0, remaining: 0, overdue: 0 });
    expect(summaries.has('other-project')).toBe(false);
  });

  it('counts only unfinished tasks before today as overdue and recalculates after midnight', () => {
    const tasks = [
      viewTask({ id: 'yesterday', dueDate: new Date(2026, 8, 11, 23, 59) }),
      viewTask({ id: 'today', dueDate: new Date(2026, 8, 12) }),
      viewTask({ id: 'later', dueDate: new Date(2026, 8, 14) }),
      viewTask({ id: 'no-date' }),
      viewTask({ id: 'done', isCompleted: true, dueDate: new Date(2026, 8, 10) }),
    ];
    expect(buildProjectProgress(['project-1'], tasks, now).get('project-1')).toEqual({ total: 5, completed: 1, remaining: 4, overdue: 1 });
    expect(buildProjectProgress(['project-1'], tasks, new Date(2026, 8, 13)).get('project-1')?.overdue).toBe(2);
  });
});
