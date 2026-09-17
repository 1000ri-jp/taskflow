import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { DndContext, DragEndEvent } from '@dnd-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRelations } from './TaskRelations';
import { viewTask } from '@/test/taskViewFixtures';
import { useAuthStore } from '@/stores/authStore';
import { sendWorkflow } from '@/lib/task/workflowClient';
vi.mock('@/lib/task/workflowClient',()=>({sendWorkflow:vi.fn()}));
const drag = vi.hoisted(() => ({ end: undefined as ((event: DragEndEvent) => void) | undefined }));
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return { ...actual, DndContext: (props: ComponentProps<typeof DndContext>) => {
    drag.end = props.onDragEnd;
    return <actual.DndContext {...props} />;
  } };
});
const parent=viewTask({id:'parent',title:'梱包確認'});
const child=viewTask({id:'child',title:'強度を確認',parentTaskId:'parent',assigneeIds:['a','b'],dueDate:new Date(2026,8,13)});
beforeEach(()=>{sessionStorage.clear();vi.mocked(sendWorkflow).mockReset().mockResolvedValue(null);useAuthStore.setState({user:{id:'me'} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});});
describe('adopted organization links',()=>{
  it('shows independent related tasks and deduplicates self/duplicate IDs',()=>{
    const task=viewTask({id:'current',title:'現在の仕事',relatedTaskIds:['current','next','next']});
    const next=viewTask({id:'next',title:'別々に完了する関連作業'});
    render(<TaskRelations task={task} tasks={[task,next]} names={{}}/>);
    expect(screen.getByRole('heading',{name:'関連する仕事'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'別々に完了する関連作業'})).toHaveAttribute('href','/projects/project-1/board?task=next');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
  it('exposes archived merged sources separately and keeps the link to the retained task',()=>{
    const kept=viewTask({id:'kept',title:'統合先',mergedFromTaskIds:['old']});
    const old=viewTask({id:'old',title:'元の案内文',isArchived:true,mergedIntoTaskId:'kept'});
    const {rerender}=render(<TaskRelations task={kept} tasks={[kept,old]} names={{}}/>);
    expect(screen.getByRole('button',{name:'元の案内文（保管済み）'})).toBeInTheDocument();
    rerender(<TaskRelations task={old} tasks={[kept,old]} names={{}}/>);
    expect(screen.getByRole('link',{name:'統合先'})).toHaveAttribute('href','/projects/project-1/board?task=kept');
  });
  it('keeps an original-record retrieval entry when archived originals are excluded by the active task query',()=>{
    const kept=viewTask({id:'kept',mergedFromTaskIds:['old'],relatedTaskIds:['missing']});
    render(<TaskRelations task={kept} tasks={[kept,viewTask({id:'missing',projectId:'outside',title:'他案件の非公開タイトル'})]} names={{}}/>);
    expect(screen.getByRole('button',{name:'統合元の記録 1を開く'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'関連する仕事を確認（一覧では未取得）'})).toBeInTheDocument();
    expect(screen.queryByText('他案件の非公開タイトル')).not.toBeInTheDocument();
  });
});


describe('inline subtask operations',()=>{
 it('orders completed and unfinished entries by date, undated last; reviews are not subtasks',async()=>{
  const entries=[parent,{...child,id:'late',title:'後',dueDate:new Date(2026,8,20)},{...child,id:'none',title:'なし',dueDate:null},{...child,id:'early',title:'先',isCompleted:true},{...child,id:'review',taskKind:'review_request' as const},{...child,id:'archive',isArchived:true}];
  const order=entries.map(t=>t.id);render(<TaskRelations task={parent} tasks={entries} names={{}}/>);
  await waitFor(()=>expect(screen.getByRole('checkbox',{name:'先を未完了に戻す'})).toBeEnabled());
  const list=screen.getByRole('list');expect(within(list).getAllByRole('listitem').map(row=>row.id)).toEqual(['task-subtask-early','task-subtask-late','task-subtask-none']);
  expect(within(list).queryByRole('link')).not.toBeInTheDocument();expect(entries.map(t=>t.id)).toEqual(order);
 });
 it('shows accessible drag handles and persists a reordered subtask sequence',async()=>{
  const later={...child,id:'later',title:'あとで行う',dueDate:new Date(2026,8,20)};
  const onReorderSubtasks=vi.fn().mockResolvedValue(undefined);
  render(<TaskRelations task={parent} tasks={[parent,child,later]} names={{}} onReorderSubtasks={onReorderSubtasks}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'強度を確認をドラッグして並べ替え'})).toBeEnabled());
  await act(async()=>drag.end?.({active:{id:'child'},over:{id:'later'}} as DragEndEvent));
  expect(onReorderSubtasks).toHaveBeenCalledExactlyOnceWith(['child','later'],['later','child']);
  expect(within(screen.getByRole('list',{name:'サブタスク一覧'})).getAllByRole('listitem').map(row=>row.id)).toEqual(['task-subtask-later','task-subtask-child']);
 });
 it('restores the original order and reports a failed reorder',async()=>{
  const later={...child,id:'later',title:'あとで行う',dueDate:new Date(2026,8,20)};
  const onReorderSubtasks=vi.fn().mockRejectedValue(new Error('オフライン'));
  render(<TaskRelations task={parent} tasks={[parent,child,later]} names={{}} onReorderSubtasks={onReorderSubtasks}/>);
  await act(async()=>drag.end?.({active:{id:'child'},over:{id:'later'}} as DragEndEvent));
  expect(await screen.findByRole('alert')).toHaveTextContent('オフライン');
  expect(within(screen.getByRole('list',{name:'サブタスク一覧'})).getAllByRole('listitem').map(row=>row.id)).toEqual(['task-subtask-child','task-subtask-later']);
 });
 it('saves a title inline and preserves unknown-response intent on retry',async()=>{
  vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('通信結果不明')).mockResolvedValueOnce(null);
  render(<TaskRelations task={parent} tasks={[parent,child]} names={{}}/>);
  const title=within(screen.getByRole('list')).getByRole('button',{name:'強度を確認'});await waitFor(()=>expect(title).toBeEnabled());fireEvent.click(title);
  const input=screen.getByRole('textbox',{name:'サブタスク名を編集'});fireEvent.change(input,{target:{value:'新しい名前'}});fireEvent.keyDown(input,{key:'Enter'});
  expect(await screen.findByRole('alert')).toHaveTextContent('通信結果不明');
  const first=vi.mocked(sendWorkflow).mock.calls[0];expect(first).toEqual(['project-1','child',expect.objectContaining({action:'edit_subtask',subtaskPatch:{title:'新しい名前'}})]);
  fireEvent.click(screen.getByRole('button',{name:'同じ操作を再試行'}));await waitFor(()=>expect(sendWorkflow).toHaveBeenCalledTimes(2));expect(vi.mocked(sendWorkflow).mock.calls[1]).toEqual(first);
 });
 it('archives only the selected child once and restores that same ID',async()=>{
  let finish!:(value:null)=>void;vi.mocked(sendWorkflow).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const sibling={...child,id:'sibling',title:'次の作業'};const {rerender}=render(<TaskRelations task={parent} tasks={[parent,child,sibling]} names={{}}/>);
  const remove=screen.getByRole('button',{name:'強度を確認を削除'});await waitFor(()=>expect(remove).toBeEnabled());fireEvent.click(remove);fireEvent.click(remove);
  expect(sendWorkflow).toHaveBeenCalledOnce();expect(remove).toBeDisabled();expect(within(screen.getByRole('list')).getByRole('button',{name:'次の作業'})).toBeVisible();
  await act(async()=>finish(null));rerender(<TaskRelations task={parent} tasks={[parent,{...child,isArchived:true},sibling]} names={{}}/>);
  const restore=screen.getByRole('button',{name:'元に戻す'});await waitFor(()=>expect(restore).toBeEnabled());fireEvent.click(restore);
  await waitFor(()=>expect(sendWorkflow).toHaveBeenLastCalledWith('project-1','child',expect.objectContaining({action:'restore'})));
 });
 it('does not confuse an ordinary completion with review approval',async()=>{
  render(<TaskRelations task={parent} tasks={[parent,child]} names={{}}/>);const check=screen.getByRole('checkbox',{name:'強度を確認を完了にする'});await waitFor(()=>expect(check).toBeEnabled());fireEvent.click(check);await waitFor(()=>expect(sendWorkflow).toHaveBeenCalledWith('project-1','child',expect.objectContaining({action:'complete'})));
 });
});


