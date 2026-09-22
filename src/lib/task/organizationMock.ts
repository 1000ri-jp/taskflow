'use client';
import { repeatMockTask } from './recurrenceClient';
import type { Task } from '@/types';
import { OrganizationError, assertOrganizationGraphSafe, planOrganization, type OrganizationData, type OrganizationPlan } from './organizationEngine';
import type { OrganizationAnalysis, OrganizationDraft, OrganizationFollowUp, OrganizationSource, OrganizationMultiAnalysis } from './organizationTypes';
import { assertOrganizationBasis, createOrganizationBasis, organizationChangeContent, organizationComparableWrites, organizationFingerprint, organizationScope, organizationSourceFingerprint } from './organizationIdentity';
import { addMeetingExampleData, meetingExampleAnalysis, meetingExampleSource } from './meetingExample';
import { addMeetingMultiExampleData, MEETING_MOCK_PROJECTS, MEETING_MULTI_UNCERTAINTY, meetingMultiExampleProposals, meetingMultiExampleSource, MULTI_PROGRESS_TASK_ID } from './meetingMultiExample';
import type { ListReference } from '@/types';
export const ORGANIZATION_MOCK_PROJECT='secretary-demo';
export const organizationMockKey=(projectId:string)=>`taskflow-organization-lab-v1:${projectId}`;
export const STRICT_DEADLINE_MOCK_TASK_ID = 'payment-transfer-strict';
export const REFERENCE_INFO_MOCK_TASK_ID = 'reference-info-task';
export interface OrganizationMock { referenceComments?: Record<string, import('@/types').ReferenceComment[]>; lists?: import('@/types').List[]; notificationReads?: string[]; data:OrganizationData; entries:(OrganizationPlan & {mockBefore?:string;mockAfter?:string;followUp?:OrganizationFollowUp})[]; activityLogs:Record<string,unknown>[]; milestones?: import('@/types').Milestone[]; automationStates?: Record<string, import('./automationTypes').AutomationState>; automationEvidence?: Record<string, import('./automationTypes').TaskEvidence[]> }

