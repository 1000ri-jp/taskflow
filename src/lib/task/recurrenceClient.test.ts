import { expect, it, vi } from 'vitest';
import { recurrenceRequest } from './recurrenceClient';
import { organizationMockKey, readOrganizationMock } from './organizationMock';
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>true}));
it('saves recurrence, completes once, preserves the next instance and disables future repetition',async()=>{
 const projectId='secretary-demo';const key=organizationMockKey(projectId);const state=readOrganizationMock(projectId);const taskId=Object.keys(state.data.tasks)[0];const task=state.data.tasks[taskId];
 task.isCompleted=false;task.isArchived=false;delete task.taskKind;task.updatedAt=new Date('2026-01-31');
 localStorage.setItem(key,JSON.stringify(state));vi.stubGlobal('navigator',{locks:{request:async(_key:string,run:()=>unknown)=>run()}});
 try{
  await recurrenceRequest(projectId,taskId,{action:'configure',expectedVersion:new Date('2026-01-31').toISOString(),settings:{seriesId:'newseries',interval:1,unit:'month',anchorDate:'2026-01-31',endDate:null,listId:state.data.listIds[0]}});
  await recurrenceRequest(projectId,taskId,{action:'complete',patch:{isCompleted:true}});
  await recurrenceRequest(projectId,taskId,{action:'complete',patch:{isCompleted:true}});
  const after=readOrganizationMock(projectId);const next=after.data.tasks['repeat-newseries-1'];expect(next).toMatchObject({isCompleted:false,recurrence:{occurrence:1}});
  expect(Object.keys(after.data.tasks).filter(id=>id.startsWith('repeat-newseries'))).toHaveLength(1);
  await recurrenceRequest(projectId,'repeat-newseries-1',{action:'configure',expectedVersion:(next.updatedAt as Date).toISOString(),settings:null});
  await recurrenceRequest(projectId,'repeat-newseries-1',{action:'complete',patch:{isCompleted:true}});
  expect(readOrganizationMock(projectId).data.tasks['repeat-newseries-2']).toBeUndefined();
 }finally{localStorage.removeItem(key);vi.unstubAllGlobals();}
});
