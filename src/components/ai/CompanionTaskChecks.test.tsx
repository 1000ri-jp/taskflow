import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CompanionTaskChecks, taskCheckKey } from './CompanionTaskChecks';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { planWorkflow } from '@/lib/task/workflow';
import { recurrenceRequest } from '@/lib/task/recurrenceClient';
import { viewTask } from '@/test/taskViewFixtures';
const state = vi.hoisted(() => ({ tasks: [] as unknown[], failed: false }));
vi.mock('@/hooks/useMyTasks', () => ({ useMyTasks: () => ({ allProjectTasks: state.tasks, projects: [{id:'project-1',ownerId:'me'}], isLoading: false, error: null, projectTaskStatus: new Map([['project-1',{status:state.failed ? 'error' : 'ready'}]]) }) }));
vi.mock('@/lib/task/recurrenceClient', async original => ({ ...await original<typeof import('@/lib/task/recurrenceClient')>(), recurrenceRequest: vi.fn() }));
vi.mock('@/lib/task/workflowClient',()=>({sendWorkflow:vi.fn(async()=>null)}));
const parent = () => ({ ...viewTask({ id:'p', title:'オンライン重説', isCompleted:true, completedAt:new Date('2026-09-15T01:00:00Z') }),projectName:'JIMU',listName:'Bセールス' });
const child = (id:string) => ({ ...parent(), id, parentTaskId:'p', title:id === 'a' ? '資料作成' : '内容確認', isCompleted:false, completedAt:null });
const ui = () => <CompanionTaskChecks userId="me">{check => check}</CompanionTaskChecks>;
const openCheck = () => fireEvent.click(screen.getByText('オンライン重説 · 未完了サブタスク 2件'));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); state.failed=false; state.tasks=[parent(),child('a'),child('b')]; vi.mocked(recurrenceRequest).mockResolvedValue(undefined); });
it('shows parent, actual remaining work and reply choices; saves only after an explicit answer and disappears on live completion', async () => {
  const view=render(ui());
  expect(screen.getByText('オンライン重説 · 未完了サブタスク 2件')).toBeVisible();
  expect(screen.getByRole('region', { name: 'モアイからの確認' })).not.toBeVisible();
  openCheck();
  expect(screen.getByRole('region',{name:'モアイからの確認'})).toHaveTextContent('オンライン重説');
  expect(screen.getByText('・資料作成')).toBeVisible(); expect(screen.getByText('・内容確認')).toBeVisible();
  expect(recurrenceRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'サブタスクを完了にする'}));
  await waitFor(()=>expect(recurrenceRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(recurrenceRequest).mock.calls.map(call=>call.slice(0,2))).toEqual([['project-1','a'],['project-1','b']]);
  state.tasks=[parent(),{...child('a'),isCompleted:true},{...child('b'),isCompleted:true}]; view.rerender(ui());
  expect(screen.getByRole('status')).toHaveTextContent('サブタスク2件を完了にしました');
  fireEvent.click(screen.getByRole('button',{name:'閉じる'}));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
it('defers the same condition for one hour but reconsiders relevant changes', () => {
  const initial=render(ui());
  openCheck();
  fireEvent.click(screen.getByRole('button',{name:'1時間後'}));
  expect(screen.queryByRole('region')).not.toBeInTheDocument(); expect(recurrenceRequest).not.toHaveBeenCalled();
  initial.unmount();
  const view=render(ui()); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(taskCheckKey(parent(),[child('a')])).toEqual(taskCheckKey({...parent(),updatedAt:new Date()},[{...child('a'),updatedAt:new Date()}]));
  state.tasks=[parent(),{...child('a'),dueDate:new Date('2026-10-01')},child('b')]; view.rerender(ui());
  expect(screen.getByText('オンライン重説 · 未完了サブタスク 2件')).toBeVisible();
  openCheck(); expect(screen.getByRole('region')).toBeVisible();
});
it('keeps failed saves visible and retries only work not already saved', async () => {
  vi.mocked(recurrenceRequest).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('接続できません'));
  render(ui()); openCheck(); fireEvent.click(screen.getByRole('button',{name:'サブタスクを完了にする'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('接続できません');
  expect(screen.getByText('✓ 資料作成')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'残りのサブタスクを完了にする'}));
  await waitFor(()=>expect(recurrenceRequest).toHaveBeenCalledTimes(3));
  expect(vi.mocked(recurrenceRequest).mock.calls[2][1]).toBe('b');
});
it('keeps completing the explicitly chosen group when the first saved child leaves live results', async () => {
  let finish!:()=>void;
  vi.mocked(recurrenceRequest).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(ui()); openCheck(); fireEvent.click(screen.getByRole('button',{name:'サブタスクを完了にする'}));
  state.tasks=[parent(),{...child('a'),isCompleted:true},child('b')]; view.rerender(ui());
  await act(async()=>finish()); await waitFor(()=>expect(recurrenceRequest).toHaveBeenCalledTimes(2));
});
it('does not use a failed project snapshot as evidence',()=>{state.failed=true; render(ui());expect(screen.queryByText(/未完了サブタスク/)).not.toBeInTheDocument();});

it('returns a completed parent to started and keeps the saved result visible after a live update', async()=>{
 const view=render(ui());
 openCheck();
 fireEvent.click(screen.getByRole('button',{name:'親を着手に戻す'}));
 await waitFor(()=>expect(sendWorkflow).toHaveBeenCalledOnce());
 const input=vi.mocked(sendWorkflow).mock.calls[0][2];
 expect(input).toMatchObject({action:'start',expectedVersion:parent().updatedAt.toISOString()});
 expect(vi.mocked(sendWorkflow).mock.calls[0].slice(0,2)).toEqual(['project-1','p']);
 const plan=planWorkflow(parent(),[parent(),child('a'),child('b')],'me',input,new Date());
 expect(plan.patch).toEqual({isCompleted:false,completedAt:null,workProgress:'started'});
 state.tasks=[{...parent(),...plan.patch},child('a'),child('b')]; view.rerender(ui());
 expect(await screen.findByRole('status')).toHaveTextContent('「着手」に戻しました');
 expect(recurrenceRequest).not.toHaveBeenCalled();
});
it('retains an uncertain reopen attempt for a safe retry without dismissing the check',async()=>{
 vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('接続できません'));
 render(ui());openCheck();fireEvent.click(screen.getByRole('button',{name:'親を着手に戻す'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('接続できません');
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'親を着手に戻す'}));
 await waitFor(()=>expect(sendWorkflow).toHaveBeenCalledTimes(2));
 expect(vi.mocked(sendWorkflow).mock.calls[1][2]).toEqual(vi.mocked(sendWorkflow).mock.calls[0][2]);
 expect(await screen.findByRole('status')).toHaveTextContent('「着手」に戻しました');
});

it('finishes an explicitly requested save if the user opens the chat while it is saving',async()=>{
 let finish!:()=>void;
 vi.mocked(recurrenceRequest).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const visible=(show:boolean)=><CompanionTaskChecks userId="me">{check=>show?check:null}</CompanionTaskChecks>;
 const view=render(visible(true));openCheck();fireEvent.click(screen.getByRole('button',{name:'サブタスクを完了にする'}));
 view.rerender(visible(false)); await act(async()=>finish());
 await waitFor(()=>expect(recurrenceRequest).toHaveBeenCalledTimes(2));
 state.tasks=[parent(),{...child('a'),isCompleted:true},{...child('b'),isCompleted:true}];
 view.rerender(visible(true));expect(screen.getByRole('status')).toHaveTextContent('サブタスク2件を完了にしました');
});
