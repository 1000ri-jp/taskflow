import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { NeoTaskAttention } from './NeoTaskAttention';
import { completedParentIssues } from '@/lib/dashboard/task-attention';
import { viewTask } from '@/test/taskViewFixtures';
const parent = {...viewTask({id:'p',title:'オンライン重説',isCompleted:true}),projectName:'JIMU委託',listName:'Bセールス'};
const child = {...parent,id:'c',parentTaskId:'p',title:'重説内容確認',isCompleted:false};
const props = {tasks:[parent,child],userId:'me',isLoading:false,error:null,projectTaskStatus:new Map([['project-1',{status:'ready' as const}]])};
it('shows the mismatch, list and unfinished children without opening the task; disappears when resolved', () => {
  const view=render(<NeoTaskAttention {...props} />);
  const region=screen.getByRole('region',{name:'完了状態の確認'});
  expect(within(region).getByText('親：完了 ／ サブタスク：未完了 1件')).toBeVisible();
  expect(within(region).getByText('JIMU委託 / Bセールス')).toBeVisible();
  expect(within(region).getByRole('link',{name:'重説内容確認'})).toHaveAttribute('href','/projects/project-1/board?task=c');
  view.rerender(<NeoTaskAttention {...props} tasks={[parent,{...child,isCompleted:true}]} />);
  expect(screen.queryByRole('region',{name:'完了状態の確認'})).not.toBeInTheDocument();
});
it('does not confuse matching IDs across projects, cancelled/archive/review children or unavailable parents', () => {
  expect(completedParentIssues([parent,{...child,projectId:'other'},{...child,id:'cancelled',isAbandoned:true},{...child,id:'archive',isArchived:true},{...child,id:'review',taskKind:'review_request'}])).toEqual([]);
  expect(completedParentIssues([{...parent,isArchived:true},child])).toEqual([]);
  expect(completedParentIssues([{...parent,isCompleted:false},child])).toEqual([]);
  render(<NeoTaskAttention {...props} projectTaskStatus={new Map([['project-1',{status:'error',error:new Error('offline')}]])} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
