import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationLabBoard } from './useOrganizationLabBoard';
import { addMeetingMultiExampleData, MULTI_PROGRESS_TASK_ID } from '@/lib/task/meetingMultiExample';
import { organizationMockKey, readOrganizationMock } from '@/lib/task/organizationMock';
const state=vi.hoisted(()=>({tasks:[] as Record<string,unknown>[]}));
vi.mock('@/stores/authStore',()=>({useAuthStore:(select:(v:unknown)=>unknown)=>select({user:{id:'e2e-mock-user'}})}));
vi.mock('./useOrganizationLabTasks',()=>({useOrganizationLabTasks:()=>({allProjectTasks:state.tasks.length?state.tasks:[],isLoading:false,error:null})}));
afterEach(()=>{cleanup();state.tasks=[];});
describe('mock board render stability',()=>{
 it('keeps empty lists referentially stable while the async workbench is loading',()=>{const {result,rerender}=renderHook(()=>useOrganizationLabBoard(true,'secretary-demo'));const lists=result.current.lists;const tasks=result.current.tasks;rerender();expect(result.current.lists).toBe(lists);expect(result.current.tasks).toBe(tasks);});
 it('keeps populated lists stable between local UI renders and exposes archived originals for detail lookup',()=>{state.tasks=[{id:'t',projectId:'secretary-demo',listId:'doing',isArchived:true}];const {result,rerender}=renderHook(()=>useOrganizationLabBoard(true,'secretary-demo'));const lists=result.current.lists;rerender();expect(result.current.lists).toBe(lists);expect(result.current.tasks).toHaveLength(0);expect(result.current.allTasks).toHaveLength(1);});
 it('uses a list primary assignee ahead of the project primary assignee for new mock tasks',async()=>{
  const projectId='secretary-demo';
  const work=readOrganizationMock(projectId);
  work.data.defaultAssigneeId='demo-colleague';
  work.lists=[{id:'doing',projectId,name:'進行中',color:'#64748b',order:0,autoCompleteOnEnter:false,autoUncompleteOnExit:false,autoSetStartDateOnEnter:false,defaultAssigneeId:'e2e-mock-user',createdAt:new Date(),updatedAt:new Date()}];
  localStorage.setItem(organizationMockKey(projectId),JSON.stringify(work));
  vi.stubGlobal('navigator',{locks:{request:async(_key:string,run:()=>unknown)=>run()}});
  try{
   const {result}=renderHook(()=>useOrganizationLabBoard(true,projectId));
   const id=await result.current.addTask('doing','列の主担当テスト','e2e-mock-user');
   expect(readOrganizationMock(projectId).data.tasks[id].assigneeIds).toEqual(['e2e-mock-user']);
  }finally{localStorage.removeItem(organizationMockKey(projectId));vi.unstubAllGlobals();}
 });
});

it('edits only the selected allowed office workbench and refuses other project ids', async () => {
 const office = 'secretary-demo-office';
 const work = readOrganizationMock(office); addMeetingMultiExampleData(work.data, office);
 localStorage.setItem(organizationMockKey(office), JSON.stringify(work));
 vi.stubGlobal('navigator', { locks: { request: async (_key: string, run: () => unknown) => run() } });
 try {
  const { result } = renderHook(() => useOrganizationLabBoard(true, office));
  await result.current.editTask(MULTI_PROGRESS_TASK_ID, { description: '総務で確認した更新' });
  expect(readOrganizationMock(office).data.tasks[MULTI_PROGRESS_TASK_ID].description).toBe('総務で確認した更新');
  const other = renderHook(() => useOrganizationLabBoard(true, 'unrelated-project'));
  await expect(other.result.current.editTask(MULTI_PROGRESS_TASK_ID, { description: '変更' })).rejects.toThrow('対象ではありません');
  expect(localStorage.getItem(organizationMockKey('unrelated-project'))).toBeNull();
 } finally { localStorage.removeItem(organizationMockKey(office)); vi.unstubAllGlobals(); }
});
