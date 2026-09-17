// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyWorkflow } from './workflowRepository';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/projects/[projectId]/tasks/[taskId]/workflow/route';
const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, verifyAuthToken: async () => ({ uid: 'worker', email: 'worker@1000ri.jp' }) }));
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
const input = (id='one') => ({ id, action:'approve' as const, expectedVersion:date.toISOString(), note:'' });
beforeEach(() => {
 docs = new Map();
 fake.db = { doc:(p:string)=>new Ref(p), collection:(p:string)=>new Query(p), runTransaction:async (fn:(tx:unknown)=>Promise<unknown>) => {
   const writes:(()=>void)[]=[];
   const result=await fn({get:(r:Ref|Query)=>{ if(writes.length) throw new Error('read after write'); return r.get(); }, set:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,structuredClone(d))), update:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...structuredClone(d)}))});
   writes.forEach(w=>w()); return result;
 }};
 docs.set('projects/p',{memberIds:['reviewer','worker','publisher'],isArchived:false});
 for(const uid of ['reviewer','worker','publisher']) { docs.set(`projects/p/members/${uid}`,{userId:uid,role:'editor'}); docs.set(`users/${uid}`,{displayName:uid}); }
 const task={projectId:'p',assigneeIds:['worker'],dependsOnTaskIds:[],description:'',isCompleted:false,isArchived:false,isAbandoned:false,updatedAt:date,createdAt:date,completedAt:null};
 docs.set('projects/p/tasks/work',{...task,title:'制作'});
 docs.set('projects/p/tasks/release',{...task,title:'公開',assigneeIds:['publisher']});
 docs.set('projects/p/tasks/review',{...task,title:'確認依頼',taskKind:'review_request',parentTaskId:'work',assigneeIds:['reviewer'],review:{policy:'any',round:1,request:'PDFの確認',attachments:[],requestedAt:date.toISOString(),responses:{},nextTaskId:'release'}});
});
describe('workflow transaction', () => {
 it('records status changes and archive restoration with permissions and idempotent retries', async () => {
   docs.delete('projects/p/tasks/review');
   await applyWorkflow('worker','p','work',{ ...input('start'), action: 'start' });
   expect(docs.get('projects/p/activityLogs/workflow-start')).toMatchObject({ before: { workProgress: null }, after: { workProgress: 'started' } });
   const archive = { ...input('archive'), action: 'archive' as const, expectedVersion: (docs.get('projects/p/tasks/work')!.updatedAt as Date).toISOString() };
   await applyWorkflow('worker','p','work',archive);
   const archived = structuredClone([...docs]);
   await applyWorkflow('worker','p','work',archive);
   expect([...docs]).toEqual(archived);
   const restore = { ...input('restore'), action: 'restore' as const, expectedVersion: (docs.get('projects/p/tasks/work')!.updatedAt as Date).toISOString() };
   docs.get('projects/p/members/publisher')!.role = 'viewer';
   await expect(applyWorkflow('publisher','p','work',restore)).rejects.toThrow('権限');
   expect(docs.get('projects/p/tasks/work')?.isArchived).toBe(true);
   await applyWorkflow('worker','p','work',restore);
   expect(docs.get('projects/p/tasks/work')).toMatchObject({ workProgress:'started', isArchived:false, archivedAt:null, archivedBy:null, assigneeIds:['worker'] });
   expect([...docs.keys()].filter(key => key.startsWith('notifications/'))).toHaveLength(0);
 });
 it('writes response, parent history, next handoff and notifications together, with an idempotent retry', async () => {
   expect(await applyWorkflow('reviewer','p','review',input())).toMatchObject({alreadyApplied:false,receipt:{nextTaskId:'release',nextAssigneeIds:['publisher'],notifiedUserIds:['worker','publisher']}});
   expect(docs.get('projects/p/tasks/review')?.isCompleted).toBe(true);
   expect(docs.get('projects/p/tasks/work')?.isCompleted).toBe(false);
   expect(docs.get('projects/p/tasks/work')?.assigneeIds).toEqual(['worker']);
   expect(docs.get('projects/p/activityLogs/workflow-parent-one')?.targetId).toBe('work');
   expect([...docs.keys()].filter(k=>k.startsWith('notifications/'))).toHaveLength(2);
   docs.get('notifications/workflow-one-worker')!.isRead=true;
   const after=structuredClone([...docs]);
   expect(await applyWorkflow('reviewer','p','review',input())).toMatchObject({alreadyApplied:true,receipt:{nextTaskId:'release'}}); expect([...docs]).toEqual(after);
 });
 it('rechecks access even for an already applied event',async()=>{
   await applyWorkflow('reviewer','p','review',input()); docs.get('projects/p/members/reviewer')!.role='viewer';
   const before=structuredClone([...docs]); await expect(applyWorkflow('reviewer','p','review',input())).rejects.toThrow('権限'); expect([...docs]).toEqual(before);
 });
 it('refuses stale or wrong reviewer actions without any partial writes',async()=>{
   const before=structuredClone([...docs]);
   await expect(applyWorkflow('worker','p','review',input())).rejects.toThrow('確認する人');
   await expect(applyWorkflow('reviewer','p','review',{...input(),expectedVersion:'old'})).rejects.toThrow('情報が変わ');
   expect([...docs]).toEqual(before);
 });
 it('records the actual before values for optional work details',async()=>{
   await applyWorkflow('worker','p','work',{...input(),action:'configure',details:{completionCriteria:'入稿済みPDF',primaryAssigneeId:'worker',taskKind:'decision',milestoneId:null}});
   expect(docs.get('projects/p/activityLogs/workflow-one')).toMatchObject({before:{completionCriteria:null,primaryAssigneeId:null},after:{completionCriteria:'入稿済みPDF',primaryAssigneeId:'worker',taskKind:'decision'}});
 });
 it('checks milestone existence and limits before writing',async()=>{
   const before=structuredClone([...docs]);
   await expect(applyWorkflow('worker','p','work',{...input(),action:'configure',details:{completionCriteria:'入稿',primaryAssigneeId:null,taskKind:'task',milestoneId:'missing'}})).rejects.toThrow('節目');
   expect([...docs]).toEqual(before);
 });
});

