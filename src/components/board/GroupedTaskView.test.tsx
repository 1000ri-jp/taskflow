import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GroupedTaskView } from './GroupedTaskView';
import { viewTask } from '@/test/taskViewFixtures';
import type { Milestone } from '@/types';
vi.mock('@/hooks/useMeetingMembers',()=>({useMeetingMembers:()=>({users:[{id:'a',displayName:'A'},{id:'b',displayName:'B'}]})}));
it('groups the same task IDs without changing their saved list, workers or dates',()=>{
 const task=viewTask({id:'work',title:'チラシ制作',assigneeIds:['a','b'],completionCriteria:'入稿'});const before=structuredClone(task), open=vi.fn();
 const props={tasks:[task],allTasks:[task],milestones:[{id:'m',title:'入稿完了',requiredTaskIds:['work']} as Milestone],onTaskClick:open};
 const ui=render(<GroupedTaskView {...props} groupBy="assignee" />);expect(screen.getAllByRole('button',{name:/チラシ制作/})).toHaveLength(2);
 fireEvent.click(screen.getAllByRole('button',{name:/チラシ制作/})[0]);expect(open).toHaveBeenCalledWith('work');
 ui.rerender(<GroupedTaskView {...props} groupBy="purpose" />);expect(screen.getByRole('heading',{name:'入稿完了 1件'})).toBeVisible();expect(task).toEqual(before);
});