describe('subtask due date', () => {
 async function openCalendar() {
  const trigger = screen.getByRole('button', { name: '強度を確認の期日' });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return screen.getByRole('dialog');
 }
 it('saves on date selection, prevents duplicate writes, and closes after confirmation', async () => {
  let finish!: (value: null) => void;
  vi.mocked(sendWorkflow).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<TaskRelations task={parent} tasks={[parent, child]} names={{}} />);
  const calendar = await openCalendar();
  expect(within(calendar).queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  fireEvent.click(within(calendar).getByText('17'));
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledExactlyOnceWith('project-1', 'child', expect.objectContaining({
   action: 'edit_subtask', subtaskPatch: { dueDate: '2026-09-17' },
  })));
  expect(within(calendar).getByRole('button', { name: '期日を外す' })).toBeDisabled();
  fireEvent.click(within(calendar).getByText('18'));
  expect(sendWorkflow).toHaveBeenCalledOnce();
  await act(async () => finish(null));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerender(<TaskRelations task={parent} tasks={[parent, { ...child, dueDate: new Date(2026, 8, 17) }]} names={{}} />);
  expect(screen.getByRole('button', { name: '強度を確認の期日' })).toHaveTextContent('9/17');
  expect(sessionStorage.length).toBe(0);
 });
 it('removes the date immediately without a separate save', async () => {
  render(<TaskRelations task={parent} tasks={[parent, child]} names={{}} />);
  const calendar = await openCalendar();
  fireEvent.click(within(calendar).getByRole('button', { name: '期日を外す' }));
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledExactlyOnceWith('project-1', 'child', expect.objectContaining({
   action: 'edit_subtask', subtaskPatch: { dueDate: null },
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 });
 it('keeps the saved date after a rejection and allows a corrected selection', async () => {
  vi.mocked(sendWorkflow).mockRejectedValueOnce(Object.assign(new Error('最新の状態を確認してください。'), { code: 'workflow-rejected' }));
  render(<TaskRelations task={parent} tasks={[parent, child]} names={{}} />);
  const calendar = await openCalendar();
  fireEvent.click(within(calendar).getByText('17'));
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledOnce());
  expect(await screen.findByText('最新の状態を確認してください。')).toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
  expect(within(calendar).getByRole('gridcell', { selected: true })).toHaveTextContent('13');
  fireEvent.click(within(calendar).getByText('18'));
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledTimes(2));
  expect(sendWorkflow).toHaveBeenLastCalledWith('project-1', 'child', expect.objectContaining({ subtaskPatch: { dueDate: '2026-09-18' } }));
 });
});
