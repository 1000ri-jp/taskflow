import { expect,it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { workSupportContext } from './workContext';
const parent=viewTask({id:'parent',assigneeIds:['worker'],primaryAssigneeId:'worker',completionCriteria:'確認済みPDF'});
const review=viewTask({id:'review',parentTaskId:'parent',assigneeIds:['reviewer'],taskKind:'review_request',review:{round:1,request:'料金表を確認',policy:'any',responses:{},attachments:[],requestedAt:'2026-09-13T00:00:00Z'}});
it('uses the business role and current action without altering common facts',()=>{
 const before=structuredClone([parent,review]);
 const reviewer=workSupportContext(review,[parent,review],'reviewer','展示会で紹介する');
 expect(reviewer).toMatchObject({role:'確認担当',intent:'成果物を確認して返答する',purpose:'展示会で紹介する',review:{request:'料金表を確認'}});
 const returned={...review,review:{...review.review!,responses:{reviewer:{outcome:'changes_requested' as const,note:'金額を修正',at:'2026-09-13'}}}};
 expect(workSupportContext(returned,[parent,returned],'worker')).toMatchObject({role:'作業担当',intent:'修正して再提出する'});
 expect(workSupportContext(parent,[parent],'worker').role).toBe('主担当・判断担当');
 expect([parent,review]).toEqual(before);
});

it('describes waiting as checking the resume condition and retains the reviewer role after approval',()=>{
 const held={...parent,workState:{status:'wait' as const,reason:'素材待ち',resumeCondition:'受領する',reviewAt:null}};
 expect(workSupportContext(held,[held],'worker').intent).toBe('再開の条件を確認する');
 const approved={...review,isCompleted:true,review:{...review.review!,responses:{reviewer:{outcome:'approved' as const,note:'',at:'2026-09-13'}}}};
 expect(workSupportContext(approved,[parent,approved],'reviewer')).toMatchObject({role:'確認担当',intent:'引き継ぎの結果を確認する'});
});

it('keeps a stored midnight Japan deadline on the same calendar day in AI evidence',()=>{
 const dated={...parent,dueDate:new Date('2026-08-25T15:00:00.000Z')};
 expect(workSupportContext(dated,[dated],'worker').work.dueDate).toBe('2026-08-26');
});
