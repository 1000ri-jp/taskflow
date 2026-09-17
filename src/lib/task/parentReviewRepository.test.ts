// @vitest-environment node
import {beforeEach,it,expect,vi} from 'vitest';
import {submitTaskCommentRecord} from './commentSubmissionRepository';
import {applyWorkflow} from './workflowRepository';
import type {CommentSubmission} from './commentSubmission';
const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));
type Row = Record<string, unknown>;
let docs: Map<string, Row>;
class Ref {
 constructor(public path: string) {} get id() { return this.path.split('/').at(-1)!; }
 collection(name: string) { return new Query(`${this.path}/${name}`); }
 async get() { const data = docs.get(this.path); return { id:this.id, exists:!!data, data:() => data ? structuredClone(data) : undefined }; }
}
class Query {
 maximum = Infinity; filter?: [string,unknown];
 constructor(public path: string) {} doc(id: string) { return new Ref(`${this.path}/${id}`); }
 where(key: string, _op: string, value: unknown) { this.filter=[key,value]; return this; }
 limit(n: number) { this.maximum=n; return this; }
 async get() { const rows = await Promise.all([...docs.keys()].filter(p => p.startsWith(`${this.path}/`) && (!this.filter || docs.get(p)?.[this.filter[0]] === this.filter[1]) && p.split('/').length === this.path.split('/').length+1).slice(0,this.maximum).map(p => new Ref(p).get())); return { docs:rows, size:rows.length }; }
}
const date = new Date('2026-09-13');

