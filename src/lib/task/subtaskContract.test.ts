import {describe,it,expect} from 'vitest';
import {planWorkflow,taskVersion, type WorkflowAction} from './workflow';
import {expandTaskReviews,requiresReviewResponse} from './reviews';
import {getTaskSubtasks, moveTaskSubtask} from './subtasks';
import {completionBlockReason} from './completion';
import type {Task} from '@/types';
const date=new Date('2026-09-14T00:00:00Z');
const task=(id:string,extra:Partial<Task>={}):Task=>({id,projectId:'p',title:id,description:'旧本文',assigneeIds:['u'],dependsOnTaskIds:[],isArchived:false,isAbandoned:false,isCompleted:false,updatedAt:date,createdAt:date,order:1,...extra} as Task);
const parent=task('parent'),child=task('child',{parentTaskId:'parent',workState:{status:'hold',reason:'以前の状態',resumeCondition:'再開',reviewAt:null}});
const input=(t:Task,action:WorkflowAction)=>({id:'event',action,expectedVersion:taskVersion(t)});
it('changes title, date and multiple assignees without discarding old body, state or attachments',()=>{
 const original=structuredClone(child);
 const patch=planWorkflow(child,[parent,child],'u',{...input(child,'edit_subtask'),subtaskPatch:{title:' 新しい名前 ',dueDate:'2026-09-18',assigneeIds:['u','v']}},date).patch;
 expect(patch).toEqual({title:'新しい名前',dueDate:new Date('2026-09-18T00:00:00+09:00'),assigneeIds:['u','v']});expect(child).toEqual(original);
 expect(planWorkflow(child,[parent,child],'u',input(child,'complete'),date).patch.isCompleted).toBe(true);
});
it('rejects nested children and custom subtask fields regardless of entry point',()=>{
 const grand=task('grand',{parentTaskId:child.id});
 expect(()=>planWorkflow(child,[parent,child,grand],'u',{...input(child,'reparent'),parentTaskId:child.id},date)).toThrow();
 expect(()=>planWorkflow(parent,[parent,child],'u',{...input(parent,'reparent'),parentTaskId:child.id},date)).toThrow();
 expect(()=>planWorkflow(child,[parent,child],'u',input(child,'start'),date)).toThrow('完了チェック');
 expect(()=>planWorkflow(child,[parent,child],'u',{...input(child,'edit_subtask'),subtaskPatch:{dueDate:'2026-02-30'}},date)).toThrow();
});
it('sorts only direct subtasks by deadline, leaves undated last, and excludes review records',()=>{
 const later=task('later',{parentTaskId:'parent',dueDate:new Date('2026-09-20')}),earlier=task('earlier',{parentTaskId:'parent',dueDate:new Date('2026-09-15')});
 expect(getTaskSubtasks(parent,[child,later,task('review',{parentTaskId:'parent',taskKind:'review_request'}),earlier]).map(t=>t.id)).toEqual(['earlier','later','child']);
});
it('uses parent-saved order first and deadline order for new unlisted subtasks',()=>{
 const late=task('late',{parentTaskId:'parent',dueDate:new Date('2026-09-20')}),early=task('early',{parentTaskId:'parent',dueDate:new Date('2026-09-15')}),fresh=task('fresh',{parentTaskId:'parent',dueDate:new Date('2026-09-10')});
 const saved={...parent,subtaskOrderIds:['late','early']};
 expect(getTaskSubtasks(saved,[fresh,early,late]).map(t=>t.id)).toEqual(['late','early','fresh']);
});
it('moves a subtask to the target position without mutating IDs and rejects stale input',()=>{
 const ids=['a','b','c'];expect(moveTaskSubtask(ids,'a','c')).toEqual(['b','c','a']);expect(ids).toEqual(['a','b','c']);
 expect(moveTaskSubtask(ids,'a','a')).toEqual(ids);expect(()=>moveTaskSubtask(ids,'missing','b')).toThrow('変更されています');
});
describe('parent conversation projection',()=>{
 const request={commentId:'c',assigneeIds:['u','v'],dueDate:null,createdBy:'u',createdAt:date.toISOString(),updatedAt:date.toISOString(),cycle:{policy:'all' as const,round:1,request:'PDFを確認',attachments:[],requestedAt:date.toISOString(),responses:{}}};
 it('keeps requests in their parent and projects only for existing response and search logic',()=>{
  const p=task('parent',{reviewRequests:{'review-c':request}});const all=expandTaskReviews([p,child]);
  expect(all).toHaveLength(3);expect(expandTaskReviews(all)).toHaveLength(3);expect(p.reviewRequests).toEqual({'review-c':request});
  const review=all[2];expect(review.reviewRecordId).toBe('review-c');expect(getTaskSubtasks(p,all)).toEqual([child]);expect(requiresReviewResponse(review,'u')).toBe(true);expect(completionBlockReason(p,all)).toContain('返答');
  const approved={...review,...planWorkflow(review,all,'u',input(review,'approve'),date).patch};expect(requiresReviewResponse(approved,'u')).toBe(false);expect(requiresReviewResponse(approved,'v')).toBe(true);expect(approved.isCompleted).toBe(false);
 });
 it('never replaces a legacy review document or its history with a projection',()=>{
  const legacy=task('review-c',{taskKind:'review_request',description:'既存記録',parentTaskId:'parent'});expect(expandTaskReviews([task('parent',{reviewRequests:{'review-c':request}}),legacy])[1]).toBe(legacy);
 });
});

it('resumes only a held parent without bypassing its prerequisites or changing completion',()=>{
 const held=task('held',{workState:{status:'hold',reason:'準備中',resumeCondition:'素材が届いたら',reviewAt:null},dependsOnTaskIds:['missing']});
 const patch=planWorkflow(held,[held],'u',input(held,'resume'),date).patch;expect(patch).toEqual({workState:null});expect(completionBlockReason({...held,...patch},[held])).toContain('前提');
 expect(()=>planWorkflow(child,[parent,child],'u',input(child,'resume'),date)).toThrow('完了チェック');
});
