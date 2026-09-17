// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {prepareWorkSupport} from './work';
import {DEFAULT_AI_SUPPORT} from './profile';
const fake=vi.hoisted(()=>({db:null as unknown,send:vi.fn(),key:vi.fn()}));
vi.mock('@/lib/firebase/admin',()=>({getAdminDb:()=>fake.db,getUserAIApiKey:fake.key}));
vi.mock('@/lib/ai/providers',()=>({getProvider:()=>({sendMessage:fake.send})}));
type Row=Record<string,unknown>;
let docs:Map<string,Row>;
class Ref {
 constructor(public path:string){} get id(){return this.path.split('/').at(-1)!;}
 collection(name:string){return new Query(`${this.path}/${name}`);}
 async get(){const value=docs.get(this.path);return{id:this.id,exists:!!value,data:()=>value?structuredClone(value):undefined};}
}
class Query{
 maximum=Infinity;filter?:[string,unknown];constructor(public path:string){}
 where(field:string,_op:string,value:unknown){this.filter=[field,value];return this;}
 limit(n:number){this.maximum=n;return this;}
 async get(){const rows=await Promise.all([...docs.keys()].filter(p=>p.startsWith(`${this.path}/`)&&p.split('/').length===this.path.split('/').length+1&&(!this.filter||docs.get(p)?.[this.filter[0]]===this.filter[1])).slice(0,this.maximum).map(p=>new Ref(p).get()));return{docs:rows,size:rows.length};}
}
beforeEach(()=>{
 vi.clearAllMocks();docs=new Map();fake.db={doc:(p:string)=>new Ref(p),collection:(p:string)=>new Query(p),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:(ref:Ref|Query)=>ref.get()})};
 docs.set('projects/p',{description:'金曜の入稿に向けた仕事',memberIds:['reviewer','worker'],isArchived:false});
 for(const id of ['reviewer','worker']){docs.set(`projects/p/members/${id}`,{userId:id,role:'editor'});docs.set(`users/${id}`,{displayName:id==='reviewer'?'確認する人':'制作する人'});}
 docs.set('users/reviewer/settings/aiSupport',{...DEFAULT_AI_SUPPORT,wishes:'短く',referenceNotes:'参考資料PRIVATE'});
 const date=new Date('2026-09-13T00:00:00Z');const base={projectId:'p',updatedAt:date,createdAt:date,dueDate:date,description:'',isCompleted:false,isArchived:false,isAbandoned:false,assigneeIds:['worker'],dependsOnTaskIds:[]};
 docs.set('projects/p/tasks/work',{...base,title:'チラシ制作',completionCriteria:'確認済みPDF'});
 docs.set('projects/p/tasks/review',{...base,title:'初稿の確認',taskKind:'review_request',parentTaskId:'work',assigneeIds:['reviewer'],review:{round:2,policy:'any',request:'金額を修正しました',attachments:[{name:'v2.pdf',type:'application/pdf'}],responses:{},requestedAt:date.toISOString()}});
 fake.key.mockResolvedValue('test-key');
 fake.send.mockImplementation(async function*(){yield{type:'text',content:'提出者の修正メモによると、金額が変わっています。資料で確認してください。'};});
});
it('sends the authenticated role, current intent, evidence boundary and own preference to the real provider interface without any writes',async()=>{
 const before=structuredClone([...docs]);const result=await prepareWorkSupport('reviewer','p','review','gemini','model','全体を見たい');
 const [messages,context,key,model,options]=fake.send.mock.calls[0];
 expect(JSON.parse(messages[0].content)).toMatchObject({context:{role:'確認担当',intent:'成果物を確認して返答する',review:{request:'金額を修正しました',source:'提出者の修正メモ'}}});
 expect(context.user.id).toBe('reviewer');expect(key).toBe('test-key');expect(model).toBe('model');
 expect(options).toMatchObject({enableTools:false,supportInstructions:expect.stringContaining('全体を見たい'),systemPrompt:expect.stringContaining('PDF本文や画像は読んでいません')});
 expect(options.supportInstructions).toContain('短く');expect(result.text).toContain('提出者');expect([...docs]).toEqual(before);
});
it.each(['membership','scope','viewer'] as const)('does not send content to AI when access is unavailable: %s',async(kind)=>{
 if(kind==='membership')docs.get('projects/p')!.memberIds=['worker'];
 if(kind==='scope')docs.set('users/reviewer/settings/aiSettings',{allowedProjectIds:[]});
 if(kind==='viewer')docs.get('projects/p/members/reviewer')!.role='viewer';
 await expect(prepareWorkSupport('reviewer','p','review','gemini')).rejects.toThrow('権限');expect(fake.send).not.toHaveBeenCalled();
});
it.each(['task','access','profile'] as const)('discards generated content when its source changes during generation: %s',async(kind)=>{
 fake.send.mockImplementation(async function*(){
  if(kind==='task')docs.get('projects/p/tasks/work')!.completionCriteria='新しい条件';
  if(kind==='access')docs.get('projects/p')!.memberIds=[];
  if(kind==='profile')docs.get('users/reviewer/settings/aiSupport')!.enabled=false;
  yield{type:'text',content:'古い結果'};
 });
 await expect(prepareWorkSupport('reviewer','p','review','gemini')).rejects.toThrow();
});
it('honors disabling personalization and rejects attempted tool execution',async()=>{
 docs.get('users/reviewer/settings/aiSupport')!.enabled=false;
 await prepareWorkSupport('reviewer','p','review','gemini');expect(fake.send.mock.calls[0][4].supportInstructions).toBe('');
 fake.send.mockImplementation(async function*(){yield{type:'tool_calls',toolCalls:[]};});
 await expect(prepareWorkSupport('reviewer','p','review','gemini')).rejects.toThrow('準備以外');
});
