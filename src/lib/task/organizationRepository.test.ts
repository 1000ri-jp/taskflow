// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actOnOrganization, createOrganizationBasis, filterKnownOrganizationDrafts, listOrganization, previewOrganization, readOrganizationSource, reconsiderOrganization } from './organizationRepository';
const fake=vi.hoisted(()=>({db:null as unknown, incoming:null as unknown,aiText:'',apiKey:'fake-key',aiCalls:0}));
vi.mock('@/lib/firebase/admin',()=>({getAdminDb:()=>fake.db,getUserAIApiKey:async()=>fake.apiKey}));
vi.mock('@/lib/secretary/repository',()=>({loadSecretary:async()=>fake.incoming}));
vi.mock('@/lib/ai/providers',()=>({getProvider:()=>({sendMessage:async function*(){fake.aiCalls++;yield {type:'text',content:fake.aiText};}})}));
import { analyzeOrganization } from './organizationAnalysis';
type Row=Record<string,unknown>;let docs:Map<string,Row>;let n=0;
class Ref {constructor(public path:string){} get id(){return this.path.split('/').at(-1)!;}collection(name:string){return new Query(`${this.path}/${name}`);}async get(){const v=docs.get(this.path);return{id:this.id,exists:!!v,data:()=>v?structuredClone(v):undefined};}}
class Query {maximum=Infinity;filter?:[string,unknown];constructor(public path:string){}doc(id=`log-${++n}`){return new Ref(`${this.path}/${id}`);}where(key:string,_op:string,value:unknown){this.filter=[key,value];return this;}limit(n:number){this.maximum=n;return this;}async get(){const paths=[...docs.keys()].filter(p=>p.startsWith(`${this.path}/`)&&p.split('/').length===this.path.split('/').length+1&&(!this.filter||docs.get(p)?.[this.filter[0]]===this.filter[1])).slice(0,this.maximum);const values=await Promise.all(paths.map(p=>new Ref(p).get()));return{docs:values,size:values.length};}}
beforeEach(()=>{docs=new Map();n=0;fake.incoming=null;fake.aiText='';fake.aiCalls=0;fake.apiKey='fake-key';fake.db={doc:(p:string)=>new Ref(p),collection:(p:string)=>new Query(p),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const writes:(()=>void)[]=[];const result=await fn({get:(r:Ref|Query)=>{if(writes.length)throw new Error('read after write');return r.get();},set:(r:Ref,d:Row,o?:{merge:boolean})=>writes.push(()=>docs.set(r.path,structuredClone(o?.merge?{...docs.get(r.path),...d}:d))),update:(r:Ref,d:Row)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...structuredClone(d)})),delete:(r:Ref)=>writes.push(()=>docs.delete(r.path))});writes.forEach(w=>w());return result;}};docs.set('projects/p',{memberIds:['u','v'],isArchived:false});docs.set('projects/p/members/u',{userId:'u',role:'editor'});docs.set('projects/p/lists/work',{name:'作業'});for(const id of ['a','b'])docs.set(`projects/p/tasks/${id}`,{title:'案内文',description:'公開を確認',listId:'work',assigneeIds:['u'],dependsOnTaskIds:[],isCompleted:false,isArchived:false,isAbandoned:false,updatedAt:new Date('2026-09-12')});docs.set('projects/p/tasks/b/comments/c',{content:'確定した共有コメント',authorId:'u'});docs.set('users/u/secretary/state',{schema:1,revision:7,proposals:[],decisions:[{keep:true}],history:[],incomingDecisions:[{keep:true}]});});
const source={kind:'meeting' as const,id:'meeting-1',title:'朝会',text:'公開を確認して進める',occurredAt:'2026-09-12T00:00:00Z'};
const draft={kind:'merge' as const,taskIds:['a','b'],targetTaskId:'a',reason:'同じ成果物',quote:'公開を確認'};
describe('organization transactional adoption',()=>{
 it('previews without task changes, applies once and preserves other secretary state',async()=>{
  const before=structuredClone(docs.get('projects/p/tasks/a'));const p=await previewOrganization('u','p',source,draft);expect(docs.get('projects/p/tasks/a')).toEqual(before);
  await actOnOrganization('u','p',p.id,'apply');const after=structuredClone(docs.get('projects/p/tasks/a'));
  await actOnOrganization('u','p',p.id,'apply');expect(docs.get('projects/p/tasks/a')).toEqual(after);expect(docs.get('users/u/secretary/state')).toMatchObject({revision:7,decisions:[{keep:true}],incomingDecisions:[{keep:true}]});
  expect((await previewOrganization('u','p',source,draft)).status).toBe('applied');
  const moaiComments=[...docs.entries()].filter(([path,row])=>path.startsWith('projects/p/tasks/a/comments/moai-')&&row.authorLabel==='モアイ');
  expect(moaiComments).toHaveLength(1);expect(moaiComments[0][1]).toMatchObject({taskId:'a',authorId:'u',authorLabel:'モアイ',authorIcon:'🤖',purpose:'memo',mentions:[],attachments:[]});
  expect(moaiComments[0][1].content).toContain('提案を採用して反映しました。');
 });
 it('inherits only the selected project parent and rechecks the parent before applying',async()=>{
  docs.set('projects/q',{memberIds:['u','v'],isArchived:false});docs.set('projects/q/members/u',{userId:'u',role:'editor'});docs.set('projects/q/lists/work',{name:'別プロジェクト'});
  docs.set('projects/q/tasks/a',{...docs.get('projects/p/tasks/a'),assigneeIds:['v']});
  docs.get('projects/p/tasks/a')!.assigneeIds=['u','v'];
  const d={kind:'create' as const,taskIds:[],targetTaskId:'a',title:'発送の準備',reason:'親の仕事の手順',quote:'公開を確認'};
  const p=await previewOrganization('u','p',source,d);const q=await previewOrganization('u','q',source,d);
  expect(p.changes[0].fields).toContainEqual({field:'assigneeIds',before:null,after:['u','v']});
  expect(q.changes[0].fields).toContainEqual({field:'assigneeIds',before:null,after:['v']});
  docs.get('projects/p/tasks/a')!.assigneeIds=['u'];
  await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toMatchObject({status:409});
  await actOnOrganization('u','q',q.id,'apply');
  expect([...docs.entries()].filter(([path])=>/^projects\/p\/tasks\/org-/.test(path))).toHaveLength(0);
  const children=[...docs.entries()].filter(([path])=>/^projects\/q\/tasks\/org-[^/]+$/.test(path));
  expect(children).toHaveLength(1);expect(children[0][1]).toMatchObject({projectId:'q',parentTaskId:'a',assigneeIds:['v']});
 });
 it('keeps held decisions and does not regenerate identical pending proposals',async()=>{const p=await previewOrganization('u','p',source,draft);await actOnOrganization('u','p',p.id,'hold');expect((await previewOrganization('u','p',source,draft)).status).toBe('held');expect(await listOrganization('u','p')).toHaveLength(1);});
 it('stores a selected reminder separately and reopens it with an explicit reason', async()=>{
  const p = await previewOrganization('u', 'p', source, draft);
  const beforeA = structuredClone(docs.get('projects/p/tasks/a'));
  await actOnOrganization('u', 'p', p.id, 'defer', { kind: 'at', at: new Date(Date.now()+7*86_400_000).toISOString() });
  expect(docs.get('users/u/secretary/state')).toMatchObject({ organization: { entries: [{ preview: { status: 'held', followUp: { kind: 'at' } }, followUp: { kind: 'at' } }] } });
  expect(docs.get('projects/p/tasks/a')).toEqual(beforeA);
  expect((await listOrganization('u', 'p'))[0]).toMatchObject({ status: 'held', followUp: { kind: 'at' } });
  const state = docs.get('users/u/secretary/state')!;
  const entries = state.organization as { entries: { preview: Record<string, unknown>; followUp: Record<string, unknown> }[] };
  entries.entries[0].followUp = { kind: 'at', at: new Date(Date.now()-86_400_000).toISOString() };
  entries.entries[0].preview.followUp = entries.entries[0].followUp;
  const reopened = (await listOrganization('u', 'p'))[0];
  expect(reopened).toMatchObject({ status: 'pending', reappearedReason: '指定した日時になりました', followUp: { kind: 'at', triggeredAt: expect.any(String) } });
  expect(docs.get('projects/p/tasks/a')).toEqual(beforeA);
 });
 it('rejects task or source-comment changes after preview before any writes',async()=>{const p=await previewOrganization('u','p',source,draft);docs.get('projects/p/tasks/b/comments/c')!.content='同僚が変更';await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toThrow('更新');expect(docs.get('projects/p/tasks/b')?.isArchived).toBe(false);});
 it('undoes safely and leaves the original comments/attachments intact',async()=>{const p=await previewOrganization('u','p',source,draft);await actOnOrganization('u','p',p.id,'apply');await actOnOrganization('u','p',p.id,'undo');expect(docs.get('projects/p/tasks/b')?.isArchived).toBe(false);expect(docs.get('projects/p/tasks/b/comments/c')?.content).toBe('確定した共有コメント');expect([...docs.keys()].filter(k=>k.includes('tasks/a/comments/'))).toHaveLength(0);});
 it('keeps the proposed description intact and records adoption separately as a Moai comment',async()=>{
  const proposedDescription='更新した完了条件';
  const p=await previewOrganization('u','p',source,{kind:'update',taskIds:['a'],reason:'完了条件を明確にする',quote:'公開を確認',description:proposedDescription,descriptionMode:'replace'});
  await actOnOrganization('u','p',p.id,'apply');
  expect(docs.get('projects/p/tasks/a')?.description).toBe(proposedDescription);
  const comment=[...docs.entries()].find(([path,row])=>path.startsWith('projects/p/tasks/a/comments/moai-')&&row.authorLabel==='モアイ')?.[1];
  expect(comment).toMatchObject({authorId:'u',authorLabel:'モアイ',authorIcon:'🤖',purpose:'memo'});
  expect(comment?.content).not.toBe(proposedDescription);
 });
 it('will not undo after an adoption comment is edited',async()=>{
  const p=await previewOrganization('u','p',source,draft);await actOnOrganization('u','p',p.id,'apply');
  const path=[...docs.keys()].find(path=>path.startsWith('projects/p/tasks/a/comments/moai-'))!;
  docs.get(path)!.content='後から追記された記録';
  await expect(actOnOrganization('u','p',p.id,'undo')).rejects.toThrow('コメント');
  expect(docs.get(path)?.content).toBe('後から追記された記録');
 });
 it('uses the list assignee before the project assignee and rejects stale list defaults',async()=>{
  docs.get('projects/p')!.defaultAssigneeId='v';
  docs.get('projects/p/lists/work')!.defaultAssigneeId='u';
  const p=await previewOrganization('u','p',source,{kind:'create',taskIds:[],title:'確認用タスク',description:'',listId:'work',reason:'新しい成果',quote:'公開を確認'});
  const state=docs.get('users/u/secretary/state')!;
  const createdTaskPath=`tasks/${p.changes[0].taskId}`;
  const entry=(state.organization as {entries:{writes:{path:string;after:Row}[]}[]}).entries.find(value=>value.writes.some(write=>write.path===createdTaskPath));
  expect(entry?.writes.find(write=>write.path===createdTaskPath)?.after.assigneeIds).toEqual(['u']);
  docs.get('projects/p/lists/work')!.defaultAssigneeId='v';
  await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toThrow('更新');
 });
 it('blocks undo after later editor changes or new comments and preserves those edits',async()=>{const p=await previewOrganization('u','p',source,draft);await actOnOrganization('u','p',p.id,'apply');docs.set('projects/p/tasks/a/comments/later',{content:'後続の確認'});await expect(actOnOrganization('u','p',p.id,'undo')).rejects.toThrow('編集');expect(docs.get('projects/p/tasks/a/comments/later')?.content).toBe('後続の確認');});
 it('rejects role revocation before shared changes',async()=>{const p=await previewOrganization('u','p',source,draft);docs.get('projects/p/members/u')!.role='viewer';await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toThrow('権限');expect(docs.get('projects/p/tasks/b')?.isArchived).toBe(false);});
 it('refuses truncation of merged comment history',async()=>{for(let i=0;i<101;i++)docs.set(`projects/p/tasks/b/comments/c${i}`,{content:'履歴'});await expect(previewOrganization('u','p',source,draft)).rejects.toThrow('100件');});
});

