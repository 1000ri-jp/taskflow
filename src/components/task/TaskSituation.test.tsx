import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { TaskSituation } from './TaskSituation';

describe('task detail subtask progress', () => {
  const task = viewTask({ id: 'parent' });
  const pending = viewTask({ id: 'pending', parentTaskId: task.id, taskKind: 'review_request' });
  const completed = viewTask({ id: 'completed', parentTaskId: task.id, isCompleted: true });
  it('counts only direct, unarchived subtasks in the current project', () => {
    const tasks = [task, pending, completed,
      { ...completed, id: 'archived', isArchived: true },
      { ...completed, id: 'foreign', projectId: 'elsewhere' },
      { ...completed, id: 'grandchild', parentTaskId: pending.id },
    ];
    const { rerender } = render(<TaskSituation task={task} tasks={tasks} names={{}} />);
    expect(screen.getByText('サブタスク 1/1件完了')).toBeVisible();
    expect(screen.getByText('返答・確認待ち（1件）')).toBeVisible();
    rerender(<TaskSituation task={task} tasks={tasks.filter(item => item.id !== completed.id)} names={{}} />);
    expect(screen.queryByText(/サブタスク.*件完了/)).not.toBeInTheDocument();
  });
  it('shows the count only once when it is also the current situation', () => {
    render(<TaskSituation task={task} tasks={[task, { ...pending, taskKind: undefined }, completed]} names={{}} />);
    expect(screen.getAllByText('サブタスク 1/2件完了')).toHaveLength(1);
  });
  it('omits the counter when no subtasks exist', () => {
    render(<TaskSituation task={task} tasks={[task]} names={{}} />);
    expect(screen.queryByText(/サブタスク.*件完了/)).not.toBeInTheDocument();
  });
});

it('does not count an approved confirmation as a completed subtask',()=>{
 const parent=viewTask({id:'p'}),child=viewTask({id:'c',parentTaskId:'p'});
 const review=viewTask({id:'r',parentTaskId:'p',taskKind:'review_request',isCompleted:true});
 render(<TaskSituation task={parent} tasks={[parent,child,review]} names={{}}/>);
 expect(screen.getAllByText('サブタスク 0/1件完了')).toHaveLength(1);expect(screen.queryByText('サブタスク 1/2件完了')).not.toBeInTheDocument();
});
