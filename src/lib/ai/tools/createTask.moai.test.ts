import { beforeEach, expect, it, vi } from 'vitest';
import { createTaskHandler, createTasksHandler } from './createTask';
import { executeTaskPlanHandler } from './planGeneration';
import { createTask } from '@/lib/firebase/firestore';
vi.mock('@/lib/firebase/firestore',()=>({createTask:vi.fn(),getProjectTasks:async()=>[]}));
const context={scope:'project' as const,projectId:'p',userId:'u',listId:'work'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(createTask).mockResolvedValue('created');});
it('identifies AI single and batch creation at the shared save boundary',async()=>{
 await createTaskHandler({title:'単独'},context);
 await createTasksHandler({tasks:[{title:'その1'},{title:'その2'}]},context);
 expect(createTask).toHaveBeenCalledTimes(3);
 for(const [project,task] of vi.mocked(createTask).mock.calls){expect(project).toBe('p');expect(task.aiSuggested).toBe(true);}
});
it('identifies tasks adopted from an AI plan and creates nothing for invalid dates',async()=>{
 const task={tempId:'1',title:'計画',description:'',durationDays:1,startDate:'2026-09-20',dueDate:'2026-09-20',dependsOnTempIds:[],priority:'medium' as const};
 const result=await executeTaskPlanHandler({listId:'work',tasks:[task,{...task,tempId:'2',startDate:'2026-09-25'}]},context);
 expect(createTask).toHaveBeenCalledTimes(1);expect(vi.mocked(createTask).mock.calls[0][1].aiSuggested).toBe(true);
 expect(result.createdTasks.filter(task=>task.success)).toHaveLength(1);
});
