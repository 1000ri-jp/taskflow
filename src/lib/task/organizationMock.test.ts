import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { mutateOrganizationMock, organizationMockKey, readOrganizationMock, requestOrganizationMock } from './organizationMock';
import type { OrganizationReconsideration, OrganizationAnalysis, OrganizationPreview, OrganizationSource, OrganizationMultiAnalysis } from './organizationTypes';
import { MEETING_MOCK_PROJECTS, meetingMultiExampleSource, MULTI_PROGRESS_TASK_ID } from './meetingMultiExample';
const projectId='organization-test';
const source={kind:'meeting',id:'m1',title:'朝会',text:'確認して公開する',occurredAt:null};
const draft={kind:'update',taskIds:['draft'],description:'公開予定を確認',reason:'本人が指定',quote:'確認して公開する'};
beforeEach(()=>{MEETING_MOCK_PROJECTS.forEach(project=>localStorage.removeItem(organizationMockKey(project.id)));localStorage.removeItem(organizationMockKey(projectId));vi.stubGlobal('crypto',webcrypto);let queue=Promise.resolve();vi.stubGlobal('navigator',{locks:{request:(_key:string,run:()=>unknown)=>{const result=queue.then(run);queue=result.then(()=>undefined,()=>undefined);return result;}}});});
afterEach(()=>{MEETING_MOCK_PROJECTS.forEach(project=>localStorage.removeItem(organizationMockKey(project.id)));localStorage.removeItem(organizationMockKey(projectId));localStorage.removeItem('untouched-meeting-draft');vi.unstubAllGlobals();});
describe('isolated shared workbench',()=>{
 it('does not initialize storage on context reads or analysis',async()=>{
  await requestOrganizationMock({action:'context',projectId});
  await requestOrganizationMock({action:'analyze',projectId,source});
  expect(localStorage.getItem(organizationMockKey(projectId))).toBeNull();
 });
 it('does not reset other browser drafts or initialize storage on a plain read',()=>{localStorage.setItem('untouched-meeting-draft','keep');expect(readOrganizationMock(projectId).data.tasks.draft.title).toBe('案内文を仕上げる');expect(localStorage.getItem(organizationMockKey(projectId))).toBeNull();expect(localStorage.getItem('untouched-meeting-draft')).toBe('keep');});
 it('uses the same shared tasks for meeting adoption and later reads',async()=>{const p=await requestOrganizationMock({action:'preview',projectId,source,draft}) as {id:string};await requestOrganizationMock({action:'apply',projectId,id:p.id});expect(readOrganizationMock(projectId).data.tasks.draft.description).toContain('公開予定を確認');expect(readOrganizationMock(projectId).activityLogs[0]).toMatchObject({organization:{operationId:p.id},source:{kind:'meeting',occurredAt:null}});});
 it('protects a later added comment when undoing an accepted update',async()=>{const p=await requestOrganizationMock({action:'preview',projectId,source,draft}) as {id:string};await requestOrganizationMock({action:'apply',projectId,id:p.id});await mutateOrganizationMock(projectId,state=>{state.data.children['tasks/draft/comments/later']={content:'あとからの確認'};});await expect(requestOrganizationMock({action:'undo',projectId,id:p.id})).rejects.toThrow('取消');expect(readOrganizationMock(projectId).data.children['tasks/draft/comments/later'].content).toBe('あとからの確認');});
 it('stores a chosen reminder without changing work or creating a task activity log', async()=>{
  const p = await requestOrganizationMock({ action: 'preview', projectId, source, draft }) as OrganizationPreview;
  const beforeTask = structuredClone(readOrganizationMock(projectId).data.tasks.draft);
  await requestOrganizationMock({ action: 'defer', projectId, id: p.id, followUp: { kind: 'when', condition: '見積もりが届いた' } });
  expect(readOrganizationMock(projectId).entries[0].preview).toMatchObject({ status: 'held', followUp: { kind: 'when', condition: '見積もりが届いた' } });
  expect((await requestOrganizationMock({ action: 'list', projectId }) as OrganizationPreview[])[0]).toMatchObject({ status: 'held', followUp: { kind: 'when' } });
  await mutateOrganizationMock(projectId, state => {
   const entry = state.entries.find(item => item.preview.id === p.id)!;
   entry.followUp = { kind: 'at', at: '2026-09-15T10:00:00.000Z' };
   entry.preview.followUp = entry.followUp;
  });
  const reappeared = (await requestOrganizationMock({ action: 'list', projectId }) as OrganizationPreview[])[0];
  expect(reappeared).toMatchObject({ status: 'pending', reappearedReason: '指定した日時になりました', followUp: { kind: 'at' } });
  expect(readOrganizationMock(projectId).data.tasks.draft).toEqual(beforeTask);
  expect(readOrganizationMock(projectId).activityLogs).toHaveLength(0);
 });
 it('prevents a stale preview from overwriting an external work update',async()=>{const p=await requestOrganizationMock({action:'preview',projectId,source,draft}) as {id:string};await mutateOrganizationMock(projectId,state=>{state.data.tasks.draft.description='本人の新しい編集';});await expect(requestOrganizationMock({action:'apply',projectId,id:p.id})).rejects.toThrow('情報が変わりました');expect(readOrganizationMock(projectId).data.tasks.draft.description).toBe('本人の新しい編集');});
 it('uses a list default for Moai-created work and rejects a preview after that default changes',async()=>{
  await mutateOrganizationMock(projectId,state=>{
   state.data.defaultAssigneeId='demo-colleague';
   state.lists=[{id:'doing',projectId,name:'進行中',color:'#64748b',order:0,autoCompleteOnEnter:false,autoUncompleteOnExit:false,autoSetStartDateOnEnter:false,defaultAssigneeId:'e2e-mock-user',createdAt:new Date(),updatedAt:new Date()}];
  });
  const createSource={...source,text:'新しい作業をする'};
  const createDraft={kind:'create' as const,taskIds:[],title:'新しい作業',listId:'doing',reason:'朝会で決定',quote:'新しい作業をする'};
  const preview=await requestOrganizationMock({action:'preview',projectId,source:createSource,draft:createDraft}) as OrganizationPreview;
  expect(readOrganizationMock(projectId).entries[0].writes[0].after.assigneeIds).toEqual(['e2e-mock-user']);
  await mutateOrganizationMock(projectId,state=>{state.lists![0].defaultAssigneeId='demo-colleague';});
  await expect(requestOrganizationMock({action:'apply',projectId,id:preview.id})).rejects.toThrow('情報が変わりました');
  expect(readOrganizationMock(projectId).data.tasks[preview.changes[0].taskId]).toBeUndefined();
 });
});