it('returns the original committed receipt on retry even when later tasks and recipients changed', async () => {
 const first = await applyWorkflow('reviewer','p','review',input());
 docs.get('projects/p/tasks/release')!.title = '別の題名';
 docs.get('projects/p/tasks/release')!.assigneeIds = ['worker'];
 expect((await applyWorkflow('reviewer','p','review',input())).receipt).toEqual(first.receipt);
});
it('corrects a reviewed result once, preserving downstream progress and the original record', async () => {
 await applyWorkflow('reviewer','p','review',input());
 docs.get('projects/p/tasks/release')!.workProgress = 'started';
 const downstream = structuredClone(docs.get('projects/p/tasks/release'));
 const correction = { id: 'correction', action: 'correct_approval' as const, expectedVersion: (docs.get('projects/p/tasks/review')!.updatedAt as Date).toISOString(), note: '再確認が必要' };
 const result = await applyWorkflow('reviewer','p','review',correction);
 expect(result.receipt).toMatchObject({ action:'correct_approval',nextTaskId:'review',nextAssigneeIds:['reviewer'],downstreamStarted:true });
 expect(docs.get('projects/p/tasks/release')).toEqual(downstream);
 expect(docs.get('projects/p/tasks/review')).toMatchObject({isCompleted:false,review:{responses:{},correctedApproval:{by:'reviewer',note:'再確認が必要'}}});
 expect(docs.get('projects/p/activityLogs/workflow-one')?.after).toMatchObject({isCompleted:true});
 expect(docs.get('notifications/workflow-correction-publisher')).toBeDefined();
 const after = structuredClone([...docs]);
 await applyWorkflow('reviewer','p','review',correction);
 expect([...docs]).toEqual(after);
});


describe('subtask date HTTP request through the transaction', () => {
 const requestDate = (dueDate: string | null) => POST(new NextRequest('http://localhost/api/projects/p/tasks/subtask/workflow', {
  method: 'POST', headers: { Authorization: 'Bearer isolated-test' },
  body: JSON.stringify({ ...input(), action: 'edit_subtask', subtaskPatch: { dueDate } }),
 }), { params: Promise.resolve({ projectId: 'p', taskId: 'subtask' }) });
 beforeEach(() => {
  docs.set('projects/p/tasks/subtask', {
   ...docs.get('projects/p/tasks/work'), title: '期日を確認する', parentTaskId: 'work',
   dueDate: new Date('2026-09-15T00:00:00+09:00'), description: '既存の本文',
   attachments: [{ id: 'old', name: '以前の資料' }],
  });
  docs.set('projects/p/tasks/subtask/comments/old', { content: '以前のやりとり' });
 });
 it.each(['2026-09-17', null])('persists %s once, preserving other fields, records, and the parent', async (dueDate) => {
  const original = structuredClone(docs.get('projects/p/tasks/subtask'));
  const parent = structuredClone(docs.get('projects/p/tasks/work'));
  const response = await requestDate(dueDate);
  expect(response.status).toBe(200);
  expect(docs.get('projects/p/tasks/subtask')).toEqual({ ...original,
   dueDate: dueDate ? new Date(dueDate + 'T00:00:00+09:00') : null, updatedAt: expect.any(Date),
  });
  expect(docs.get('projects/p/tasks/work')).toEqual(parent);
  expect(docs.get('projects/p/tasks/subtask/comments/old')).toEqual({ content: '以前のやりとり' });
  expect(docs.get('projects/p/activityLogs/workflow-parent-one')?.targetId).toBe('work');
  expect([...docs.keys()].filter(key => key.startsWith('notifications/'))).toHaveLength(0);
  const saved = structuredClone([...docs]);
  expect(await (await requestDate(dueDate)).json()).toMatchObject({ alreadyApplied: true });
  expect([...docs]).toEqual(saved);
 });
 it('rejects an invalid date without changing stored data', async () => {
  const original = structuredClone([...docs]);
  const response = await requestDate('2026-02-30');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ rejected: true });
  expect([...docs]).toEqual(original);
 });
});