function merge(row:Row,patch:Row){for(const [key,value]of Object.entries(patch)){const keys=key.split('.');let target=row;for(const part of keys.slice(0,-1))target=(target[part]??={}) as Row;target[keys.at(-1)!]=structuredClone(value);}return row;}
let failCommit=false,loseAck=false;
beforeEach(()=>{
 docs=new Map();failCommit=false;loseAck=false;
 fake.db={doc:(p:string)=>new Ref(p),collection:(p:string)=>new Query(p),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const writes:(()=>void)[]=[];const result=await fn({get:(r:Ref|Query)=>{if(writes.length)throw new Error('read after write');return r.get();},set:(r:Ref,d:Row,o?:{merge:boolean})=>writes.push(()=>docs.set(r.path,o?.merge?merge(structuredClone(docs.get(r.path)??{}),d):structuredClone(d))),update:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,merge(structuredClone(docs.get(r.path)??{}),d)))});
  if(failCommit)throw new Error('offline');writes.forEach(w=>w());if(loseAck){loseAck=false;throw new Error('ack lost');}return result;
 }};
 docs.set('projects/p',{name:'隔離検証',memberIds:['author','a','b'],isArchived:false});
 for(const id of ['author','a','b']){docs.set('projects/p/members/'+id,{userId:id,role:'editor'});docs.set('users/'+id,{displayName:id});}
 docs.set('projects/p/tasks/parent',{projectId:'p',title:'親',description:'既存本文',assigneeIds:['author'],dependsOnTaskIds:[],listId:'doing',isCompleted:false,isArchived:false,isAbandoned:false,createdAt:date,updatedAt:date});
});
const input=(extra:Partial<CommentSubmission>={}):CommentSubmission=>({id:'c',projectId:'p',taskId:'parent',authorId:'author',authorName:'依頼者',content:'資料を確認してください',attachments:[{id:'f',name:'資料.pdf',url:'https://example.test/material.pdf',type:'application/pdf',size:10}],notifyIds:[],review:{content:'資料を確認',assigneeIds:['a','b'],dueDate:null,policy:'all'},...extra});
it('atomically saves the request with its parent, source comment and actionable notifications, never a subtask',async()=>{
 await submitTaskCommentRecord('author',input());
 expect(docs.has('projects/p/tasks/review-c')).toBe(false);expect(docs.get('projects/p/tasks/parent')).toMatchObject({description:'既存本文',isCompleted:false,reviewRequests:{'review-c':{commentId:'c',assigneeIds:['a','b']}}});
 expect(docs.get('notifications/c:a')).toMatchObject({taskId:'parent',data:{requiresResponse:true,commentId:'c',sourceTaskId:'parent'}});
 expect(docs.get('projects/p/tasks/parent/comments/c')).toMatchObject({reviewTaskId:'review-c',attachments:input().attachments});
});
it('responds in the parent, keeps read separate, and waits for all requested people',async()=>{
 await submitTaskCommentRecord('author',input());docs.get('notifications/c:a')!.isRead=true;
 const request=(docs.get('projects/p/tasks/parent')!.reviewRequests as Record<string,{updatedAt:string}>)['review-c'];
 await applyWorkflow('a','p','review-c',{id:'reply-a',action:'approve',expectedVersion:request.updatedAt});
 expect(docs.get('notifications/c:a')).toMatchObject({isRead:true,data:{requiresResponse:false}});expect(docs.get('notifications/c:b')).toMatchObject({data:{requiresResponse:true}});
 expect(docs.has('projects/p/tasks/review-c')).toBe(false);expect(docs.get('projects/p/activityLogs/workflow-parent-reply-a')).toBeDefined();expect(docs.get('projects/p/tasks/parent')!.isCompleted).toBe(false);
});
it('does not overwrite responses/read markers after a lost acknowledgement or recreate a deleted original comment',async()=>{
 loseAck=true;await expect(submitTaskCommentRecord('author',input())).rejects.toThrow('ack lost');docs.get('notifications/c:a')!.isRead=true;docs.delete('projects/p/tasks/parent/comments/c');const before=structuredClone([...docs]);
 expect(await submitTaskCommentRecord('author',input())).toMatchObject({alreadySubmitted:true});expect([...docs]).toEqual(before);
});
it('writes nothing on a failed commit, stale source, nested source or invalid recipient',async()=>{
 const before=structuredClone([...docs]);failCommit=true;await expect(submitTaskCommentRecord('author',input())).rejects.toThrow('offline');expect([...docs]).toEqual(before);failCommit=false;
 await expect(submitTaskCommentRecord('author',input({expectedTaskVersion:'2020-01-01T00:00:00.000Z'}))).rejects.toThrow('変わ');expect([...docs]).toEqual(before);
 await expect(submitTaskCommentRecord('author',input({notifyIds:['outside']}))).rejects.toThrow('参加');expect([...docs]).toEqual(before);
 docs.get('projects/p/tasks/parent')!.parentTaskId='root';const nested=structuredClone([...docs]);await expect(submitTaskCommentRecord('author',input())).rejects.toThrow('親タスク');expect([...docs]).toEqual(nested);
});
it('restores the same subtask ID with its previous comment and file records untouched',async()=>{
 const child={...docs.get('projects/p/tasks/parent'),parentTaskId:'parent',title:'子の記録'};docs.set('projects/p/tasks/child',child);docs.set('projects/p/tasks/child/comments/old',{content:'残す',attachments:input().attachments});
 await applyWorkflow('author','p','child',{id:'delete',action:'archive',expectedVersion:date.toISOString()});
 await applyWorkflow('author','p','child',{id:'undo',action:'restore',expectedVersion:(docs.get('projects/p/tasks/child')!.updatedAt as Date).toISOString()});
 expect(docs.get('projects/p/tasks/child')).toMatchObject({isArchived:false,parentTaskId:'parent'});expect(docs.get('projects/p/tasks/child/comments/old')).toMatchObject({content:'残す',attachments:input().attachments});
});

it('carries explicit urgency only to reviewers and preserves it across resubmission',async()=>{
 const original=input({notifyIds:['b'],review:{content:'公開前の確認',assigneeIds:['a'],dueDate:'2026-09-14',urgency:'urgent'}});
 await submitTaskCommentRecord('author',original);
 expect(docs.get('notifications/c:a')).toMatchObject({data:{urgency:'urgent',requiresResponse:true,dueDate:'2026-09-14'}});
 expect((docs.get('notifications/c:b')!.data as Row).urgency).toBeUndefined();
 const cycle=()=>((docs.get('projects/p/tasks/parent')!.reviewRequests as Record<string,{updatedAt:string}>)['review-c']);
 await applyWorkflow('a','p','review-c',{id:'changes',action:'request_changes',expectedVersion:cycle().updatedAt,note:'修正してください'});
 await applyWorkflow('author','p','review-c',{id:'resubmit',action:'resubmit',expectedVersion:cycle().updatedAt,note:'修正しました'});
 expect(docs.get('notifications/c:a')).toMatchObject({isRead:false,data:{urgency:'urgent',requiresResponse:true}});
 expect(docs.get('projects/p/tasks/parent')!.isCompleted).toBe(false);
});