describe('meeting changes through the isolated workflow',()=>{
 const prepare=async()=>{
  const source=await requestOrganizationMock({action:'example',projectId}) as OrganizationSource;
  const before=localStorage.getItem(organizationMockKey(projectId));
  const analysis=await requestOrganizationMock({action:'analyze',projectId,source}) as OrganizationAnalysis;
  expect(localStorage.getItem(organizationMockKey(projectId))).toBe(before);
  return {source,analysis};
 };
 it('compares, edits, applies independent changes and suppresses reprocessed work',async()=>{
  const {source,analysis}=await prepare();
  expect(analysis.drafts).toHaveLength(8);
  expect(analysis.drafts.some(d=>d.taskIds.includes('meeting-post'))).toBe(false);
  expect(analysis.issues.join(' ')).toContain('決済完了が未確認');
  for(const draft of analysis.drafts){
   const edited=draft.kind==='create'?{...draft,title:'確認済みの展示会ポスター'}:draft;
   const preview=await requestOrganizationMock({action:'preview',projectId,source,draft:edited,basis:analysis.basis,confirmed:true}) as OrganizationPreview;
   expect(preview.canApply).toBe(true);
   const result=await requestOrganizationMock({action:'apply',projectId,id:preview.id}) as OrganizationPreview;
   expect(result.status).toBe('applied');
  }
  const state=readOrganizationMock(projectId);
  expect(Object.values(state.data.tasks).filter(t=>t.title==='確認済みの展示会ポスター')).toHaveLength(1);
  expect(state.data.tasks['meeting-copy']).toMatchObject({title:'9月の公開案内文',assigneeIds:['demo-colleague']});
  expect(state.data.tasks['meeting-map'].isCompleted).toBe(true);
  expect(state.data.tasks['meeting-venue'].isAbandoned).toBe(true);
  expect(state.data.tasks['meeting-gift'].workState).toMatchObject({status:'hold',resumeCondition:'予算が承認されたら再開を確認する'});
  expect(state.data.tasks['meeting-material'].workState).toMatchObject({status:'wait'});
  expect(state.data.tasks['meeting-flyer-duplicate'].isArchived).toBe(true);
  expect(state.data.children['tasks/meeting-flyer-duplicate/comments/note']).toBeDefined();
  const rerun=await requestOrganizationMock({action:'analyze',projectId,source:{...source,id:'other-file.txt',title:'名前を変えた同じ会議'}}) as OrganizationAnalysis;
  expect(rerun.drafts).toHaveLength(0);
 });
 it('requires completion confirmation and preserves review holds/skips on rerun',async()=>{
  const {source,analysis}=await prepare();
  const complete=analysis.drafts.find(d=>d.kind==='complete')!;
  const p=await requestOrganizationMock({action:'preview',projectId,source,draft:complete,basis:analysis.basis}) as OrganizationPreview;
  expect(p.canApply).toBe(false);
  await expect(requestOrganizationMock({action:'apply',projectId,id:p.id})).rejects.toThrow('確認事項');
  for(const [index,action] of [[0,'hold'],[1,'skip']] as const){
   const preview=await requestOrganizationMock({action:'preview',projectId,source,draft:analysis.drafts[index],basis:analysis.basis}) as OrganizationPreview;
   await requestOrganizationMock({action,projectId,id:preview.id});
  }
  const again=await requestOrganizationMock({action:'analyze',projectId,source}) as OrganizationAnalysis;
  expect(again.drafts).toHaveLength(6);
  expect(readOrganizationMock(projectId).data.tasks['meeting-map'].isCompleted).toBe(false);
 });
 it('detects changes since analysis and still allows another independent proposal',async()=>{
  const {source,analysis}=await prepare();
  await mutateOrganizationMock(projectId,state=>{state.data.children['tasks/meeting-copy/comments/later']={content:'期限を9月25日で再調整',createdAt:new Date()};});
  await expect(requestOrganizationMock({action:'preview',projectId,source,draft:analysis.drafts[1],basis:analysis.basis})).rejects.toThrow('分析後');
  const p=await requestOrganizationMock({action:'preview',projectId,source,draft:analysis.drafts[0],basis:analysis.basis}) as OrganizationPreview;
  await requestOrganizationMock({action:'apply',projectId,id:p.id});
  expect(readOrganizationMock(projectId).data.tasks['meeting-copy'].title).toBe('公開用の案内文');
  expect(readOrganizationMock(projectId).entries.filter(e=>e.preview.status==='applied')).toHaveLength(1);
 });
 it('serializes a repeated apply and creates only one task and one history item',async()=>{
  const {source,analysis}=await prepare();
  const p=await requestOrganizationMock({action:'preview',projectId,source,draft:analysis.drafts[0],basis:analysis.basis}) as OrganizationPreview;
  await Promise.all([requestOrganizationMock({action:'apply',projectId,id:p.id}),requestOrganizationMock({action:'apply',projectId,id:p.id})]);
  expect(Object.values(readOrganizationMock(projectId).data.tasks).filter(t=>t.title==='展示会ポスターを作成')).toHaveLength(1);
  expect(readOrganizationMock(projectId).activityLogs.filter(l=>(l.organization as {operationId:string}).operationId===p.id)).toHaveLength(1);
 });
 it('blocks an older pending create after its edited version is accepted',async()=>{
  const {source,analysis}=await prepare();
  const draft=analysis.drafts[0];
  const old=await requestOrganizationMock({action:'preview',projectId,source,draft,basis:analysis.basis}) as OrganizationPreview;
  const edited=await requestOrganizationMock({action:'preview',projectId,source,draft:{...draft,title:'会議で確認したポスター'},basis:analysis.basis}) as OrganizationPreview;
  await requestOrganizationMock({action:'apply',projectId,id:edited.id});
  await expect(requestOrganizationMock({action:'apply',projectId,id:old.id})).rejects.toThrow('既に採用');
  await expect(requestOrganizationMock({action:'preview',projectId,source,draft})).rejects.toThrow('同じ発言');
  expect(readOrganizationMock(projectId).activityLogs).toHaveLength(1);
 });
 it('applies two independent new tasks previewed before either was created',async()=>{
  const source={kind:'meeting' as const,id:'two-new',title:'朝会',occurredAt:null,text:'ポスターを作る。チケットを購入する。'};
  const previews:OrganizationPreview[]=[];
  for(const [title,quote] of [['ポスター','ポスターを作る。'],['チケット','チケットを購入する。']]){
   previews.push(await requestOrganizationMock({action:'preview',projectId,source,draft:{kind:'create',taskIds:[],title,listId:'doing',reason:'会議で決定',quote}}) as OrganizationPreview);
  }
  for(const p of previews)await requestOrganizationMock({action:'apply',projectId,id:p.id});
  expect(readOrganizationMock(projectId).activityLogs).toHaveLength(2);
  await mutateOrganizationMock(projectId,state=>{state.data.tasks.draft.dependsOnTaskIds=[previews[0].changes[0].taskId];});
  await expect(requestOrganizationMock({action:'undo',projectId,id:previews[0].id})).rejects.toThrow('取消');
 });
});


