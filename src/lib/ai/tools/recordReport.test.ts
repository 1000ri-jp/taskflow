import {beforeEach,it,expect,vi} from 'vitest';
import {getTask} from '@/lib/firebase/firestore';
import {submitTaskComment} from '@/lib/firebase/commentSubmission';
import {recordReportHandler} from './recordReport';
import type {Task} from '@/types';
const owner=vi.hoisted(()=>({id:'u',displayName:'本人'}));
vi.mock('@/stores/authStore',()=>({useAuthStore:{getState:()=>({user:owner})}}));
vi.mock('@/lib/firebase/firestore',()=>({getTask:vi.fn()}));
vi.mock('@/lib/firebase/commentSubmission',()=>({submitTaskComment:vi.fn().mockResolvedValue({alreadySubmitted:false})}));
const context={scope:'personal' as const,projectId:'',projectIds:['p'],userId:'u',sourceUserMessage:{id:'message1',content:'案内文の修正が終わったよ。記録して。'}};
beforeEach(()=>{vi.clearAllMocks();owner.id='u';vi.mocked(getTask).mockResolvedValue({id:'parent',updatedAt:new Date('2026-09-14'),parentTaskId:null,title:'案内文'} as unknown as Task);});
it('uses the parent and an idempotent receipt, retaining the exact report with no implicit notification',async()=>{
 vi.mocked(getTask).mockResolvedValueOnce({id:'child',parentTaskId:'parent'} as unknown as Task);
 await recordReportHandler({projectId:'p',taskId:'child',quote:'案内文の修正が終わったよ。'},context);
 const saved=vi.mocked(submitTaskComment).mock.calls[0][0];expect(saved).toMatchObject({taskId:'parent',content:'案内文の修正が終わったよ。',notifyIds:[],review:null});
 await recordReportHandler({projectId:'p',taskId:'parent',quote:'案内文の修正が終わったよ。'},context);expect(vi.mocked(submitTaskComment).mock.calls[1][0].id).toBe(saved.id);
});
it('rejects invented reports and disallowed projects',async()=>{
 await expect(recordReportHandler({projectId:'p',taskId:'parent',quote:'発送しました'},context)).rejects.toThrow('本人の報告');
 await expect(recordReportHandler({projectId:'other',taskId:'parent',quote:'案内文'},context)).rejects.toThrow('対象外');expect(submitTaskComment).not.toHaveBeenCalled();
});
