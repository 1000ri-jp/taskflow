import { describe, expect, it } from 'vitest';
import { planOrganization, validateOrganizationDraft, type OrganizationData } from './organizationEngine';
import type { OrganizationDraft } from './organizationTypes';
const now='2026-09-12T01:00:00.000Z';
const source={kind:'meeting' as const,id:'meeting-1',title:'朝会',text:'案内文を確認して公開する',occurredAt:'2026-09-12T00:00:00Z'};
const task=(title:string)=>({title,description:'完了条件：案内文を確認して公開する',listId:'work',assigneeIds:['u'],dependsOnTaskIds:[],relatedTaskIds:[],isCompleted:false,isArchived:false,isAbandoned:false});
const fixture=():OrganizationData=>({tasks:{a:task('案内文'),b:task('公開用案内文'),c:task('レビュー')},children:{'tasks/b/comments/c':{content:'確認をお願い',attachments:[{url:'https://example.test/file'}],authorId:'u'},'tasks/b/attachments/a':{url:'https://example.test/file'},'tasks/b/checklists/l':{items:[{id:'i',text:'確認',isChecked:true}]}},memberIds:['u','v'],listIds:['work']});
const draft=(patch:Partial<OrganizationDraft>):OrganizationDraft=>({kind:'update',taskIds:['a'],targetTaskId:'a',reason:'同じ公開成果物を整理',quote:'案内文を確認',...patch});
const plan=(d:OrganizationDraft,data=fixture())=>planOrganization(data,'p','u','test-op',source,d,now);
describe('common work organization',()=>{
  it('appends update without discarding accepted description and keeps unrequested owner/date',()=>{
    const p=plan(draft({description:'公開日時を相談する'}));
    expect(p.writes[0].after.description).toContain('完了条件');expect(p.writes[0].after.description).toContain('公開日時');expect(p.writes[0].after.assigneeIds).toEqual(['u']);
  });
  it('renames and explicitly replaces a description, including clearing it, without touching completion',()=>{
    const p=plan(draft({title:'公開する案内',description:'新しい完了条件',descriptionMode:'replace'}));
    expect(p.writes[0].after).toMatchObject({title:'公開する案内',description:'新しい完了条件',isCompleted:false});
    expect(p.preview.changes[0].fields).toContainEqual({field:'title',before:'案内文',after:'公開する案内'});
    expect(plan(draft({description:'',descriptionMode:'replace'})).writes[0].after.description).toBe('');
  });
  it('omits already reflected changes without updating order or timestamps',()=>{
    const p=plan(draft({title:'案内文',description:'完了条件：案内文を確認して公開する'}));
    expect(p.writes).toEqual([]);expect(p.preview.canApply).toBe(false);expect(p.preview.warnings.join('')).toContain('変更はありません');
  });
  it('keeps start date and reconciles duration when changing a fixed deadline',()=>{
    const f=fixture();f.tasks.a.startDate=new Date('2026-09-10T14:00:00Z');f.tasks.a.durationDays=2;f.tasks.a.isDueDateFixed=false;
    expect(plan(draft({dueDate:'2026-09-14'}),f).writes[0].after).toMatchObject({startDate:f.tasks.a.startDate,durationDays:5,isDueDateFixed:true});
    expect(()=>plan(draft({dueDate:'2026-09-09'}),f)).toThrow('開始日');
  });
  it.each(['hold','wait'] as const)('stores a shared %s reason, condition and optional date while preserving work completion',kind=>{
    const f=fixture();const original=structuredClone(f);
    const p=plan(draft({kind,workState:{reason:'素材が未着',resumeCondition:'画像が届いたら',reviewAt:'2026-09-20'}}),f);
    expect(p.writes[0].after).toMatchObject({workState:{status:kind,reason:'素材が未着',resumeCondition:'画像が届いたら',reviewAt:'2026-09-20'},isCompleted:false,isAbandoned:false});
    expect(p.preview.canApply).toBe(true);expect(f).toEqual(original);
    f.tasks.a=p.writes[0].after;
    expect(plan(draft({kind:'resume'}),f).writes[0].after.workState).toBeNull();
  });
  it('requires confirmation for uncertain speech but does not permit a third hierarchy level',()=>{
    const d=draft({kind:'complete',speech:'tentative',confirmationPoints:['完了した範囲を確認']});
    expect(plan(d).preview.canApply).toBe(false);
    expect(planOrganization(fixture(),'p','u','op',source,d,now,{confirmed:true}).preview.canApply).toBe(true);
    const f=fixture();f.tasks.b.parentTaskId='a';f.tasks.b.isCompleted=true;f.tasks.c.parentTaskId='b';
    f.children['tasks/a/checklists/steps']={items:[{id:'unchecked',isChecked:false}]};
    expect(()=>planOrganization(f,'p','u','op',source,d,now,{confirmed:true})).toThrow('二段');
    f.tasks.c.parentTaskId='a';
    expect(planOrganization(f,'p','u','op',source,d,now,{confirmed:true}).preview.canApply).toBe(true);
  });
  it('blocks completion when a required person, archived child or prerequisite is unresolved',()=>{
    const f=fixture();f.tasks.a.completionPolicy={required:[{taskId:'b',assigneeId:'v'}]};f.tasks.b.isCompleted=true;f.tasks.b.isArchived=true;f.tasks.a.dependsOnTaskIds=['missing'];
    const p=plan(draft({kind:'complete'}),f);expect(p.preview.canApply).toBe(false);expect(p.preview.clarifications?.join('')).toContain('前提');
    f.tasks.a.dependsOnTaskIds=[];expect(plan(draft({kind:'complete'}),f).preview.clarifications?.join('')).toContain('全員');
  });
  it('changes only the requested task for complete/cancel and leaves child state intact',()=>{
    const f=fixture();f.tasks.a.workState={status:'hold',reason:'あとで',resumeCondition:'準備後',reviewAt:null};
    const p=plan(draft({kind:'complete'}),f);
    expect(p.writes).toHaveLength(1);expect(p.writes[0].after).toMatchObject({isCompleted:true,completedAt:new Date(now),workState:null});
    expect(plan(draft({kind:'cancel'}),f).writes[0].after).toMatchObject({isAbandoned:true,isCompleted:false,workState:null});
    expect(f.tasks.b.isCompleted).toBe(false);
  });
  it.each([{descriptionMode:'silent'}, {speech:'guessed'}, {confirmationPoints:['']}, {workState:{reason:'未着',resumeCondition:'届いたら',reviewAt:'2026-02-30'}}])('rejects invalid proposal metadata %o',patch=>{
    expect(()=>validateOrganizationDraft({...draft({}),...patch})).toThrow('入力');
  });
  it('creates a task with an explicit owner only and no invented deadline',()=>{
    const p=plan(draft({kind:'create',title:'購入確認',assigneeIds:['u']}));
    expect(p.writes[0].after).toMatchObject({parentTaskId:'a',assigneeIds:['u'],dueDate:null,isCompleted:false});
  });
  it('uses the destination list default before the project default for new parentless work',()=>{
    const f=fixture();f.defaultAssigneeId='v';f.listDefaultAssigneeIds={work:'u'};
    const p=plan(draft({kind:'create',taskIds:[],targetTaskId:undefined,title:'単独の仕事',listId:'work'}),f);
    expect(p.writes[0].after).toMatchObject({listId:'work',assigneeIds:['u']});
    expect(plan(draft({kind:'create',taskIds:[],targetTaskId:undefined,title:'手動指定',listId:'work',assigneeIds:['v']}),f).writes[0].after.assigneeIds).toEqual(['v']);
  });
  it('defaults a new child to all parent assignees without changing the parent',()=>{
    const f=fixture();f.tasks.a.assigneeIds=['u','v'];const original=structuredClone(f);
    const p=plan(draft({kind:'create',title:'発送の準備'}),f);
    expect(p.writes).toHaveLength(1);expect(p.writes[0].after).toMatchObject({parentTaskId:'a',assigneeIds:['u','v']});
    expect(p.preview.changes[0].fields).toContainEqual({field:'assigneeIds',before:null,after:['u','v']});expect(f).toEqual(original);
  });
  it.each([{selected:['v']},{selected:[]}])('preserves explicitly chosen child assignees $selected instead of inheriting',({selected})=>{
    const f=fixture();f.tasks.a.assigneeIds=['u','v'];
    expect(plan(draft({kind:'create',title:'発送の準備',assigneeIds:selected}),f).writes[0].after.assigneeIds).toEqual(selected);
  });
  it('does not infer assignees for a parentless task or overwrite existing tasks when reparenting',()=>{
    const f=fixture();f.tasks.a.assigneeIds=['u','v'];f.tasks.b.assigneeIds=[];
    expect(plan(draft({kind:'create',taskIds:[],targetTaskId:undefined,title:'単独の仕事'}),f).writes[0].after.assigneeIds).toEqual([]);
    const moved=plan(draft({kind:'parent_child',taskIds:['a','b']}),f);
    expect(moved.writes.find(write=>write.path==='tasks/b')?.after.assigneeIds).toEqual([]);
    const grouped=plan(draft({kind:'new_parent',taskIds:['a','b'],title:'新しいまとまり'}),f);
    expect(grouped.writes.find(write=>write.path==='tasks/org-test-op')?.after.assigneeIds).toEqual([]);
  });
  it('uses inherited assignees in duplicate checks and rejects departed parent assignees until corrected',()=>{
    const f=fixture();f.tasks.a.assigneeIds=['u','v'];f.tasks.b={...f.tasks.b,title:'発送の準備',parentTaskId:'a',assigneeIds:['v','u']};
    expect(plan(draft({kind:'create',title:'発送の準備'}),f).preview.canApply).toBe(false);
    f.tasks.a.assigneeIds=['outside'];
    expect(()=>plan(draft({kind:'create',title:'別の仕事'}),f)).toThrow('メンバー');
    expect(plan(draft({kind:'create',title:'別の仕事',assigneeIds:['v']}),f).preview.canApply).toBe(true);
  });
  it('creates a new parent and preserves individual child owners',()=>{
    const p=plan(draft({kind:'new_parent',taskIds:['a','b'],title:'全員分の成果をそろえる'}));
    expect(p.writes.find(w=>w.path==='tasks/a')?.after).toMatchObject({parentTaskId:'org-test-op',assigneeIds:['u']});
  });
  it('rejects unknown members rather than assigning a guessed person',()=>expect(()=>plan(draft({assigneeIds:['outside']}))).toThrow('メンバー'));
  it('rejects parent cycles',()=>{const f=fixture();f.tasks.a.parentTaskId='b';expect(()=>plan(draft({kind:'parent_child',taskIds:['a','b']}),f)).toThrow('循環');});
  it('rejects dependency cycles',()=>{const f=fixture();f.tasks.b.dependsOnTaskIds=['a'];expect(()=>plan(draft({kind:'dependency',taskIds:['a','b']}),f)).toThrow('循環');});
  it('distinguishes independent related work from a blocking dependency',()=>{const p=plan(draft({kind:'related',taskIds:['a','b']}));expect(p.writes[0].after).toMatchObject({relatedTaskIds:['b'],dependsOnTaskIds:[]});});
  it('uses existing checklist shape and leaves the task incomplete',()=>{const p=plan(draft({kind:'checklist',checklist:['下書き','確認']}));expect(p.writes[0].after.items).toEqual([{id:'org-test-op-0',text:'下書き',isChecked:false,order:0},{id:'org-test-op-1',text:'確認',isChecked:false,order:1}]);});
  it('merges comments, attachments, checklist states and links without deleting originals',()=>{
    const f=fixture();f.tasks.b.assigneeIds=['v'];f.tasks.c.dependsOnTaskIds=['b'];const p=plan(draft({kind:'merge',taskIds:['a','b']}),f);
    expect(p.writes.find(w=>w.path==='tasks/a')?.after).toMatchObject({assigneeIds:['u','v'],mergedFromTaskIds:['b']});
    expect(p.writes.find(w=>w.path==='tasks/b')?.after).toMatchObject({isArchived:true,mergedIntoTaskId:'a'});
    expect(p.writes.filter(w=>w.path.startsWith('tasks/a/'))).toHaveLength(3);
    expect(p.writes.find(w=>w.path.includes('/comments/'))?.after).toMatchObject({content:'確認をお願い',organizationOrigin:{taskId:'b',documentId:'c'}});
    expect(p.writes.find(w=>w.path==='tasks/c')?.after.dependsOnTaskIds).toEqual(['a']);
    expect(f.children['tasks/b/comments/c'].content).toBe('確認をお願い');
  });
  it('does not merge a completed purchase with an incomplete purchase',()=>{const f=fixture();f.tasks.b.isCompleted=true;expect(()=>plan(draft({kind:'merge',taskIds:['a','b']}),f)).toThrow('完了状態');});
  it('requires conflicting period/parent conditions to be resolved before merge',()=>{const f=fixture();f.tasks.b.dueDate=new Date('2027-01-01');expect(()=>plan(draft({kind:'merge',taskIds:['a','b']}),f)).toThrow('差分');});
  it('preserves newly introduced shared hold/completion conditions when considering merge',()=>{
    const f=fixture();f.tasks.b.workState={status:'hold',reason:'要確認',resumeCondition:'返答後',reviewAt:null};
    expect(()=>plan(draft({kind:'merge',taskIds:['a','b']}),f)).toThrow('保留条件');
  });
  it('rejects archived targets and malformed draft fields',()=>{const f=fixture();f.tasks.a.isArchived=true;expect(()=>plan(draft({description:'追記'}),f)).toThrow('アーカイブ');expect(()=>validateOrganizationDraft({...draft({}),isCompleted:true})).toThrow('入力');});
});


it('tags only newly proposed tasks, including a new parent, while preserving child labels',()=>{
 const data=fixture();data.tasks.a.labelIds=['keep'];
 const parent=plan(draft({kind:'new_parent',title:'まとめ',taskIds:['a'],targetTaskId:undefined,aiSuggested:true}),data);
 expect(parent.writes.find(write=>write.path==='tasks/org-test-op')!.after).toMatchObject({aiSuggested:true,labelIds:['ai-moai']});
 expect(parent.writes.find(write=>write.path==='tasks/a')!.after.labelIds).toEqual(['keep']);
 const manual=plan(draft({kind:'create',taskIds:[],targetTaskId:undefined,title:'手動'}));
 expect(manual.writes[0].after.labelIds).toEqual([]);expect(manual.writes[0].after.aiSuggested).toBeUndefined();
});
