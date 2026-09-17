// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProjectAssignee } from './assigneeBackfill';
const fake = vi.hoisted(() => ({ tasks:{} as Record<string,Record<string,unknown>>, writes:[] as unknown[], fail:false, savedDefault:'v' }));
vi.mock('./config', () => ({getFirebaseDb:()=>({}),getFirebaseAuth:()=>({currentUser:{uid:'u',displayName:'本人'}})}));
vi.mock('./testMode',()=>({isE2EMockAuthEnabled:()=>false}));
vi.mock('firebase/firestore',()=>({
  doc:(_db:unknown,...parts:string[])=>({id:parts.at(-1),path:parts.join('/')}), collection:()=>({}), serverTimestamp:()=>0,
  runTransaction:async (_db:unknown,run:(tx:unknown)=>Promise<unknown>)=> {
    const pending:unknown[]=[];
    await run({get:async (ref:{id:string,path:string})=> {const value=ref.path==='projects/p'?{memberIds:['u','v'],defaultAssigneeId:fake.savedDefault}:fake.tasks[ref.id];return {id:ref.id,exists:()=>!!value,data:()=>value};}, update:(...args:unknown[])=>pending.push(args),set:(...args:unknown[])=>pending.push(args)});
    if(fake.fail) throw new Error('保存失敗');
    fake.writes.push(...pending);
  }
}));
beforeEach(()=>{fake.tasks={a:{title:'未設定',assigneeIds:[]},b:{title:'担当あり',assigneeIds:['u']}};fake.writes=[];fake.fail=false;fake.savedDefault='v';});
describe('reviewed assignee backfill',()=>{
  it('writes only selected tasks and logs together; failure commits nothing and permits retry',async()=>{
    fake.fail=true; await expect(applyProjectAssignee('p',['a'],'v')).rejects.toThrow('保存失敗'); expect(fake.writes).toEqual([]);
    fake.fail=false; await applyProjectAssignee('p',['a'],'v'); expect(fake.writes).toHaveLength(2);
    expect(fake.writes[0]).toEqual([expect.objectContaining({id:'a'}),{assigneeIds:['v'],updatedAt:0}]);
    expect(fake.tasks.b.assigneeIds).toEqual(['u']);
  });
  it('rejects the entire batch if assignment or project default changed since preview',async()=>{
    await expect(applyProjectAssignee('p',['a','b'],'v')).rejects.toThrow('状態が変更'); expect(fake.writes).toEqual([]);
    fake.savedDefault='u';await expect(applyProjectAssignee('p',['a'],'v')).rejects.toThrow('主担当が変更');expect(fake.writes).toEqual([]);
  });
});