export function addStrictDeadlineExampleData(data: OrganizationData) {
  if (data.tasks[STRICT_DEADLINE_MOCK_TASK_ID]) return;
  const now = new Date('2026-09-21T00:00:00+09:00');
  const listId = data.listIds[0] || 'doing';
  const base = { projectId: 'secretary-demo', listId, description: '', order: Object.keys(data.tasks).length + 1, assigneeIds: ['e2e-mock-user'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: 'high' as const, startDate: now, dueDate: new Date('2026-09-24T08:00:00+09:00'), durationDays: null, isDueDateFixed: true, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now };
  data.tasks['payment-transfer'] = { ...base, title: '支払振込設定', description: '期限厳守の確認用の架空タスクです。', dueDate: null, priority: null, startDate: null };
  data.tasks[STRICT_DEADLINE_MOCK_TASK_ID] = { ...base, parentTaskId: 'payment-transfer', title: '精算手続きの確認（架空）', description: '期限厳守の表示確認用データです。指定した日時を自動で延長しません。', deadlinePolicy: 'strict' };
}

export function addListReferenceExampleData(data: OrganizationData) {
  const listId = data.listIds[0] || 'doing';
  const now = new Date('2026-09-21T00:00:00+09:00');
  data.references ??= {};
  const examples: ListReference[] = [
    { id: 'reference-venue-map', projectId: 'secretary-demo', listId, title: '展示位置・会場マップ', body: '展示位置を確認するための架空情報です。', comment: '搬入前に最新の位置を確認します。', links: [{ id: 'reference-venue-map-link', label: '展示位置マップ', url: 'https://www.genai-expo.com/vol6/map?booth=C-1%2FC-2' }], attachments: [], order: 1, createdBy: 'e2e-mock-user', createdAt: now, updatedBy: 'e2e-mock-user', updatedAt: now, isArchived: false },
  ];
  for (const reference of examples) data.references[reference.id] ??= reference;
  if (!data.tasks[REFERENCE_INFO_MOCK_TASK_ID]) data.tasks[REFERENCE_INFO_MOCK_TASK_ID] = { projectId: 'secretary-demo', listId, title: '情報', description: '展示位置：https://www.genai-expo.com/vol6/map?booth=C-1%2FC-2\n出展ガイド：https://www.genai-expo.com/vol6/guide', order: Object.keys(data.tasks).length + 1, assigneeIds: ['e2e-mock-user'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now };
}

export function addReferenceDemoData(data: OrganizationData) {
  addListReferenceExampleData(data);
  addStrictDeadlineExampleData(data);
}
const revive=(key:string,value:unknown)=>typeof value==='string' && /^(createdAt|updatedAt|completedAt|achievedAt|archivedAt|dueDate|startDate|uploadedAt)$/.test(key) && /^\d{4}-\d\d-\d\dT/.test(value) ? new Date(value) : value;
export function readOrganizationMock(projectId=ORGANIZATION_MOCK_PROJECT):OrganizationMock {
  const saved=localStorage.getItem(organizationMockKey(projectId)); if(saved) {
    const state=JSON.parse(saved,revive) as OrganizationMock;
    const listDefaults={...(state.data.listDefaultAssigneeIds??{})};
    for(const list of state.lists??[]) if(list.defaultAssigneeId!==undefined) listDefaults[list.id]=list.defaultAssigneeId??null;
    state.data.listDefaultAssigneeIds=listDefaults;
    return state;
  }
  if (projectId === 'secretary-demo-office') return { data: { tasks: {}, children: {}, listIds: ['doing'], memberIds: ['e2e-mock-user', 'demo-colleague'] }, entries: [], activityLogs: [] };
  const now=new Date('2026-09-13T00:00:00.000Z'); const base={projectId,listId:'doing',description:'',order:1,assigneeIds:['e2e-mock-user'],labelIds:[],tagIds:[],dependsOnTaskIds:[],priority:null,startDate:null,dueDate:null,durationDays:null,isDueDateFixed:false,isCompleted:false,completedAt:null,isAbandoned:false,isArchived:false,archivedAt:null,archivedBy:null,createdBy:'e2e-mock-user',createdAt:now,updatedAt:now};
  return {data:{tasks:{
    draft:{...base,title:'案内文を仕上げる',description:'2026年9月の公開用案内文。完了条件：内容と申込先を確認して公開できる。'},
    'purchase-parent':{...base,title:'2026年秋の展示会チケットを全員分そろえる',description:'2026年秋の展示会。完了条件：必要な全員（本人・同僚）がそれぞれ購入と支払を完了している。'},
    'purchase-self':{...base,title:'本人の2026年秋の展示会チケット購入',parentTaskId:'purchase-parent',description:'対象：本人。2026年秋の展示会チケット。完了条件：本人分の購入と支払完了。'},
    'purchase-peer':{...base,title:'同僚の2026年秋の展示会チケット購入',parentTaskId:'purchase-parent',assigneeIds:['demo-colleague'],description:'対象：同僚。2026年秋の展示会チケット。完了条件：同僚分の購入と支払完了。'},
  },children:{},listIds:['doing'],memberIds:['e2e-mock-user','demo-colleague']},entries:[],activityLogs:[]};
}
export function writeOrganizationMock(projectId:string,state:OrganizationMock) {
  localStorage.setItem(organizationMockKey(projectId),JSON.stringify(state));
  window.dispatchEvent(new Event('taskflow-work-updated'));
}
export async function mutateOrganizationMock<T>(projectId:string,change:(state:OrganizationMock)=>T|Promise<T>):Promise<T> {
  if(!navigator.locks) throw new Error('このブラウザは隔離データの排他保存に対応していません。');
  return navigator.locks.request(organizationMockKey(projectId),async()=>{const state=readOrganizationMock(projectId);const result=await change(state);writeOrganizationMock(projectId,state);return result;});
}
function canonicalMock(value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonicalMock);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonicalMock(v)]));
  return value;
}
const mockSignature=(data:OrganizationData,ids?:string[])=>JSON.stringify(canonicalMock(ids?{tasks:Object.fromEntries(ids.map(id=>[id,data.tasks[id]??null])),children:Object.fromEntries(Object.entries(data.children).filter(([path])=>ids.includes(path.split('/')[1])))}:data));
const scopedSignature = (data: OrganizationData, ids: string[]) => organizationFingerprint(organizationScope(data, ids));
async function knownEntry(state: OrganizationMock, source: OrganizationSource, draft: OrganizationDraft) {
  const sourceKey = await organizationSourceFingerprint(source);
  const changeKey = await organizationFingerprint(organizationChangeContent(draft));
  for (const entry of state.entries) {
    if (!['held', 'applied', 'skipped'].includes(entry.preview.status) || await organizationSourceFingerprint(entry.source) !== sourceKey) continue;
    if (await organizationFingerprint(organizationChangeContent(entry.draft)) === changeKey
      || ['create','new_parent'].includes(draft.kind) && draft.kind === entry.draft.kind && !!draft.quote.trim() && draft.quote.trim() === entry.draft.quote.trim()) return entry;
  }
}
async function analyzeMock(state: OrganizationMock, projectId: string, source: OrganizationSource): Promise<OrganizationAnalysis> {
  const example = source.text.replace(/\r\n?/g, '\n').trim() === meetingExampleSource().text;
  if (example && !state.data.tasks['meeting-copy']) throw new OrganizationError('「会議の例を入れる」から架空のタスクを準備してください。');
  const first = Object.keys(state.data.tasks).find(id => !state.data.tasks[id].isArchived)!;
  const result: OrganizationAnalysis = example ? meetingExampleAnalysis(state.data.listIds[0]) : {
    drafts: [{ kind: 'update', taskIds: [first], targetTaskId: first, description: source.text, reason: '隔離環境の固定提案：入力メモを既存の案内文へ追記します。', quote: source.text.slice(0, 1500) }],
    issues: [],
  };
  const drafts: OrganizationDraft[] = [];
  for (const draft of result.drafts) {
    if (await knownEntry(state, source, draft)) continue;
    const plan = planOrganization(state.data, projectId, 'e2e-mock-user', 'analysis-example', source, draft, new Date().toISOString());
    if (plan.preview.changes.length) drafts.push(draft);
  }
  return { drafts: drafts.map(draft => ({ ...draft, aiSuggested: true })), issues: ['架空データの分析例です。実AIの照合ではありません。', ...result.issues], basis: await createOrganizationBasis(projectId, source, state.data) };
}
function multiMockProjectIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MEETING_MOCK_PROJECTS.length || new Set(raw).size !== raw.length
    || raw.some(id => !MEETING_MOCK_PROJECTS.some(project => project.id === id))) throw new OrganizationError('対象の架空プロジェクトを選択してください。');
  return raw as string[];
}
async function analyzeManyMock(projectIds: string[], source: OrganizationSource): Promise<OrganizationMultiAnalysis> {
  const result: OrganizationMultiAnalysis = { proposals: [], bases: {}, issues: ['架空データの固定分析例です。実AIの照合ではありません。'] };
  if (source?.kind !== 'meeting' || typeof source.text !== 'string' || source.text.replace(/\r\n?/g, '\n').trim() !== meetingMultiExampleSource().text) {
    result.issues.push('この確認環境では「会議の例を入れる」の混在メモだけを照合できます。自由入力を仕事へ自動追記していません。');
    return result;
  }
  result.issues.push(MEETING_MULTI_UNCERTAINTY);
  const selected = new Set(projectIds);
  for (const project of MEETING_MOCK_PROJECTS) {
    if (!selected.has(project.id)) { result.issues.push(`${project.name}は対象に選ばれていないため、変更案を作成していません。`); continue; }
    try {
      if (!localStorage.getItem(organizationMockKey(project.id))) throw new Error('「会議の例を入れる」から架空の仕事を準備してください。');
      const state = readOrganizationMock(project.id);
      if (!state.data.memberIds.includes('e2e-mock-user') || !state.data.tasks[MULTI_PROGRESS_TASK_ID]) throw new Error('対象の架空の仕事を確認できません。');
      const candidates = meetingMultiExampleProposals({ [project.id]: state.data.listIds[0] }).filter(proposal => proposal.projectId === project.id);
      const proposals: OrganizationMultiAnalysis['proposals'] = [];
      const issues: string[] = [];
      for (const proposal of candidates) {
        const previous = await knownEntry(state, source, proposal.draft);
        if (previous) { issues.push(`${project.name}：この資料の変更は既に反映・見送り・保留されています。`); continue; }
        const plan = planOrganization(state.data, project.id, 'e2e-mock-user', 'analysis-example', source, proposal.draft, new Date().toISOString());
        if (plan.preview.changes.length) proposals.push(proposal);
        else issues.push(`${project.name}：既存の内容に反映済みのため変更案から除外しました。`);
      }
      const basis = await createOrganizationBasis(project.id, source, state.data);
      result.proposals.push(...proposals.map(proposal => ({...proposal,draft:{...proposal.draft,aiSuggested:true}}))); result.bases[project.id] = basis; result.issues.push(...issues);
    } catch (error) { result.issues.push(`${project.name}を確認できませんでした。${error instanceof Error ? error.message : '保存した架空データを確認してください。'}`); }
  }
  result.issues = [...new Set(result.issues)];
  return result;
}
export async function requestOrganizationMock(input:Record<string,unknown>) {
  if (input.action === 'analyze_many' || input.action === 'example_many') {
    const projectIds = multiMockProjectIds(input.projectIds);
    if (input.action === 'analyze_many') return analyzeManyMock(projectIds, input.source as OrganizationSource);
    for (const id of projectIds) await mutateOrganizationMock(id, state => { addMeetingMultiExampleData(state.data, id); });
    return meetingMultiExampleSource();
  }
  const projectId=String(input.projectId);
  // Reading and analysis do not initialize or change even the isolated shared workbench.
  if (['context', 'list', 'source', 'analyze'].includes(String(input.action))) {
    const state = readOrganizationMock(projectId);
    if(input.action==='context') return {defaultAssigneeId:state.data.defaultAssigneeId ?? null,members:state.data.memberIds.map(id=>({id,displayName:id==='e2e-mock-user'?'本人':id==='demo-colleague'?'同僚':id})),lists:state.data.listIds.map(id=>({id,name:'進行中'}))};
    if(input.action==='list') {
      let changed = false;
      for (const entry of state.entries) {
        const followUp = entry.followUp ?? entry.preview.followUp;
        const due = entry.preview.status === 'held' && followUp?.kind === 'at' && !followUp.triggeredAt && Date.parse(followUp.at) <= Date.now();
        if (due) {
          const triggered = { ...followUp, triggeredAt: new Date().toISOString() } satisfies OrganizationFollowUp;
          entry.followUp = triggered;
          entry.preview.followUp = triggered;
          entry.preview.status = 'pending';
          entry.preview.reappearedReason = '指定した日時になりました';
          changed = true;
        }
      }
      if (changed) localStorage.setItem(organizationMockKey(projectId), JSON.stringify(state));
      return state.entries.map(e => ({...e.preview,aiSuggested:e.draft.aiSuggested === true,...(e.draft.kind === 'checklist' ? {checklist:e.draft.checklist ?? []} : {})}));
    }
    if(input.action==='analyze') return analyzeMock(state, projectId, input.source as OrganizationSource);
    const entry=state.entries.find(e=>e.preview.id===input.id);if(!entry)throw new OrganizationError('整理案が見つかりません。');
    return entry.source;
  }
  return mutateOrganizationMock(projectId,async state=>{
    if(input.action==='example') { addMeetingExampleData(state.data, projectId); return meetingExampleSource(); }
    if(input.action==='preview') {
      const source=input.source as OrganizationSource;const draft=input.draft as OrganizationDraft;
      const same=await knownEntry(state,source,draft);
      if(same) {
        if(await organizationFingerprint(organizationChangeContent(same.draft))!==await organizationFingerprint(organizationChangeContent(draft)))throw new OrganizationError('同じ発言から新しい仕事が既に提案・反映されています。既存の仕事への変更か確認してください。',409);
        return same.preview;
      }
      const id=(await organizationFingerprint({projectId,source:await organizationSourceFingerprint(source),change:organizationChangeContent(draft)})).slice(0,24);
      if (draft.quote && !source.text.includes(draft.quote) && !draft.taskIds.some(taskId => `${state.data.tasks[taskId]?.title ?? ''}\n${state.data.tasks[taskId]?.description ?? ''}`.includes(draft.quote))) throw new OrganizationError('提案の引用が元の資料にありません。');
      const entry=planOrganization(state.data,projectId,'e2e-mock-user',id,source,draft,new Date().toISOString(),{confirmed:input.confirmed===true});
      await assertOrganizationBasis(projectId, source, state.data, draft, input.basis);
      const stored = {...entry,mockBefore:await scopedSignature(state.data,entry.affectedTaskIds)};
      state.entries=state.entries.filter(e=>e.preview.id!==id);state.entries.push(stored);return stored.preview;
    }
    const entry=state.entries.find(e=>e.preview.id===input.id);if(!entry)throw new OrganizationError('整理案が見つかりません。');
    if(input.action==='reconsider') {
      if(entry.preview.status==='applied') throw new OrganizationError('この案は反映済みです。現在の仕事を確認してください。',409);
      const plan=planOrganization(state.data,projectId,'e2e-mock-user',entry.preview.id,entry.source,entry.draft,new Date().toISOString(),{confirmed:false});
      const stored={...plan,mockBefore:await scopedSignature(state.data,plan.affectedTaskIds)};
      state.entries=state.entries.map(item=>item.preview.id===entry.preview.id?stored:item);
      return {source:entry.source,draft:entry.draft,preview:plan.preview};
    }
    if(input.action==='defer') {
      const followUp = input.followUp as OrganizationFollowUp;
      if (!followUp || !['at', 'when'].includes(followUp.kind) || followUp.kind === 'at' && (!followUp.at || Date.parse(followUp.at) <= Date.now()) || followUp.kind === 'when' && !followUp.condition?.trim()) throw new OrganizationError('再表示の日時または条件を確認してください。');
      if(entry.preview.status==='applied')throw new OrganizationError('反映済みです。取り消す場合は「反映を戻す」を使ってください。',409);
      entry.followUp = followUp; entry.preview.followUp = followUp; delete entry.preview.reappearedReason; entry.preview.status = 'held';
      return entry.preview;
    } else if(input.action==='hold'||input.action==='skip'||input.action==='reopen') {
      if(entry.preview.status==='applied')throw new OrganizationError('反映済みです。取り消す場合は「反映を戻す」を使ってください。',409);
      delete entry.followUp; delete entry.preview.followUp; delete entry.preview.reappearedReason;
      entry.preview.status=input.action==='hold'?'held':input.action==='skip'?'skipped':'pending';return entry.preview;
    }
    if(input.action==='apply') {
      if(entry.preview.status==='applied')return entry.preview;
      if(entry.preview.status!=='pending'||entry.preview.canApply===false)throw new OrganizationError('確認事項・変更内容を確認してから反映してください。');
      const existingDecision=await knownEntry({...state,entries:state.entries.filter(other=>other.preview.id!==entry.preview.id)},entry.source,entry.draft);
      if(existingDecision)throw new OrganizationError('同じ会議の変更は既に採用・見送り・保留されています。最新の記録を確認してください。',409);
      // Legacy records use the old whole-project signature; keep its stricter protection.
      const before = entry.mockBefore?.length===64 ? await scopedSignature(state.data,entry.affectedTaskIds) : mockSignature(state.data);
      if(entry.mockBefore && entry.mockBefore!==before || entry.writes.some(w=>JSON.stringify(w.before)!==JSON.stringify(w.path.split('/').length===2 ? state.data.tasks[w.path.split('/')[1]] ?? null : state.data.children[w.path] ?? null)))throw new OrganizationError('確認後に情報が変わりました。変更を確認し直してください。');
      const current=planOrganization(state.data,projectId,'e2e-mock-user',entry.preview.id,entry.source,entry.draft,entry.preview.createdAt,{confirmed:entry.confirmed});
      if(!current.preview.canApply)throw new OrganizationError(current.preview.clarifications?.join(' ')||'反映する変更がありません。',409);
      if(await organizationFingerprint(organizationComparableWrites(current.writes))!==await organizationFingerprint(organizationComparableWrites(entry.writes)))throw new OrganizationError('関連する仕事の変更により反映範囲が変わりました。確認し直してください。',409);
      const appliedAt=new Date();
      entry.writes=current.writes.map(write=>write.path.split('/').length===2?{...write,after:{...write.after,updatedAt:appliedAt,...(entry.draft.kind==='complete'&&write.after.isCompleted&&!write.before?.isCompleted?{completedAt:appliedAt}:{}),...(!write.before?{createdAt:appliedAt}:{})}}:write);
      const afterTasks = {...state.data.tasks};
      for(const w of entry.writes)if(w.path.split('/').length===2)afterTasks[w.path.split('/')[1]]=w.after;
      assertOrganizationGraphSafe(afterTasks);
      for(const w of entry.writes) if(w.path.split('/').length===2 && w.after.isCompleted && w.before) repeatMockTask(state, {...w.after,id:w.path.split('/')[1],projectId} as unknown as Task);
      for(const w of entry.writes) {if(w.path.split('/').length===2)state.data.tasks[w.path.split('/')[1]]=w.after;else state.data.children[w.path]=w.after;}
      entry.mockAfter=await scopedSignature(state.data,entry.affectedTaskIds);
      entry.preview.status='applied';
    } else if(input.action==='undo') {
      if(entry.preview.status==='undone')return entry.preview;
      const after=entry.mockAfter?.length===64?await scopedSignature(state.data,entry.affectedTaskIds):mockSignature(state.data,entry.affectedTaskIds);
      if(entry.mockAfter && entry.mockAfter!==after || entry.writes.some(w=>JSON.stringify(w.after)!==JSON.stringify(w.path.split('/').length===2 ? state.data.tasks[w.path.split('/')[1]] : state.data.children[w.path])))throw new OrganizationError('反映後に編集があるため取消できません。');
      const restored={...state.data.tasks};
      for(const w of entry.writes)if(w.path.split('/').length===2)restored[w.path.split('/')[1]]=w.before??{...w.after,isArchived:true};
      assertOrganizationGraphSafe(restored);
      for(const w of entry.writes){if(w.path.split('/').length===2){if(w.before)state.data.tasks[w.path.split('/')[1]]=w.before;else state.data.tasks[w.path.split('/')[1]]={...w.after,isArchived:true};}else if(w.before)state.data.children[w.path]=w.before;else delete state.data.children[w.path];}
      entry.preview.status='undone';
    } else throw new OrganizationError('操作を確認してください。');
    for(const c of entry.preview.changes)state.activityLogs.push({id:crypto.randomUUID(),projectId,targetType:'task',targetId:c.taskId,targetName:c.title,action:'update',userId:'e2e-mock-user',userName:'隔離環境で整理案を採用',createdAt:new Date(),organization:{operationId:entry.preview.id,kind:entry.draft.kind,sourceTaskIds:entry.draft.taskIds},changes:[{field:'organization',oldValue:'',newValue:input.action==='undo'?'反映を取消':c.summary}],source:{kind:entry.source.kind==='meeting'?'meeting':'manual',title:entry.source.kind==='incoming'?'本人が連絡から反映':entry.source.title,occurredAt:entry.source.kind==='incoming'?null:entry.source.occurredAt,...(entry.source.kind!=='incoming'?{excerpt:entry.draft.quote}:{})}});
    return entry.preview;
  });
}

/** Synthetic names for browser fixtures; never resolve these identifiers through Firebase. */
export function getOrganizationMockUsers(ids:string[]):import('@/types').User[] {
  return [...new Set(ids)].map(id=>({id,displayName:id==='e2e-mock-user'?'本人':id==='demo-colleague'?'同僚':'名前未取得（隔離環境）',email:'',photoURL:null,createdAt:new Date(0),updatedAt:new Date(0)}));
}
