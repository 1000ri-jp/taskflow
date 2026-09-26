import { resolveTaskAssignees } from './assigneeDefaults';
import { MOAI_LABEL_ID } from './moaiLabel';
import { completionBlockReason } from './completion';
import type { ListReference, Task } from '@/types';
import type { OrganizationDraft, OrganizationPreview, OrganizationSource } from './organizationTypes';
import { canonicalOrganizationValue, organizationScopeIds } from './organizationIdentity';

export class OrganizationError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export type OrganizationDocument = Record<string, unknown>;
export interface OrganizationData { defaultAssigneeId?: string | null; listDefaultAssigneeIds?: Record<string, string | null>; tasks: Record<string, OrganizationDocument>; children: Record<string, OrganizationDocument>; references?: Record<string, ListReference>; listIds: string[]; memberIds: string[] }
export interface OrganizationWrite { path: string; before: OrganizationDocument | null; after: OrganizationDocument }
export interface OrganizationPlan { preview: OrganizationPreview; writes: OrganizationWrite[]; affectedTaskIds: string[]; source: OrganizationSource; draft: OrganizationDraft; confirmed?: boolean }
export const validOrganizationId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
const unique = (v: string[]) => [...new Set(v)];
const text = (v: unknown) => typeof v === 'string' ? v : '';
export function validateOrganizationDraft(raw: unknown): OrganizationDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OrganizationError('整理案を確認してください。');
  const d = raw as OrganizationDraft;
  const keys = ['aiSuggested','kind','taskIds','targetTaskId','title','description','descriptionMode','confirmationPoints','speech','workState','assigneeIds','dueDate','listId','checklist','reason','quote'];
  const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith('0000-') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  if (Object.keys(d).some(k => !keys.includes(k)) || !['update','create','parent_child','new_parent','related','dependency','checklist','merge','complete','cancel','hold','wait','resume'].includes(d.kind)
    || d.aiSuggested !== undefined && typeof d.aiSuggested !== 'boolean'
    || !Array.isArray(d.taskIds) || d.taskIds.length > 12 || !d.taskIds.every(validOrganizationId) || unique(d.taskIds).length !== d.taskIds.length
    || d.targetTaskId !== undefined && !validOrganizationId(d.targetTaskId) || d.listId !== undefined && !validOrganizationId(d.listId)
    || typeof d.reason !== 'string' || !d.reason.trim() || d.reason.length > 1000 || typeof d.quote !== 'string' || d.quote.length > 1500
    || d.title !== undefined && (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 500)
    || d.description !== undefined && (typeof d.description !== 'string' || d.description.length > 8000)
    || d.descriptionMode !== undefined && !['append','replace'].includes(d.descriptionMode)
    || d.confirmationPoints !== undefined && (!Array.isArray(d.confirmationPoints) || d.confirmationPoints.length > 12 || d.confirmationPoints.some(v => typeof v !== 'string' || !v.trim() || v.length > 500))
    || d.speech !== undefined && !['decision','request','report','tentative','idea'].includes(d.speech)
    || d.workState !== undefined && (!d.workState || typeof d.workState !== 'object' || Array.isArray(d.workState) || Object.keys(d.workState).some(k => !['reason','resumeCondition','reviewAt'].includes(k))
      || typeof d.workState.reason !== 'string' || !d.workState.reason.trim() || d.workState.reason.length > 1000
      || typeof d.workState.resumeCondition !== 'string' || !d.workState.resumeCondition.trim() || d.workState.resumeCondition.length > 1000
      || d.workState.reviewAt !== null && !validDate(d.workState.reviewAt))
    || d.assigneeIds !== undefined && (!Array.isArray(d.assigneeIds) || d.assigneeIds.length > 20 || !d.assigneeIds.every(validOrganizationId))
    || d.dueDate !== undefined && d.dueDate !== null && (typeof d.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) || !Number.isFinite(Date.parse(d.dueDate)) || new Date(d.dueDate).toISOString().slice(0,10) !== d.dueDate)
    || d.checklist !== undefined && (!Array.isArray(d.checklist) || !d.checklist.length || d.checklist.length > 40 || d.checklist.some(i => typeof i !== 'string' || !i.trim() || i.length > 500))) throw new OrganizationError('整理案の種類・対象・入力を確認してください。');
  return d;
}
export function assertOrganizationGraphSafe(tasks: Record<string, OrganizationDocument>) {
  for (const mode of ['parentTaskId', 'dependsOnTaskIds']) {
    const done = new Set<string>();
    const visit = (id: string, trail: Set<string>) => {
      if (done.has(id)) return;
      if (trail.has(id)) throw new OrganizationError('親子・依存が循環するため反映できません。');
      const task = tasks[id]; if (!task || task.isArchived) return;
      const next = mode === 'parentTaskId' ? [text(task.parentTaskId)].filter(Boolean) : list(task.dependsOnTaskIds);
      const branch = new Set(trail).add(id);
      next.forEach(value => visit(value, branch)); done.add(id);
    };
    Object.keys(tasks).forEach(id => visit(id,new Set()));
  }
  for (const item of Object.values(tasks)) {
    const parentId = text(item.parentTaskId);
    if (parentId && tasks[parentId]?.parentTaskId) throw new OrganizationError('親タスクとサブタスクの二段までです。既存の階層を確認してください。');
  }

}
/** Pure change planner shared by live transactions and the isolated browser workbench. */
export function planOrganization(data: OrganizationData, projectId: string, uid: string, id: string, source: OrganizationSource, raw: OrganizationDraft, now: string, options: { confirmed?: boolean } = {}): OrganizationPlan {
  const d = validateOrganizationDraft(raw);
  const tasks = Object.fromEntries(Object.entries(data.tasks).map(([key,row]) => [key,{...row}]));
  const writes = new Map<string, OrganizationWrite>();
  const summaries = new Map<string,string>();
  const blockers: string[] = [];
  const clarifications = [...(d.confirmationPoints ?? []), ...(['tentative','idea'].includes(d.speech ?? '') ? ['未確定の発言です。今回の変更として確定してよいか確認してください。'] : [])];
  const targetId = d.targetTaskId ?? d.taskIds[0];
  const target = targetId ? tasks[targetId] : undefined;
  const task = (taskId: string) => {
    const row = tasks[taskId];
    if (!row || row.isArchived || row.isAbandoned) throw new OrganizationError('整理対象が取得できないか、アーカイブ・中止されています。',409);
    return row;
  };
  d.taskIds.forEach(task);
  if (d.targetTaskId) task(d.targetTaskId);
  if(target?.parentTaskId && (['hold','wait','resume','checklist','dependency'].includes(d.kind) || d.description !== undefined))throw new OrganizationError('説明・やりとり・手順・待機は親タスクで管理してください。');
  if (d.assigneeIds?.some(member => !data.memberIds.includes(member))) throw new OrganizationError('現在のプロジェクトメンバーから担当を選んでください。');
  const equal = (a: unknown, b: unknown) => JSON.stringify(canonicalOrganizationValue(a)) === JSON.stringify(canonicalOrganizationValue(b));
  const put = (taskId: string, patch: OrganizationDocument, summary: string, force = false) => {
    if (!force && data.tasks[taskId] && Object.entries(patch).every(([field, value]) => equal(tasks[taskId][field], value))) return;
    const path = `tasks/${taskId}`;
    tasks[taskId] = {...tasks[taskId],...patch,updatedAt:new Date(now)};
    writes.set(path,{path,before:data.tasks[taskId] ?? null,after:tasks[taskId]}); summaries.set(taskId,summary);
  };
  const makeTask = (taskId: string, parent?: string) => {
    if(parent && (task(parent).parentTaskId || task(parent).taskKind==='review_request'))throw new OrganizationError('親タスクとサブタスクの二段までです。');
    if(parent && d.description?.trim())throw new OrganizationError('サブタスクは名前・担当・期日・完了だけです。説明は親タスクに追加してください。');
    const listId = d.listId || text(target?.listId) || data.listIds[0];
    if (!d.title || !data.listIds.includes(listId || '')) throw new OrganizationError('新しい仕事の件名と登録先の列を選んでください。');
    const assigneeIds = resolveTaskAssignees({ explicit: d.assigneeIds, parent: parent ? { assigneeIds: list(task(parent).assigneeIds) } : null,
      defaultAssigneeId: data.defaultAssigneeId, listDefaultAssigneeId: data.listDefaultAssigneeIds?.[listId], memberIds: data.memberIds });
    if (assigneeIds.some(member => !data.memberIds.includes(member))) throw new OrganizationError('現在のプロジェクトメンバーから担当を選んでください。');
    if (Object.values(data.tasks).some(row => !row.isArchived && !row.isAbandoned && text(row.title).trim() === d.title!.trim()
      && (text(row.parentTaskId) || null) === (parent || null) && equal(list(row.assigneeIds).slice().sort(), assigneeIds.slice().sort()))) {
      blockers.push('同じ名前・担当・親の仕事が既にあります。既存の仕事への変更か、別の仕事かを確認してください。');
    }
    put(taskId,{projectId,listId,title:d.title.trim(),description:d.description ?? '',order:Object.keys(tasks).length + 1,
      assigneeIds,labelIds:d.aiSuggested ? [MOAI_LABEL_ID] : [],...(d.aiSuggested ? {aiSuggested:true} : {}),tagIds:[],dependsOnTaskIds:[],priority:null,startDate:null,
      dueDate:d.dueDate ? new Date(`${d.dueDate}T00:00:00+09:00`) : null,durationDays:null,isDueDateFixed:!!d.dueDate,
      isCompleted:false,completedAt:null,isAbandoned:false,isArchived:false,archivedAt:null,archivedBy:null,
      createdBy:uid,createdAt:new Date(now),...(parent ? {parentTaskId:parent} : {})},parent ? '新しいサブタスクを作成' : '新しいタスクを作成');
  };
  if (d.kind === 'create') makeTask(`org-${id}`,targetId);
  else if (d.kind === 'new_parent') {
    if (!d.taskIds.length) throw new OrganizationError('まとめる仕事を選んでください。');
    const parentId = `org-${id}`; makeTask(parentId);
    d.taskIds.forEach(child => put(child,{parentTaskId:parentId},`「${d.title}」の子にする`));
  } else {
    if (!targetId || !target) throw new OrganizationError('反映先の仕事を選んでください。');
    if (d.kind === 'update') {
      if (d.title === undefined && d.description === undefined && !d.assigneeIds && d.dueDate === undefined) throw new OrganizationError('変更する名前・説明・担当・期限のいずれかを指定してください。');
      const addition = d.description?.trim();
      const description = d.descriptionMode === 'replace' ? d.description?.trim() : addition && !text(target.description).includes(addition) ? [text(target.description),addition].filter(Boolean).join('\n\n') : undefined;
      const schedule: OrganizationDocument = {};
      if (d.dueDate !== undefined) {
        schedule.dueDate = d.dueDate ? new Date(`${d.dueDate}T00:00:00+09:00`) : null;
        schedule.isDueDateFixed = !!d.dueDate;
        if (d.dueDate && target.startDate) {
          const start = new Date(String(canonicalOrganizationValue(target.startDate)));
          if (!Number.isFinite(start.getTime())) throw new OrganizationError('開始日を確認できません。');
          const startDay = new Date(start.getTime() + 9 * 3600000).toISOString().slice(0,10);
          if (startDay > d.dueDate) throw new OrganizationError('期限が開始日より前です。開始日も確認してください。');
          schedule.durationDays = Math.round((Date.parse(d.dueDate) - Date.parse(startDay)) / 86400000) + 1;
        }
      }
      put(targetId,{...(d.title !== undefined ? {title:d.title.trim()} : {}), ...(description !== undefined ? {description} : {}),
        ...(d.assigneeIds ? {assigneeIds:unique(d.assigneeIds)} : {}),...schedule},'指定された名前・説明・担当・期限を変更');
    } else if (['complete','cancel','hold','wait','resume'].includes(d.kind)) {
      if (d.kind === 'complete') {
        if (target.taskKind === 'review_request') blockers.push('確認依頼は確認する人が「確認OK」または「修正が必要」で返答してください。');
        if (!target.isCompleted) {
          const scope = Object.entries(tasks).map(([id, t]) => ({ ...t, id, projectId }) as unknown as Task);
          const reason = completionBlockReason({ ...target, id: targetId, projectId } as unknown as Task, scope);
          if (reason) blockers.push(reason);
          put(targetId,{isCompleted:true,completedAt:new Date(now),isAbandoned:false,workState:null},'仕事を完了にする');
        }
      } else if (d.kind === 'cancel') {
        if (target.isCompleted) throw new OrganizationError('完了した仕事は中止に変更できません。現在の状態を確認してください。');
        put(targetId,{isAbandoned:true,workState:null},'仕事を中止にする');
      } else if (d.kind === 'resume') {
        if (target.workState != null) put(targetId,{workState:null},'保留・待ちを解除する');
      } else {
        if (target.isCompleted) throw new OrganizationError('完了した仕事は保留・待ちに変更できません。');
        if (!d.workState) throw new OrganizationError('保留・待ちの理由と再開条件を入力してください。');
        put(targetId,{workState:{status:d.kind,reason:d.workState.reason.trim(),resumeCondition:d.workState.resumeCondition.trim(),reviewAt:d.workState.reviewAt}},d.kind === 'hold' ? '仕事を保留にする' : '返事・素材の到着を待つ');
      }
    } else if (d.kind === 'checklist') {
      if (!d.checklist?.length) throw new OrganizationError('チェック項目を入力してください。');
      const path = `tasks/${targetId}/checklists/org-${id}`;
      writes.set(path,{path,before:null,after:{taskId:targetId,title:d.title ?? '作業手順',order:999,items:d.checklist.map((item,i) => ({id:`org-${id}-${i}`,text:item,isChecked:false,order:i})),createdAt:new Date(now)}});
      put(targetId,{},'チェックリストを追加',true);
    } else if (d.kind === 'parent_child') {
      if (!d.taskIds.some(child => child !== targetId)) throw new OrganizationError('親と子を選んでください。');
      d.taskIds.filter(child => child !== targetId).forEach(child => put(child,{parentTaskId:targetId},`「${text(target.title)}」の子にする`));
    } else if (d.kind === 'related') {
      const ids = unique([...d.taskIds,targetId]); if (ids.length < 2) throw new OrganizationError('関連する仕事を2件以上選んでください。');
      ids.forEach(taskId => put(taskId,{relatedTaskIds:unique([...list(task(taskId).relatedTaskIds),...ids.filter(i => i !== taskId)])},'関連する仕事へのリンクを追加'));
    } else if (d.kind === 'dependency') {
      const ids = d.taskIds.filter(dep => dep !== targetId); if (!ids.length) throw new OrganizationError('先に完了する必要がある仕事を選んでください。');
      put(targetId,{dependsOnTaskIds:unique([...list(target.dependsOnTaskIds),...ids])},'選んだ仕事の完了を着手の前提にする');
    } else if (d.kind === 'merge') {
      const removed = d.taskIds.filter(taskId => taskId !== targetId); if (!removed.length) throw new OrganizationError('残す仕事と統合元を選んでください。');
      const merged = removed.map(task);
      if (merged.some(t => !!t.isCompleted !== !!target.isCompleted || (t.taskKind ?? 'task') !== (target.taskKind ?? 'task'))) throw new OrganizationError('完了状態・確認依頼の種類が異なります。先に差分を確認してください。');
      const wouldLose = ['dueDate','startDate','milestoneId','parentTaskId','workState','completionPolicy'].filter(field => merged.some(t => t[field] && !equal(t[field],target[field])));
      if (wouldLose.length) throw new OrganizationError(`期限・開始日・節目・親・保留条件の差分を確認してから統合してください（${wouldLose.join(' / ')}）。`);
      put(targetId,{description:[text(target.description),...removed.map(sourceId => `【統合元：${text(task(sourceId).title)}】\n${text(task(sourceId).description)}`)].filter(Boolean).join('\n\n'),
        assigneeIds:unique([target,...merged].flatMap(t => list(t.assigneeIds))),labelIds:unique([target,...merged].flatMap(t => list(t.labelIds))),tagIds:unique([target,...merged].flatMap(t => list(t.tagIds))),
        dependsOnTaskIds:unique([target,...merged].flatMap(t => list(t.dependsOnTaskIds))).filter(i => i !== targetId && !removed.includes(i)),
        relatedTaskIds:unique([target,...merged].flatMap(t => list(t.relatedTaskIds))).filter(i => i !== targetId && !removed.includes(i)),
        mergedFromTaskIds:unique([...list(target.mergedFromTaskIds),...removed])},'本文・担当・ラベル・添付・コメント・手順を集約し、統合元は履歴付きで保管');
      for (const sourceId of removed) {
        put(sourceId,{isArchived:true,archivedAt:new Date(now),archivedBy:uid,mergedIntoTaskId:targetId},`「${text(target.title)}」へ統合・元情報を保管`);
        for (const [path, original] of Object.entries(data.children)) {
          const parts = path.split('/'); if (parts[1] !== sourceId) continue;
          const destination = `tasks/${targetId}/${parts[2]}/org-${id}-${sourceId}-${parts[3]}`;
          writes.set(destination,{path:destination,before:null,after:{...original,taskId:targetId,organizationOrigin:{taskId:sourceId,documentId:parts[3],operationId:id}}});
        }
      }
      for (const [taskId,row] of Object.entries(tasks)) {
        if (removed.includes(taskId) || row.isArchived) continue;
        const patch: OrganizationDocument = {};
        if (removed.includes(text(row.parentTaskId))) patch.parentTaskId = targetId;
        for (const field of ['dependsOnTaskIds','relatedTaskIds']) if (list(row[field]).some(i => removed.includes(i))) patch[field] = unique(list(row[field]).map(i => removed.includes(i) ? targetId : i)).filter(i => i !== taskId);
        if (Object.keys(patch).length) put(taskId,patch,'統合先へ親・依存・関連リンクを更新');
      }
    }
  }
  assertOrganizationGraphSafe(tasks);
  if (writes.size + summaries.size + 1 > 450 || JSON.stringify([...writes.values()]).length > 450000) throw new OrganizationError('変更量が一度に保存できる上限を超えています。対象を分けてください。');
  const display = (row: OrganizationDocument | undefined) => row ? `${text(row.title)}\n${text(row.description)}\n担当: ${list(row.assigneeIds).join('・') || '未指定'} / 期限: ${row.dueDate ? String(row.dueDate) : '未指定'} / 親: ${text(row.parentTaskId) || 'なし'}\n依存: ${list(row.dependsOnTaskIds).join('・') || 'なし'} / 関連: ${list(row.relatedTaskIds).join('・') || 'なし'}` : '';
  const fields = ['title','description','listId','assigneeIds','dueDate','durationDays','isDueDateFixed','parentTaskId','dependsOnTaskIds','relatedTaskIds','isCompleted','completedAt','isAbandoned','isArchived','workState'];
  const preview: OrganizationPreview = {id,projectId,kind:d.kind,aiSuggested:d.aiSuggested === true,...(d.kind === 'checklist' ? {checklist:d.checklist ?? []} : {}),status:'pending',reason:d.reason,sourceTitle:source.title,quote:d.quote,
    changes:[...summaries].map(([taskId,summary]) => ({taskId,title:text(tasks[taskId]?.title),summary,before:display(data.tasks[taskId]),after:display(tasks[taskId]),
      fields:fields.filter(field => !equal(data.tasks[taskId]?.[field], tasks[taskId]?.[field])).map(field => ({field,before:canonicalOrganizationValue(data.tasks[taskId]?.[field] ?? null),after:canonicalOrganizationValue(tasks[taskId]?.[field] ?? null)}))})),
    warnings:[...(d.aiSuggested && ['create','new_parent'].includes(d.kind) ? ['新しく作る仕事に「モアイ」ラベルを付けます。'] : []),...(d.kind === 'merge' ? ['統合元と元のコメント・添付は保管します。担当・期限・完了条件が同じ仕事か、この差分で確認してください。'] : []), ...(!writes.size ? ['同じ内容が既に反映されています。変更はありません。'] : [])],
    clarifications:unique([...clarifications,...blockers]),canApply:!!writes.size && !blockers.length && (!clarifications.length || !!options.confirmed),createdAt:now};
  return {preview,writes:[...writes.values()],affectedTaskIds:organizationScopeIds(data,unique([...summaries.keys(),...d.taskIds,...(targetId ? [targetId] : [])])),source,draft:d,confirmed:!!options.confirmed};
}
