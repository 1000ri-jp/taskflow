// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePurchaseReport } from './prepare';
import type { SecretaryTask } from '@/lib/secretary/types';

const deps=vi.hoisted(()=>({load:vi.fn(),automation:vi.fn(),send:vi.fn(),key:vi.fn()}));
vi.mock('@/lib/secretary/repository',()=>({loadSecretary:deps.load}));
vi.mock('../automationRepository',()=>({readAutomation:deps.automation,AutomationError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
vi.mock('@/lib/firebase/admin',()=>({getUserAIApiKey:deps.key}));
vi.mock('@/lib/ai/providers',()=>({getProvider:()=>({sendMessage:deps.send})}));
const task=(patch:Partial<SecretaryTask>={}):SecretaryTask=>({key:'p/parent',projectId:'p',taskId:'parent',projectName:'架空の展示会',title:'名刺を発注する',description:'名刺の受取',listName:'',assigneeIds:['u'],startDate:null,dueDate:null,isDueDateFixed:false,dependsOn:[],priority:null,isCompleted:false,isAbandoned:false,isArchived:false,completedAt:null,comments:[],complete:true,canWrite:true,version:'1',context:{projectDescription:'',parentState:'unset',parent:null,milestoneState:'unset',milestone:null,taskKind:'task',sourceComment:null},...patch});
const report={merchant:'',orderNumber:'',item:'名刺',orderedOn:null,stage:'received',expectedDate:null,sourceText:'名刺を受け取りました。',question:'',taskKeys:['p/parent']};
const view=(tasks:SecretaryTask[])=>({snapshot:{tasks}});
beforeEach(()=>{
 vi.clearAllMocks();deps.key.mockResolvedValue('synthetic-key');deps.automation.mockResolvedValue({grants:[]});deps.load.mockResolvedValue(view([task()]));
 deps.send.mockImplementation(async function*(){yield {type:'text',content:JSON.stringify(report)};});
});
describe('purchase preparation keeps reporting independent of tracking',()=>{
 it.each(['completed','abandoned'] as const)('keeps a %s parent available for a report without inventing an order number',async state=>{
  deps.load.mockResolvedValue(view([task(state==='completed'?{isCompleted:true}:{isAbandoned:true})]));
  const result=await preparePurchaseReport('u','名刺を受け取りました。',undefined,'gemini');
  expect(result.candidates).toEqual([expect.objectContaining({key:'p/parent',trackingAvailable:false})]);expect(result.suggested).toEqual(['p/parent']);expect(result.report.orderNumber).toBe('');
 });
 it('continues preparing a report when tracking state is unavailable and marks that context unknown',async()=>{
  deps.automation.mockRejectedValue(new Error('synthetic unavailable'));
  const result=await preparePurchaseReport('u','受取報告',undefined,'gemini');
  expect(result.candidates).toHaveLength(1);
  expect(JSON.parse(deps.send.mock.calls[0][0][0].content).tasks[0]).toMatchObject({existingOrder:null,existingOrderAvailable:false});
 });
 it('rechecks access after model preparation and removes revoked or archived targets',async()=>{
  deps.load.mockResolvedValueOnce(view([task()])).mockResolvedValueOnce(view([task({canWrite:false})]));
  const result=await preparePurchaseReport('u','受取報告',undefined,'gemini');expect(result.candidates).toEqual([]);expect(result.suggested).toEqual([]);
 });
 it('never exposes archived parents or child tasks as report destinations',async()=>{
  const parent=task();deps.load.mockResolvedValue(view([task({isArchived:true}),task({key:'p/child',taskId:'child',context:{...parent.context!,parentState:'ready'}})]));
  const result=await preparePurchaseReport('u','受取報告',undefined,'gemini');expect(result.candidates).toEqual([]);expect(JSON.parse(deps.send.mock.calls[0][0][0].content).tasks).toEqual([]);
 });
});