describe('meeting decisions and independent adoption',()=>{
 const change=(id:string)=>({kind:'update' as const,taskIds:[id],title:`改訂${id}`,reason:'会議の決定',quote:'公開を確認'});
 const basis=()=>createOrganizationBasis('p',source,{tasks:Object.fromEntries([...docs].filter(([path])=>/^projects\/p\/tasks\/[^/]+$/.test(path)).map(([path,row])=>[path.split('/').at(-1)!,row])),children:Object.fromEntries([...docs].filter(([path])=>/^projects\/p\/tasks\/[^/]+\/(comments|checklists)\/[^/]+$/.test(path)).map(([path,row])=>[path.replace('projects/p/',''),row]))});
 it('applies independent previews sequentially and permits unrelated later edits during undo',async()=>{
  const original=await basis();const a=await previewOrganization('u','p',source,change('a'),original);const b=await previewOrganization('u','p',source,change('b'),original);
  await actOnOrganization('u','p',a.id,'apply');await actOnOrganization('u','p',b.id,'apply');
  expect(docs.get('projects/p/tasks/a')?.title).toBe('改訂a');expect(docs.get('projects/p/tasks/b')?.title).toBe('改訂b');
  await actOnOrganization('u','p',a.id,'undo');expect(docs.get('projects/p/tasks/a')?.title).toBe('案内文');expect(docs.get('projects/p/tasks/b')?.title).toBe('改訂b');
 });
 it.each(['task','comment','checklist','new-child'])('rejects a relevant %s update between analysis and preview without saving the proposal',async field=>{
  const original=await basis();
  if(field==='task')docs.get('projects/p/tasks/a')!.title='同僚が変更';
  if(field==='comment')docs.set('projects/p/tasks/a/comments/new',{content:'変更'});
  if(field==='checklist')docs.set('projects/p/tasks/a/checklists/new',{items:[{isChecked:false}]});
  if(field==='new-child')docs.get('projects/p/tasks/b')!.parentTaskId='a';
  await expect(previewOrganization('u','p',source,change('a'),original)).rejects.toMatchObject({status:409});
  expect(docs.get('users/u/secretary/state')?.organization).toBeUndefined();
 });
 it('preserves explicit required-child completion conditions even after confirmation',async()=>{
  docs.get('projects/p/tasks/a')!.completionPolicy={kind:'all_required_children',condition:'全員分',required:[{taskId:'b',assigneeId:'u'}]};docs.get('projects/p/tasks/b')!.parentTaskId='a';docs.set('projects/p/tasks/a/checklists/steps',{items:[{isChecked:false}]});
  const p=await previewOrganization('u','p',source,{...change('a'),kind:'complete',speech:'tentative',confirmationPoints:['完了範囲を確認']},undefined,true);
  expect(p.canApply).toBe(false);await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toThrow('全員');
  expect(docs.get('projects/p/tasks/a')?.isCompleted).toBe(false);expect([...docs.keys()].some(path=>path.includes('activityLogs'))).toBe(false);
 });
 it('allows an explicitly confirmed change and safely undoes shared workState',async()=>{
  const d={...change('a'),kind:'hold' as const,speech:'tentative' as const,confirmationPoints:['時期を確認'],workState:{reason:'素材未着',resumeCondition:'画像が届いたら',reviewAt:'2026-09-20'}};
  const before=structuredClone(docs.get('projects/p/tasks/a'));const p=await previewOrganization('u','p',source,d);
  await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toMatchObject({status:409});
  const confirmed=await previewOrganization('u','p',source,d,undefined,true);expect(confirmed.id).toBe(p.id);expect(confirmed.canApply).toBe(true);
  await actOnOrganization('u','p',p.id,'apply');expect(docs.get('projects/p/tasks/a')).toMatchObject({workState:{status:'hold',...d.workState},isCompleted:false});
  await actOnOrganization('u','p',p.id,'undo');expect(docs.get('projects/p/tasks/a')).toMatchObject({...before,updatedAt:expect.any(Date)});expect(docs.get('projects/p/tasks/a')?.workState).toBeUndefined();
 });
 it('persists a skipped proposal and treats source labels and reasoning changes as the same decision',async()=>{
  const p=await previewOrganization('u','p',source,change('a'));await actOnOrganization('u','p',p.id,'skip');
  const again=await previewOrganization('u','p',{...source,id:'another-file',title:'別題'},{...change('a'),reason:'別の理由文',speech:'report'});
  expect(again).toMatchObject({id:p.id,status:'skipped'});expect(await filterKnownOrganizationDrafts('u','p',{...source,title:'別名'},[change('a')])).toEqual([]);expect(docs.get('projects/p/tasks/a')?.title).toBe('案内文');
 });
 it('does not create a second task when the same accepted utterance gets a different AI title',async()=>{
  const d={kind:'create' as const,taskIds:[],title:'公開手順',description:'公開前に確認',assigneeIds:['u'],listId:'work',reason:'新しい成果',quote:'公開を確認'};
  const p=await previewOrganization('u','p',source,d);await actOnOrganization('u','p',p.id,'apply');
  await expect(previewOrganization('u','p',{...source,id:'new',title:'再読み込み'},{...d,title:'公開の手順を整える',description:'手順の内容を確認',reason:'別の理由'})).rejects.toMatchObject({status:409});
  expect([...docs.keys()].filter(path=>/^projects\/p\/tasks\/org-[^/]+$/.test(path))).toHaveLength(1);
 });
 it('rejects an older pending creation after its renamed version was accepted, without any writes',async()=>{
  const d={kind:'create' as const,taskIds:[],title:'公開手順',description:'公開前に確認',assigneeIds:['u'],listId:'work',reason:'新しい成果',quote:'公開を確認'};
  const original=await previewOrganization('u','p',source,d);
  const renamed=await previewOrganization('u','p',{...source,id:'edited-source',title:'別の資料名'},{...d,title:'公開の手順を整える',reason:'説明を編集'});
  expect(renamed.id).not.toBe(original.id);
  await actOnOrganization('u','p',renamed.id,'apply');
  const before=structuredClone([...docs]);
  await expect(actOnOrganization('u','p',original.id,'apply')).rejects.toMatchObject({status:409,message:expect.stringContaining('同じ発言')});
  expect([...docs]).toEqual(before);
  expect([...docs.keys()].filter(path=>/^projects\/p\/tasks\/org-[^/]+$/.test(path))).toHaveLength(1);
 });
 it('still accepts independent creations grounded in different utterances from the same meeting',async()=>{
  const meeting={...source,text:'公開を確認。申込先を整える。'};
  const d={kind:'create' as const,taskIds:[],title:'公開手順',assigneeIds:['u'],listId:'work',reason:'新しい成果',quote:'公開を確認'};
  const first=await previewOrganization('u','p',meeting,d);
  const second=await previewOrganization('u','p',meeting,{...d,title:'申込先',quote:'申込先を整える'});
  await actOnOrganization('u','p',first.id,'apply');await actOnOrganization('u','p',second.id,'apply');
  expect([...docs.keys()].filter(path=>/^projects\/p\/tasks\/org-[^/]+$/.test(path))).toHaveLength(2);
  expect(docs.get(`projects/p/tasks/org-${second.id}`)?.order).toBe(4);
 });
 it('rechecks newly introduced graph conflicts and stale completion evidence before adoption',async()=>{
  const p=await previewOrganization('u','p',source,{kind:'complete',taskIds:['a'],reason:'完了報告',quote:'公開を確認'});
  docs.get('projects/p/tasks/b')!.parentTaskId='a';await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toMatchObject({status:409});expect(docs.get('projects/p/tasks/a')?.isCompleted).toBe(false);
 });
});

