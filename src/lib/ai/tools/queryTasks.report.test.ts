import {beforeEach,it,expect,vi} from 'vitest';
import {getTask,getTaskComments,getProjectTasks} from '@/lib/firebase/firestore';
import {getTaskDetailsHandler} from './queryTasks';
import type {Task,Comment} from '@/types';
vi.mock('@/lib/firebase/firestore',()=>({getTask:vi.fn(),getProjectTasks:vi.fn(),getProjectLists:vi.fn().mockResolvedValue([]),getTaskChecklists:vi.fn().mockResolvedValue([]),getTaskComments:vi.fn()}));
const context={scope:'personal' as const,projectId:'',projectIds:['allowed'],userId:'u'};
beforeEach(()=>{vi.clearAllMocks();
 const task={id:'t',title:'名刺を発注する',parentTaskId:null,startDate:null,dueDate:new Date('2026-09-20'),durationDays:null,isCompleted:false,completedAt:null,assigneeIds:['u'],labelIds:[],dependsOn:[],automation:{ownerId:'u',merchant:'マヒトデザイン',stage:'shipped',expectedDate:'2026-09-18'}} as unknown as Task;
 vi.mocked(getTask).mockResolvedValue(task);vi.mocked(getProjectTasks).mockResolvedValue([task]);
 vi.mocked(getTaskComments).mockResolvedValue(Array.from({length:7},(_,i)=>({id:String(i),content:`報告${i}`,authorId:'u',createdAt:new Date(2026,8,i+1)})) as Comment[]);
});
it('exposes the same shared order status, ETA and recent reports as task detail',async()=>{
 const {task}=await getTaskDetailsHandler({projectId:'allowed',taskId:'t'},context);
 expect(task.automation).toMatchObject({stage:'shipped',expectedDate:'2026-09-18'});expect(task.dueDate).toBe('2026-09-20');expect(task.isCompleted).toBe(false);
 expect(task.recentReports.map(r=>r.content)).toEqual(['報告2','報告3','報告4','報告5','報告6']);
});
it('rejects projects outside the permitted AI scope before reading data',async()=>{
 await expect(getTaskDetailsHandler({projectId:'other',taskId:'t'},context)).rejects.toThrow('対象プロジェクト');expect(getTask).not.toHaveBeenCalled();
});
