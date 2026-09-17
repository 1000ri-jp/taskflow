// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeFromBoard, saveRecurrence, updateTaskWithRecurrence } from './recurrenceRepository';
import { applyWorkflow } from './workflowRepository';
import type { TaskRecurrence } from './recurrence';
const fake=vi.hoisted(()=>({db:null as unknown}));
vi.mock('@/lib/firebase/admin',()=>({getAdminDb:()=>fake.db}));
type Row=Record<string,unknown>;let docs:Map<string,Row>;let failCommit=false;
class Ref {
 constructor(public path:string){} get id(){return this.path.split('/').at(-1)!;} get parent(){return new Query(this.path.split('/').slice(0,-1).join('/'));}
 collection(name:string){return new Query(`${this.path}/${name}`);} async get(){const data=docs.get(this.path);return {id:this.id,ref:this,exists:!!data,data:()=>data?structuredClone(data):undefined};}
}
class Query {
 maximum=Infinity;filter?:[string,unknown];constructor(public path:string){} get parent(){return new Ref(this.path.split('/').slice(0,-1).join('/'));}
 doc(id:string){return new Ref(`${this.path}/${id}`);} where(key:string,_op:string,value:unknown){this.filter=[key,value];return this;} limit(n:number){this.maximum=n;return this;}
 async get(){const rows=await Promise.all([...docs.keys()].filter(p=>p.startsWith(`${this.path}/`)&&p.split('/').length===this.path.split('/').length+1&&(!this.filter||docs.get(p)?.[this.filter[0]]===this.filter[1])).slice(0,this.maximum).map(p=>new Ref(p).get()));return {docs:rows,size:rows.length};}
}
const now=new Date('2026-01-31T00:00:00+09:00');
const rule:TaskRecurrence={seriesId:'series',occurrence:0,unit:'month',interval:1,anchorDate:'2026-01-31',endDate:null,listId:'todo'};
const ref=()=>new Ref('projects/p/tasks/first');
const snapshot=()=>structuredClone([...docs]);
beforeEach(()=>{
 failCommit=false;docs=new Map([
  ['projects/p',{memberIds:['u'],isArchived:false}],['projects/p/members/u',{userId:'u',role:'editor'}],['users/u',{displayName:'本人'}],['projects/p/lists/todo',{name:'作業'}],['projects/p/lists/done',{name:'完了',autoCompleteOnEnter:true}],
  ['projects/p/tasks/first',{projectId:'p',listId:'todo',title:'給与計算',description:'今月分を確認',assigneeIds:['u'],dependsOnTaskIds:[],createdBy:'u',createdAt:now,updatedAt:now,dueDate:now,startDate:null,isCompleted:false,isArchived:false,isAbandoned:false,recurrence:rule}],
  ['projects/p/tasks/first/checklists/check',{title:'確認',order:0,items:[{id:'a',text:'金額',isChecked:true,order:0}]}],
 ]);
 fake.db={doc:(path:string)=>new Ref(path),collection:(path:string)=>new Query(path),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const writes:(()=>void)[]=[];const result=await fn({get:(r:Ref|Query)=>{if(writes.length)throw new Error('read after write');return r.get();},set:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,structuredClone(d))),update:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...structuredClone(d)}))});if(failCommit)throw new Error('connection lost');writes.forEach(w=>w());return result;
 }};
});
describe('recurrence transactions',()=>{
 it('completes a dragged card, returns next task to its working list, and resets its checklist atomically',async()=>{
  await completeFromBoard('u','p','first',{isCompleted:true,listId:'done',order:4});
  expect(docs.get(ref().path)).toMatchObject({isCompleted:true,listId:'done'});
  expect(docs.get('projects/p/tasks/repeat-series-1')).toMatchObject({title:'給与計算',isCompleted:false,listId:'todo',recurrence:{occurrence:1}});
  expect(docs.get('projects/p/tasks/repeat-series-1/checklists/check')).toMatchObject({items:[{id:'a',text:'金額',isChecked:false,order:0}]});
 });
 it('does not duplicate or overwrite the next instance on retry or reopening and completing again',async()=>{
  await completeFromBoard('u','p','first',{isCompleted:true});
  docs.get('projects/p/tasks/repeat-series-1')!.title='編集済み';docs.get(ref().path)!.isCompleted=false;
  await completeFromBoard('u','p','first',{isCompleted:true});expect(docs.get('projects/p/tasks/repeat-series-1')!.title).toBe('編集済み');
  docs.delete('projects/p/tasks/repeat-series-1');await completeFromBoard('u','p','first',{isCompleted:true});expect(docs.has('projects/p/tasks/repeat-series-1')).toBe(false);
 });
 it('leaves both completion and next task untouched when a transaction fails',async()=>{const before=snapshot();failCommit=true;await expect(completeFromBoard('u','p','first',{isCompleted:true})).rejects.toThrow();expect(snapshot()).toEqual(before);});
 it('enforces project editor access and validates patch keys before writing',async()=>{
  const before=snapshot();await expect(completeFromBoard('u','p','first',{isCompleted:true,createdBy:'attacker'})).rejects.toThrow();expect(snapshot()).toEqual(before);
  docs.get('projects/p/members/u')!.role='viewer';const viewer=snapshot();await expect(completeFromBoard('u','p','first',{isCompleted:true})).rejects.toThrow('権限');expect(snapshot()).toEqual(viewer);
 });
 it('stops at end date and supports the existing workflow completion path',async()=>{
  await applyWorkflow('u','p','first',{id:'complete',action:'complete',expectedVersion:now.toISOString()});expect(docs.has('projects/p/tasks/repeat-series-1')).toBe(true);
  const next=docs.get('projects/p/tasks/repeat-series-1')!;(next.recurrence as TaskRecurrence).endDate='2026-02-28';
  await updateTaskWithRecurrence(new Ref('projects/p/tasks/repeat-series-1') as never,{isCompleted:true});expect(docs.has('projects/p/tasks/repeat-series-2')).toBe(false);
 });
 it('saves and disables shared settings, rejects stale edits and completed-list destinations',async()=>{
  const input={seriesId:'new',unit:rule.unit,interval:rule.interval,anchorDate:rule.anchorDate,endDate:rule.endDate,listId:rule.listId};
  await expect(saveRecurrence('u','p','first','stale',input)).rejects.toThrow('更新');
  await expect(saveRecurrence('u','p','first',now.toISOString(),{...input,listId:'done'})).rejects.toThrow('リスト');
  await saveRecurrence('u','p','first',now.toISOString(),input);expect(docs.get(ref().path)!.recurrence).toMatchObject({seriesId:'new'});
  await saveRecurrence('u','p','first',now.toISOString(),input);
  const current=docs.get(ref().path)!.updatedAt as Date;await saveRecurrence('u','p','first',current.toISOString(),null);expect(docs.get(ref().path)!.recurrence).toBeNull();
 });
});

it('rejects inverted dates atomically in both completion save paths', async () => {
 const before=snapshot();
 await expect(completeFromBoard('u','p','first',{isCompleted:true,startDate:'2026-02-01T00:00:00+09:00'})).rejects.toThrow('開始日は期限以前');
 expect(snapshot()).toEqual(before);
 await expect(updateTaskWithRecurrence(ref() as never,{isCompleted:true,startDate:new Date('2026-02-01T00:00:00+09:00')})).rejects.toThrow('開始日は期限以前');
 expect(snapshot()).toEqual(before);
});


it('records completion with its saved change and actor atomically, without creating another change on retry',async()=>{
  await completeFromBoard('u','p','first',{isCompleted:true});
  const logs=()=>[...docs].filter(([path])=>path.startsWith('projects/p/activityLogs/complete-')).map(([,row])=>row);
  expect(logs()).toHaveLength(1);
  expect(logs()[0]).toMatchObject({targetType:'task',targetId:'first',action:'complete',userId:'u',userName:'本人',changes:expect.arrayContaining([{field:'isCompleted',oldValue:'false',newValue:'true'}])});
  await completeFromBoard('u','p','first',{isCompleted:true});
  expect(logs()).toHaveLength(1);
});