describe('mixed-project meeting examples', () => {
 const projectIds = MEETING_MOCK_PROJECTS.map(project => project.id);
 const creative = projectIds[0], office = projectIds[1];
 const prepareMany = async () => {
  const source = await requestOrganizationMock({ action: 'example_many', projectIds }) as OrganizationSource;
  const before = projectIds.map(id => localStorage.getItem(organizationMockKey(id)));
  const analysis = await requestOrganizationMock({ action: 'analyze_many', projectIds, source }) as OrganizationMultiAnalysis;
  expect(projectIds.map(id => localStorage.getItem(organizationMockKey(id)))).toEqual(before);
  return { source, analysis };
 };
 it('never seeds on analysis and refuses unknown free input or projects without writing', async () => {
  const result = await requestOrganizationMock({ action: 'analyze_many', projectIds, source: meetingMultiExampleSource() }) as OrganizationMultiAnalysis;
  expect(result.proposals).toEqual([]); expect(result.issues.join(' ')).toContain('会議の例を入れる');
  expect(projectIds.every(id => localStorage.getItem(organizationMockKey(id)) === null)).toBe(true);
  const free = await requestOrganizationMock({ action: 'analyze_many', projectIds, source }) as OrganizationMultiAnalysis;
  expect(free.proposals).toEqual([]); expect(free.issues.join(' ')).toContain('自動追記していません');
  await expect(requestOrganizationMock({ action: 'example_many', projectIds: ['actual-project'] })).rejects.toThrow('架空プロジェクト');
  expect(localStorage.getItem(organizationMockKey('actual-project'))).toBeNull();
 });
 it('seeds missing sample tasks only and preserves existing work and other browser drafts', async () => {
  await mutateOrganizationMock(creative, state => { state.data.tasks.draft.description = '前からの入力'; });
  localStorage.setItem('untouched-meeting-draft', 'keep');
  await prepareMany();
  expect(readOrganizationMock(creative).data.tasks.draft.description).toBe('前からの入力');
  expect(Object.keys(readOrganizationMock(office).data.tasks)).toEqual([MULTI_PROGRESS_TASK_ID]);
  await mutateOrganizationMock(office, state => { state.data.tasks[MULTI_PROGRESS_TASK_ID].description = '本人が編集した内容'; });
  await requestOrganizationMock({ action: 'example_many', projectIds });
  expect(readOrganizationMock(office).data.tasks[MULTI_PROGRESS_TASK_ID].description).toBe('本人が編集した内容');
  expect(localStorage.getItem('untouched-meeting-draft')).toBe('keep');
 });
 it('keeps same task ids separate, applies an edited new task, and deduplicates a repeated transcript', async () => {
  const { source, analysis } = await prepareMany();
  expect(analysis.proposals).toHaveLength(3);
  expect(analysis.issues.join(' ')).toContain('対象プロジェクト・担当・期限が未確定');
  const previews: OrganizationPreview[] = [];
  for (const proposal of analysis.proposals) {
   const draft = proposal.draft.kind === 'create' ? { ...proposal.draft, title: '確認済みの持ちもの一覧' } : proposal.draft;
   const preview = await requestOrganizationMock({ action: 'preview', projectId: proposal.projectId, source, draft, basis: analysis.bases[proposal.projectId] }) as OrganizationPreview;
   expect(preview.canApply).toBe(true); previews.push(preview);
  }
  const updates = previews.filter(preview => preview.kind === 'update');
  expect(updates.map(preview => preview.changes[0].taskId)).toEqual([MULTI_PROGRESS_TASK_ID, MULTI_PROGRESS_TASK_ID]);
  expect(new Set(updates.map(preview => preview.id)).size).toBe(2);
  for (const preview of previews) await requestOrganizationMock({ action: 'apply', projectId: preview.projectId, id: preview.id });
  expect(readOrganizationMock(creative).data.tasks[MULTI_PROGRESS_TASK_ID].description).toContain('申込先URL');
  expect(readOrganizationMock(creative).data.tasks[MULTI_PROGRESS_TASK_ID].description).not.toContain('見積書はそろった');
  expect(readOrganizationMock(office).data.tasks[MULTI_PROGRESS_TASK_ID].description).toContain('見積書はそろった');
  expect(Object.values(readOrganizationMock(creative).data.tasks).filter(task => task.title === '確認済みの持ちもの一覧')).toHaveLength(1);
  expect(readOrganizationMock(office).activityLogs).toHaveLength(1);
  const rerun = await requestOrganizationMock({ action: 'analyze_many', projectIds, source: { ...source, id: 'renamed.txt', title: '同じ朝会' } }) as OrganizationMultiAnalysis;
  expect(rerun.proposals).toEqual([]);
 });
 it('keeps one project available when the other cannot be read and never rewrites damaged state', async () => {
  const { source } = await prepareMany();
  localStorage.setItem(organizationMockKey(office), 'damaged-data');
  const before = localStorage.getItem(organizationMockKey(creative));
  const analysis = await requestOrganizationMock({ action: 'analyze_many', projectIds, source }) as OrganizationMultiAnalysis;
  expect(analysis.proposals).toHaveLength(2); expect(analysis.proposals.every(item => item.projectId === creative)).toBe(true);
  expect(analysis.issues.join(' ')).toContain('架空の総務プロジェクトを確認できません');
  expect(analysis.bases[office]).toBeUndefined();
  expect(localStorage.getItem(organizationMockKey(office))).toBe('damaged-data');
  expect(localStorage.getItem(organizationMockKey(creative))).toBe(before);
 });
 it('rejects a changed target but permits another project and unselected proposals stay unapplied', async () => {
  const { source, analysis } = await prepareMany();
  const proposals = analysis.proposals.filter(item => item.draft.kind === 'update');
  const previews = await Promise.all(proposals.map(item => requestOrganizationMock({ action: 'preview', projectId: item.projectId, source, draft: item.draft, basis: analysis.bases[item.projectId] }) as Promise<OrganizationPreview>));
  await mutateOrganizationMock(office, state => { state.data.tasks[MULTI_PROGRESS_TASK_ID].description = '他の編集を保持'; });
  const results = await Promise.allSettled(previews.map(preview => requestOrganizationMock({ action: 'apply', projectId: preview.projectId, id: preview.id })));
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(readOrganizationMock(office).data.tasks[MULTI_PROGRESS_TASK_ID].description).toBe('他の編集を保持');
  expect(readOrganizationMock(creative).data.tasks[MULTI_PROGRESS_TASK_ID].description).toContain('申込先URL');
  expect(Object.values(readOrganizationMock(creative).data.tasks).some(task => task.title === '展示会の持ちもの一覧')).toBe(false);
  await expect(requestOrganizationMock({ action: 'preview', projectId: office, source, draft: proposals[1].draft, basis: analysis.bases[creative] })).rejects.toThrow();
  const scoped = await requestOrganizationMock({ action: 'analyze_many', projectIds: [creative], source }) as OrganizationMultiAnalysis;
  expect(scoped.proposals.every(item => item.projectId === creative)).toBe(true);
  expect(scoped.issues.join(' ')).toContain('対象に選ばれていない');
 });
});


it('reconsiders a held saved intent using current mock work without changing any tasks',async()=>{
 const p=await requestOrganizationMock({action:'preview',projectId,source,draft}) as OrganizationPreview;
 await requestOrganizationMock({action:'hold',projectId,id:p.id});
 await mutateOrganizationMock(projectId,state=>{state.data.tasks.draft.description='最新の内容';});
 const before=readOrganizationMock(projectId);
 const result=await requestOrganizationMock({action:'reconsider',projectId,id:p.id}) as OrganizationReconsideration;
 expect(result).toMatchObject({source,draft,preview:{id:p.id,status:'pending'}});
 expect(result.preview.changes[0].before).toContain('最新の内容');
 expect(readOrganizationMock(projectId).data).toEqual(before.data);
 expect(readOrganizationMock(projectId).activityLogs).toEqual(before.activityLogs);
 expect(readOrganizationMock(projectId).entries).toHaveLength(1);
 await requestOrganizationMock({action:'apply',projectId,id:p.id});
 await expect(requestOrganizationMock({action:'reconsider',projectId,id:p.id})).rejects.toMatchObject({status:409});
});
