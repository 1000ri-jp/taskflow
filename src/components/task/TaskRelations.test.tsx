import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskRelations } from './TaskRelations';
import { viewTask } from '@/test/taskViewFixtures';
import { notificationTaskHref } from '@/lib/task/commentSubmission';
const parent = viewTask({ id:'parent',title:'梱包確認' });
const child = viewTask({ id:'child',title:'強度を確認',parentTaskId:'parent',sourceCommentId:'c',taskKind:'review_request',assigneeIds:['a','b'],dueDate:new Date(2026,8,13) });
describe('shared review task links', () => {
  it('shows shared children inside the parent, with completion/assignee/deadline', () => {
    render(<TaskRelations task={parent} tasks={[parent,child,{...child,id:'archive',isArchived:true}]} names={{a:'Nao',b:'Kaori'}} />);
    expect(screen.getByRole('heading')).toHaveTextContent('1件');
    expect(screen.getByRole('link')).toHaveAttribute('href','/projects/project-1/board?task=child');
    expect(screen.getByLabelText('TaskFlow 確認依頼中')).toBeInTheDocument();
    expect(screen.getByText('確認依頼中')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveTextContent('Nao・Kaori');
    expect(screen.getByRole('link')).toHaveTextContent('2026/9/13');
  });
  it('links a child back to the parent and precise original comment', () => {
    render(<TaskRelations task={child} tasks={[parent,child]} names={{}} />);
    expect(screen.getByRole('link',{name:'親タスク：梱包確認'})).toHaveAttribute('href','/projects/project-1/board?task=parent');
    expect(screen.getByRole('link',{name:'元コメントを開く'})).toHaveAttribute('href','/projects/project-1/board?task=parent&comment=c');
  });
  it('routes comment notifications to the comment and review notifications to the child', () => {
    expect(notificationTaskHref({projectId:'p',taskId:'parent',type:'comment_added',data:{commentId:'c'}})).toBe('/projects/p/board?task=parent&comment=c');
    expect(notificationTaskHref({projectId:'p',taskId:'child',type:'review_requested',data:{commentId:'c'}})).toBe('/projects/p/board?task=child');
  });
});