describe('incoming source privacy and fresh grants',()=>{
 function incoming(){const now=new Date().toISOString();fake.incoming={snapshot:{checkedAt:now,incoming:{connectionEpoch:'epoch-1',sourceVersions:{'gmail:m1':'v1'},sources:{gmail:{connected:true,status:'ready',fetchedAt:now,items:[{id:'m1',title:'個人用の注文',text:'個人の注文番号 SECRET-1。注文と支払が完了。',at:now}]}}}}};return{kind:'incoming' as const,id:'gmail:m1',title:'ignored',text:'ignored',occurredAt:null,incoming:{service:'gmail' as const,id:'m1',version:'v1',connectionEpoch:'epoch-1'}};}
 it('retains original privately while sharing only explicitly written work changes',async()=>{const input=incoming();const p=await previewOrganization('u','p',input,{kind:'update',taskIds:['a'],targetTaskId:'a',description:'支払完了を本人が確認',reason:'本人が共有する進捗を指定',quote:'注文と支払が完了。'});await actOnOrganization('u','p',p.id,'apply');const publicRows=[...docs].filter(([path])=>path.startsWith('projects/'));expect(JSON.stringify(publicRows)).not.toContain('SECRET-1');expect(JSON.stringify(await readOrganizationSource('u','p',p.id))).toContain('SECRET-1');});
 it('rejects revoked/stale sources before apply and hides their private previews',async()=>{const input=incoming();const p=await previewOrganization('u','p',input,{kind:'update',taskIds:['a'],description:'本人が進捗を共有',reason:'照合済み',quote:'注文と支払が完了。'});fake.incoming={snapshot:{checkedAt:new Date().toISOString()}};await expect(actOnOrganization('u','p',p.id,'apply')).rejects.toThrow('許可範囲');expect(await listOrganization('u','p')).toEqual([]);await expect(readOrganizationSource('u','p',p.id)).rejects.toThrow('許可範囲');});
});
describe('AI meeting extraction',()=>{
 it('accepts grounded proposals and leaves missing owners/deadlines unset',async()=>{fake.aiText=JSON.stringify({drafts:[{kind:'create',taskIds:[],title:'公開を確認',description:'完了条件：案内文を確認して公開する',listId:'work',reason:'独立した成果の確認',quote:'公開を確認',speech:'request',confirmationPoints:[]}],issues:['担当・期限は未決定']});const result=await analyzeOrganization('u','p',source,'openai');expect(result.drafts[0].dueDate).toBeUndefined();expect(result.drafts[0].assigneeIds).toBeUndefined();expect(result.issues).toHaveLength(1);});
 it('rejects invented quotes and unknown task/person IDs',async()=>{fake.aiText=JSON.stringify({drafts:[{...draft,quote:'存在しない会議の発言'}],issues:[]});await expect(analyzeOrganization('u','p',source,'openai')).rejects.toThrow('引用');});
 it('does not call AI outside the authorized project scope',async()=>{docs.set('users/u/settings/aiSettings',{allowedProjectIds:['other']});await expect(analyzeOrganization('u','p',source,'openai')).rejects.toThrow('AI利用範囲');expect(fake.aiCalls).toBe(0);});
});


