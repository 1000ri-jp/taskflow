import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { groupTaskFamilies, taskRoots, tasksInList } from './taskHierarchy';
import { taskMatchesBoardFilters } from './filters';

describe('task families', () => {
  const parent = viewTask({ id: 'parent', listId: 'a', assigneeIds: [] });
  const child = viewTask({ id: 'child', parentTaskId: 'parent', listId: 'b', assigneeIds: ['me', 'other'] });
  it('counts a parent once, keeping a child in another list without changing either task', () => {
    const tasks = [parent, child];
    expect(groupTaskFamilies(tasks)).toEqual([{ task: parent, children: [child], isContext: false }]);
    expect(tasksInList(tasks, 'a')).toEqual(tasks);
    expect(groupTaskFamilies(tasksInList(tasks, 'b'), tasks)).toEqual([{ task: parent, children: [child], isContext: true }]);
    expect(child.listId).toBe('b');
  });
  it('retains the parent for an own child, including a completed parent', () => {
    const tasks = [{ ...parent, isCompleted: true }, child];
    const visible = tasks.filter(task => taskMatchesBoardFilters(task, { keyword: '', labelIds: new Set(), dueFilter: 'all', showCompleted: false, assigneeId: 'me' }));
    const families = groupTaskFamilies(visible, tasks);
    expect(families).toHaveLength(1);
    expect(families[0].task.id).toBe('parent');
    expect(families[0].task.isCompleted).toBe(true);
    expect(families[0].children).toEqual([child]);
    expect(families[0].isContext).toBe(true);
  });
  it('keeps accessible children when parents are missing, archived, or from another project', () => {
    for (const tasks of [[child], [{ ...parent, isArchived: true }, child], [{ ...parent, projectId: 'elsewhere' }, child]]) {
      expect(groupTaskFamilies([child], tasks)[0].task).toBe(child);
    }
  });
  it('does not drop or duplicate cycles or deeply nested descendants', () => {
    const a = viewTask({ id: 'a', parentTaskId: 'b' });
    const b = viewTask({ id: 'b', parentTaskId: 'a' });
    const c = viewTask({ id: 'c', parentTaskId: 'b' });
    for (const tasks of [[a, b, c], [c, b, a]]) {
      expect([...taskRoots(tasks).values()].every(root => root.id === 'a')).toBe(true);
      const families = groupTaskFamilies(tasks);
      expect(families).toHaveLength(1);
      expect(new Set([families[0].task.id, ...families[0].children.map(child => child.id)])).toEqual(new Set(['a', 'b', 'c']));
    }
    const grandchild = viewTask({ id: 'grandchild', parentTaskId: child.id });
    expect(groupTaskFamilies([grandchild], [parent, child, grandchild])[0].task.id).toBe(parent.id);
  });
});


describe('task families with archives', () => {
  it.each([false, true])('retains archived descendants under an archived=%s parent without changing task data', (archived) => {
    const parent = viewTask({ id: 'parent', isArchived: archived });
    const child = viewTask({ id: 'child', parentTaskId: parent.id, isArchived: true });
    const tasks = [parent, child];
    const original = structuredClone(tasks);
    expect(groupTaskFamilies(tasks, tasks, { includeArchived: true })).toEqual([{ task: parent, children: [child], isContext: false }]);
    expect(groupTaskFamilies([child], tasks, { includeArchived: true })).toEqual([{ task: parent, children: [child], isContext: true }]);
    expect(tasks).toEqual(original);
  });
});
