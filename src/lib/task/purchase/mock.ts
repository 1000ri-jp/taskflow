'use client';
import {useAuthStore} from '@/stores/authStore';
import {mutateOrganizationMock,ORGANIZATION_MOCK_PROJECT as projectId} from '../organizationMock';
import {mockAutomationRequest} from '../automationMock';
import {submitTaskCommentToMockState} from '../detailMock';
import {mergePurchaseProgress} from './types';
import type {PurchasePreparation} from './client';
import {parsePurchaseSubmission,purchaseReportText,type PurchaseSubmission} from './submission';
import type {AutomationGrant,TaskEvidenceRule,TaskAutomationSummary} from '../automationTypes';
const taskId='purchase-business-cards';
const version=(task:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(task).filter(([k])=>k!=='automation')));
export async function preparePurchaseExample(completed=false):Promise<PurchasePreparation>{
 const uid=useAuthStore.getState().user?.id;if(!uid)throw new Error('ログインを確認してください。');
 const exampleTaskId=completed?`${taskId}-completed`:taskId;
 const orderedOn=new Date(Date.now()-86400000).toISOString().slice(0,10);
 await mutateOrganizationMock(projectId,work=>{
  if(!work.data.tasks[exampleTaskId])work.data.tasks[exampleTaskId]={...work.data.tasks.draft,title:'名刺を発注する',description:'注文した名刺を受け取り、内容を確認する。',isCompleted:completed,completedAt:completed?new Date():null,parentTaskId:null,createdAt:new Date(orderedOn),dueDate:new Date(Date.now()+3*86400000),assigneeIds:[uid]};
 });
 return {report:{merchant:'マヒトデザイン',item:'名刺',orderNumber:completed?'':'TF-DEMO-0914',orderedOn,stage:completed?'received':'ordered',expectedDate:null,sourceText:completed?'名刺を受け取りました。注文番号は手元にありません。':'マヒトデザインで名刺を注文しました。注文番号 TF-DEMO-0914。',question:''},candidates:[{key:`${projectId}/${exampleTaskId}`,projectId,taskId:exampleTaskId,projectName:'架空の制作',title:completed?'名刺を発注する（完了済み）':'名刺を発注する',trackingAvailable:!completed}],suggested:[`${projectId}/${exampleTaskId}`]};
}
export async function savePurchaseMock(raw:PurchaseSubmission){
 const input=parsePurchaseSubmission(raw),uid=useAuthStore.getState().user?.id;if(!uid)throw new Error('ログインを確認してください。');
 return mutateOrganizationMock(input.projectId,work=>{
  const task=work.data.tasks[input.taskId];if(!task||!work.data.memberIds.includes(uid))throw new Error('仕事を確認できません。');
  const receipt=work.activityLogs.find(l=>l.id===`purchase-${input.id}`);
  if(receipt){if(receipt.userId!==uid||receipt.targetId!==input.taskId)throw new Error('受付先が一致しません。');return {commentId:input.id,taskId:input.taskId,tracked:receipt.tracked===true,alreadyApplied:true};}
  const commentReceipt=work.activityLogs.find(l=>l.id===`comment-${input.id}`);
  if(commentReceipt){if(commentReceipt.userId!==uid||commentReceipt.sourceTaskId!==input.taskId)throw new Error('受付先が一致しません。');return {commentId:input.id,taskId:input.taskId,tracked:false,alreadyApplied:true};}
  if(!input.track){const result=submitTaskCommentToMockState(work,{id:input.id,projectId:input.projectId,taskId:input.taskId,authorId:uid,authorName:'本人',content:purchaseReportText(input.report),purpose:'memo',notifyIds:[],review:null,attachments:input.attachment?[input.attachment]:[]});return {commentId:result.commentId,taskId:input.taskId,tracked:false,alreadyApplied:result.alreadySubmitted};}
  if(task.parentTaskId||task.taskKind==='review_request'||task.isArchived||task.isAbandoned||task.isCompleted)throw new Error('未完了の親タスクを選んでください。');
  if(work.data.children[`tasks/${input.taskId}/comments/${input.id}`])throw new Error('同じ投稿IDが既にあります。');
  if((task.automation as TaskAutomationSummary|undefined)?.ownerId && (task.automation as TaskAutomationSummary).ownerId!==uid)throw new Error('別の担当者がこの仕事を追跡しています。');
  const state=work.automationStates?.[uid]??{uid,automationEnabled:false,revision:0,grants:[],reminders:[]};
  const previous=state.grants.find(g=>g.rule.projectId===input.projectId&&g.rule.taskId===input.taskId);
  if(previous&&(!previous.rule.order||previous.rule.order.merchant!==input.report.merchant||previous.rule.order.orderNumber!==input.report.orderNumber))throw new Error('この仕事では別の注文を追跡しています。');
  const {merchant,orderNumber,item,orderedOn}=input.report,now=new Date(),at=now.toISOString();
  const rule:TaskEvidenceRule={projectId:input.projectId,taskId:input.taskId,order:{merchant,orderNumber,item,orderedOn},enabled:input.track,subject:item,period:orderedOn??'',person:uid,sender:'',criterion:'tracking',allowExpectedDate:false,sources:['gmail']};
  const grant:AutomationGrant={rule,uid,grantedAt:at,notBefore:orderedOn?new Date(orderedOn).toISOString():at,connectionEpoch:'mock',expectedTaskVersion:version(task),check:input.track?'unconfirmed':'revoked',checkedAt:null,reason:'架空の購入報告',latestEvidenceAt:null,stage:input.report.stage,ownedCompletion:false,records:[]};
  const progress=mergePurchaseProgress(previous?.stage??null,(task.automation as TaskAutomationSummary|undefined)?.expectedDate??null,input.report);
  grant.stage=progress.stage;grant.records=previous?.records??[];
  if(previous)state.grants[state.grants.indexOf(previous)]=grant;else state.grants.push(grant);state.revision++;state.automationEnabled=state.grants.some(g=>g.rule.enabled);work.automationStates={...work.automationStates,[uid]:state};
  work.data.children[`tasks/${input.taskId}/comments/${input.id}`]={taskId:input.taskId,content:purchaseReportText(input.report),authorId:uid,authorLabel:'本人',purpose:'memo',mentions:[],attachments:[],createdAt:now,updatedAt:now};
  task.automation={ownerId:uid,merchant,sourceCommentId:input.id,stage:progress.stage,check:'confirmed',checkedAt:at,evidenceAt:at,expectedDate:progress.expectedDate};
  work.activityLogs.push({id:`purchase-${input.id}`,targetId:input.taskId,userId:uid,tracked:input.track,createdAt:now});
  return {commentId:input.id,taskId:input.taskId,tracked:input.track,alreadyApplied:false};
 });
}
export async function simulatePurchaseMail(kind:'printing'|'shipment'|'delay'|'received'){
 const uid=useAuthStore.getState().user?.id;if(!uid)return;
 const day=(offset:number)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
 const text={printing:'印刷を開始しました。',shipment:`発送しました。お届け予定日：${day(2)}`,delay:`お届け予定日：${day(5)}`,received:'配達完了。'}[kind];
 return mockAutomationRequest(uid,{action:'evidence',evidence:{id:`purchase-${kind}`,version:'1',source:'gmail',at:new Date().toISOString(),text:`マヒトデザイン 注文番号 TF-DEMO-0914\n${text}`,sender:'order@example.test',authorId:'',url:'https://example.test/mock-mail'}});
}

export async function simulateUrgentRequest(){
 await preparePurchaseExample();
 const uid=useAuthStore.getState().user?.id;if(!uid)return;
 const {submitTaskCommentMock}=await import('../detailMock');
 await submitTaskCommentMock({id:crypto.randomUUID(),projectId,taskId,authorId:'demo-colleague',authorName:'同僚',content:'入稿前の名刺を確認してください。',notifyIds:[],attachments:[],purpose:'review_request',review:{content:'入稿前の名刺を確認してください。',assigneeIds:[uid],dueDate:new Date().toISOString().slice(0,10),urgency:'urgent'}});
}