describe('reconsidering saved proposals', () => {
 it('refreshes a held proposal against current work without shared writes and guards later edits', async () => {
  const intent={kind:'update' as const,taskIds:['a'],description:'公開先を追記',reason:'追記',quote:'公開を確認'};
  const original=await previewOrganization('u','p',source,intent);
  await actOnOrganization('u','p',original.id,'hold');
  docs.get('projects/p/tasks/a')!.description='同僚が確認した最新の条件';
  const before=structuredClone([...docs].filter(([path])=>path.startsWith('projects/')));
  const fresh=await reconsiderOrganization('u','p',original.id);
  expect(fresh).toMatchObject({source,draft:intent,preview:{id:original.id,status:'pending'}});
  expect(fresh.preview.changes[0].before).toContain('同僚が確認した最新の条件');
  expect(fresh.preview.changes[0].after).toContain('公開先を追記');
  expect([...docs].filter(([path])=>path.startsWith('projects/'))).toEqual(before);
  expect(await listOrganization('u','p')).toHaveLength(1);
  expect(docs.get('users/u/secretary/state')).toMatchObject({revision:7,decisions:[{keep:true}]});
  docs.get('projects/p/tasks/a')!.description='照合後の編集';
  await expect(actOnOrganization('u','p',original.id,'apply')).rejects.toMatchObject({status:409});
  expect(docs.get('projects/p/tasks/a')!.description).toBe('照合後の編集');
 });
 it('resets confirmation and allows a fresh explicit confirmation before adoption',async()=>{
  const intent={kind:'complete' as const,taskIds:['a'],speech:'tentative' as const,reason:'完了を検討',quote:'公開を確認'};
  const original=await previewOrganization('u','p',source,intent,undefined,true);
  await actOnOrganization('u','p',original.id,'hold');
  const fresh=await reconsiderOrganization('u','p',original.id);
  expect(fresh.preview.canApply).toBe(false);
  await expect(actOnOrganization('u','p',original.id,'apply')).rejects.toThrow('確認');
  const confirmed=await previewOrganization('u','p',source,intent,undefined,true);
  await actOnOrganization('u','p',confirmed.id,'apply');
  expect(docs.get('projects/p/tasks/a')!.isCompleted).toBe(true);
  const before=structuredClone([...docs]);
  await expect(reconsiderOrganization('u','p',confirmed.id)).rejects.toMatchObject({status:409});
  expect([...docs]).toEqual(before);
 });
 it('does not reopen records after project permission is revoked',async()=>{
  const original=await previewOrganization('u','p',source,draft);
  await actOnOrganization('u','p',original.id,'hold');
  docs.get('projects/p/members/u')!.role='viewer';
  const before=structuredClone([...docs]);
  await expect(reconsiderOrganization('u','p',original.id)).rejects.toMatchObject({status:403});
  expect([...docs]).toEqual(before);
 });
});


