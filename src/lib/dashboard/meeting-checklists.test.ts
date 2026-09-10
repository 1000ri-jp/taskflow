import { describe,expect,it } from 'vitest';
import type { DashboardTask } from './brief';
import { MEETING_PROPOSALS } from './meeting-proposals';
import { checklistDestination,checklistItems,validChecklistDate,validChecklistItemKey } from './meeting-checklists';
const project = {id:'p',name:'イベント'};
const task: DashboardTask = {
  id:'d',projectId:'p',projectName:'イベント',listId:'l',title:'東京ゲームダンジョン',description:'',order:0,
  assigneeIds:[],labelIds:[],tagIds:[],dependsOnTaskIds:[],priority:null,startDate:null,dueDate:null,durationDays:null,isDueDateFixed:false,
  isCompleted:false,completedAt:null,isAbandoned:false,isArchived:false,archivedAt:null,archivedBy:null,
  createdBy:'u',createdAt:new Date(2026,8,1),updatedAt:new Date(2026,8,1),
};
describe('checklist destinations and personal items',()=>{
  it('keeps the two user-specified events distinct and other destinations unset',()=>{
    const show = {...task,id:'s',title:'東京ゲームショウ2026'};
    expect(checklistDestination('ex-submit',[task,show],[project],true).task?.id).toBe('d');
    expect(checklistDestination('ex-attend',[task,show],[project],true).task?.id).toBe('s');
    expect(checklistDestination('ex-pack',[task,show],[project],true).state).toBe('unset');
  });
  it('does not guess duplicate, missing or inaccessible destinations',()=>{
    expect(checklistDestination('ex-submit',[task,{...task,id:'other'}],[project],true).state).toBe('ambiguous');
    expect(checklistDestination('ex-submit',[task],[],true).task).toBeUndefined();
    expect(checklistDestination('ex-submit',[{...task,isArchived:true}],[project],true).task).toBeUndefined();
    expect(checklistDestination('ex-submit',[task],[project],false).state).toBe('loading');
    const placement={projectId:'p',taskId:'deleted',title:'準備'};
    expect(checklistDestination('ex-submit',[task],[project],true,placement).state).toBe('missing');
  });
  it('accepts a human-selected parent independently of task name hints',()=>{
    const parent={...task,id:'other',title:'その他の展示会'};
    expect(checklistDestination('ex-submit',[task,parent],[project],true,{projectId:'p',taskId:'other',title:'準備'}).task?.id).toBe('other');
  });
  it('splits each into three stable items and keeps identities across display-name aliases',()=>{
    const proposal=MEETING_PROPOSALS.find(p=>p.id==='EX-9')!;
    const entries=checklistItems(proposal);
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map(e=>e.key)).size).toBe(3);
    expect(checklistItems(proposal,'Naofumi・*こずえ・Kaori').map(e=>e.key)).toEqual(entries.map(e=>e.key));
    expect(checklistItems(proposal,'')).toEqual([]);
    expect(checklistItems(proposal,'こずえ・Kozue')).toHaveLength(1);
    expect(checklistItems(MEETING_PROPOSALS.find(p=>p.id==='EX-3')!)).toHaveLength(1);
    expect(entries.every(e=>validChecklistItemKey(e.key))).toBe(true);
    expect(validChecklistItemKey('TF-7')).toBe(false);
    expect(validChecklistItemKey('EX-9')).toBe(false);
  });
  it('validates dates without inventing missing dates',()=>{
    expect(validChecklistDate('')).toBe(true);
    expect(validChecklistDate('2026-09-13')).toBe(true);
    expect(validChecklistDate('2026-02-31')).toBe(false);
    expect(validChecklistDate('明日')).toBe(false);
  });
});