describe('Moai label on AI-proposed new work',()=>{
 const proposal={kind:'create' as const,taskIds:[],title:'新しい準備',reason:'会議からの提案',quote:'公開を確認',aiSuggested:true};
 it('creates the label only upon adoption, reuses it, and never tags existing work merely being updated',async()=>{
  const p=await previewOrganization('u','p',source,proposal);
  expect(docs.has('projects/p/labels/ai-moai')).toBe(false);
  expect(p.warnings).toContain('新しく作る仕事に「モアイ」ラベルを付けます。');
  await actOnOrganization('u','p',p.id,'apply');
  expect(docs.get('projects/p/labels/ai-moai')).toMatchObject({name:'モアイ',projectId:'p'});
  expect(docs.get(`projects/p/tasks/org-${p.id}`)).toMatchObject({aiSuggested:true,labelIds:['ai-moai']});
  const q=await previewOrganization('u','p',{...source,text:'別の準備を始める'},{...proposal,title:'別の準備',quote:'別の準備'});
  await actOnOrganization('u','p',q.id,'apply');
  expect([...docs.keys()].filter(path=>path.startsWith('projects/p/labels/'))).toHaveLength(1);
  const update=await previewOrganization('u','p',source,{kind:'update',taskIds:['a'],description:'共有の追記',reason:'追記',quote:'公開を確認',aiSuggested:true});
  await actOnOrganization('u','p',update.id,'apply');
  expect(docs.get('projects/p/tasks/a')!.labelIds).toBeUndefined();
 });
 it('reuses a normal label with the same name and preserves its color',async()=>{
  docs.set('projects/p/labels/user-label',{name:'モアイ',color:'#ff0000'});
  const p=await previewOrganization('u','p',source,proposal);await actOnOrganization('u','p',p.id,'apply');
  expect(docs.get(`projects/p/tasks/org-${p.id}`)!.labelIds).toEqual(['user-label']);
  expect(docs.has('projects/p/labels/ai-moai')).toBe(false);
  expect(docs.get('projects/p/labels/user-label')!.color).toBe('#ff0000');
  await actOnOrganization('u','p',p.id,'undo');
  expect(docs.get(`projects/p/tasks/org-${p.id}`)!.isArchived).toBe(true);
  expect(docs.get('projects/p/labels/user-label')!.name).toBe('モアイ');
 });
 it('leaves manual creations untagged and does not make duplicates when provenance is added',async()=>{
  const manual={...proposal,aiSuggested:undefined};delete manual.aiSuggested;
  const p=await previewOrganization('u','p',source,manual);await actOnOrganization('u','p',p.id,'apply');
  expect(docs.get(`projects/p/tasks/org-${p.id}`)!.labelIds).toEqual([]);
  expect((await previewOrganization('u','p',source,proposal)).id).toBe(p.id);
  expect(docs.has('projects/p/labels/ai-moai')).toBe(false);
 });
});


it('returns saved AI provenance and checklist items without reinterpreting manual proposals',async()=>{
 const aiDraft={...draft,kind:'checklist' as const,aiSuggested:true,checklist:['入稿する','仕上がりを確認する']};
 const ai=await previewOrganization('u','p',source,aiDraft);
 expect(ai).toMatchObject({aiSuggested:true,checklist:aiDraft.checklist});
 const listed=await listOrganization('u','p');
 expect(listed.find(record=>record.id===ai.id)).toMatchObject({aiSuggested:true,checklist:aiDraft.checklist});
 const manual=await previewOrganization('u','p',source,draft);
 expect((await listOrganization('u','p')).find(record=>record.id===manual.id)?.aiSuggested).toBe(false);
});
