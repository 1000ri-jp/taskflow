import { prepareRecurrence } from './recurrenceRepository';
import type { Task } from '@/types';
import { MOAI_LABEL_ID } from './moaiLabel';
import { prepareMoaiLabel } from './moaiLabelRepository';
import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { loadSecretary } from '@/lib/secretary/repository';
import { incomingSourceUsable } from '@/lib/secretary/incoming';
import { emptySecretaryState } from '@/lib/secretary/types';
import { OrganizationError, assertOrganizationGraphSafe, planOrganization, validOrganizationId, type OrganizationData, type OrganizationDocument, type OrganizationPlan } from './organizationEngine';
import type { OrganizationDraft, OrganizationFollowUp, OrganizationPreview, OrganizationSource } from './organizationTypes';
import type { OrganizationBasis } from './organizationTypes';
import { canonicalOrganizationValue, organizationBasisMatches, organizationChangeContent, organizationComparableWrites, organizationScope, organizationScopeIds, organizationSourceFingerprint } from './organizationIdentity';
export { createOrganizationBasis } from './organizationIdentity';

const canonical = canonicalOrganizationValue;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
interface AppliedComment { path: string; after: OrganizationDocument }
interface StoredPlan extends OrganizationPlan { beforeSignature: string; afterSignature?: string; signatureVersion?: 2; sourceFingerprint?: string; followUp?: OrganizationFollowUp; appliedComments?: AppliedComment[] }
const stateRef = (uid: string) => getAdminDb().doc(`users/${uid}/secretary/state`);
export async function organizationAccess(tx: Transaction, uid: string, projectId: string, ai = false) {
  if (!validOrganizationId(projectId)) throw new OrganizationError('プロジェクトを確認してください。');
  const db = getAdminDb(); const ref = db.doc(`projects/${projectId}`);
  const [project,members,settings] = await Promise.all([tx.get(ref),tx.get(ref.collection('members').where('userId','==',uid).limit(1)),tx.get(db.doc(`users/${uid}/settings/aiSettings`))]);
  const role = members.docs[0]?.data().role;
  const projectMembers = project.data()?.memberIds;
  if (!Array.isArray(projectMembers) || !projectMembers.every(validOrganizationId)) throw new OrganizationError('プロジェクトのメンバー情報を確認できません。',403);
  if (!project.exists || project.data()?.isArchived || !project.data()?.memberIds?.includes(uid) || !['admin','editor'].includes(role)) throw new OrganizationError('このプロジェクトを編集する権限を確認できません。',403);
  const allowed = settings.data()?.allowedProjectIds;
  if (ai && allowed != null && (!Array.isArray(allowed) || !allowed.every(validOrganizationId) || !allowed.includes(projectId))) throw new OrganizationError('このプロジェクトはAI利用範囲外です。',403);
  return {ref,memberIds:projectMembers as string[], defaultAssigneeId: typeof project.data()?.defaultAssigneeId === 'string' ? project.data()!.defaultAssigneeId as string : null};
}
async function loadData(tx: Transaction, uid: string, projectId: string, childrenFor: string[]) {
  const {ref,memberIds,defaultAssigneeId} = await organizationAccess(tx,uid,projectId);
  const [rows,lists] = await Promise.all([tx.get(ref.collection('tasks').limit(201)),tx.get(ref.collection('lists').limit(101))]);
  if (rows.size > 200 || lists.size > 100) throw new OrganizationError('200タスク・100列の取得上限を超えています。今回は反映していません。');
  const tasks = Object.fromEntries(rows.docs.map(d => [d.id,d.data()]));
  const children: OrganizationData['children'] = {};
  for (const id of organizationScopeIds({tasks}, childrenFor)) {
    if (!validOrganizationId(id)) throw new OrganizationError('タスクを確認してください。');
    for (const collection of ['comments','attachments','checklists']) {
      const documents = await tx.get(ref.collection('tasks').doc(id).collection(collection).limit(101));
      if (documents.size > 100) throw new OrganizationError('コメント・添付・手順が1種類100件を超えています。すべてを保持できるよう対象を分けてください。');
      documents.docs.forEach(d => { children[`tasks/${id}/${collection}/${d.id}`] = d.data(); });
      if (Object.keys(children).length > 250) throw new OrganizationError('関連資料が一度の取得上限250件を超えています。今回は反映していません。');
    }
  }
  const listDefaultAssigneeIds = Object.fromEntries(lists.docs.flatMap(d => {
    const value = d.data().defaultAssigneeId;
    return validOrganizationId(value) ? [[d.id, value]] : [];
  }));
  return {tasks,children,listIds:lists.docs.map(d => d.id),listDefaultAssigneeIds,memberIds,defaultAssigneeId};
}
function signature(data: OrganizationData, ids: string[]) {
  return hash(organizationScope(data, ids));
}
export function validateOrganizationSource(raw: unknown): OrganizationSource {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OrganizationError('元の資料を確認してください。');
  const s = raw as OrganizationSource;
  if (!['meeting','manual','existing','incoming'].includes(s.kind) || typeof s.id !== 'string' || !s.id || s.id.length > 250
    || s.version !== undefined && (typeof s.version !== 'string' || s.version.length > 10000)
    || typeof s.title !== 'string' || s.title.length > 200 || typeof s.text !== 'string' || s.text.length > 40000
    || s.occurredAt !== null && (typeof s.occurredAt !== 'string' || !Number.isFinite(Date.parse(s.occurredAt)))) throw new OrganizationError('元の資料・日時を確認してください。文字起こしは4万文字までです。');
  return s;
}
export async function checkedOrganizationSource(tx: Transaction, uid: string, source: OrganizationSource): Promise<OrganizationSource> {
  if (source.kind !== 'incoming') return source;
  const input = source.incoming;
  if (!input || !['gmail','chat'].includes(input.service)) throw new OrganizationError('元の連絡を確認してください。');
  const {snapshot} = await loadSecretary(uid,tx);
  const incoming = snapshot.incoming;
  const collection = incoming?.sources[input.service];
  const item = collection?.items.find(i => i.id === input.id);
  if (!incoming || !collection || !incomingSourceUsable(collection,snapshot.checkedAt) || !item
    || incoming.sourceVersions?.[`${input.service}:${input.id}`] !== input.version || incoming.connectionEpoch !== input.connectionEpoch) throw new OrganizationError('元の連絡・許可範囲が変わったか、取得できません。情報を更新してください。',409);
  return {kind:'incoming',id:`${input.service}:${input.id}`,title:item.title,text:item.text,occurredAt:item.at,incoming:input};
}
const readEntries = (value: unknown): StoredPlan[] => value && typeof value === 'object' && 'entries' in value && Array.isArray(value.entries) ? value.entries as StoredPlan[] : [];
function validateFollowUp(raw: unknown): OrganizationFollowUp {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OrganizationError('再表示の条件を確認してください。');
  const value = raw as Record<string, unknown>;
  if (value.kind === 'at' && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) && Date.parse(value.at) > Date.now()) return { kind: 'at', at: new Date(value.at).toISOString() };
  if (value.kind === 'when' && typeof value.condition === 'string' && value.condition.trim().length > 0 && value.condition.length <= 500) return { kind: 'when', condition: value.condition.trim() };
  throw new OrganizationError('再表示の日時または条件を確認してください。');
}
function save(tx: Transaction, uid: string, original: OrganizationDocument | undefined, entries: StoredPlan[]) {
  // Only patch this field; normal secretary review/decision fields remain intact.
  if (!original) tx.set(stateRef(uid),{...emptySecretaryState(),organization:{entries}});
  else tx.set(stateRef(uid),{organization:{entries}},{merge:true});
}
export async function previewOrganization(uid: string, projectId: string, rawSource: unknown, draft: OrganizationDraft, basis?: OrganizationBasis, confirmed = false) {
  const input = validateOrganizationSource(rawSource);
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const source = await checkedOrganizationSource(tx,uid,input);
    let data = await loadData(tx,uid,projectId,[...draft.taskIds,...(draft.targetTaskId ? [draft.targetTaskId] : [])]);
    const state = await tx.get(stateRef(uid)); const entries = readEntries(state.data()?.organization);
    // Explanation wording can vary between AI runs; the same source/change is one decision.
    const sourceFingerprint = await organizationSourceFingerprint(source);
    const id = hash({projectId,sourceFingerprint,change:organizationChangeContent(draft)}).slice(0,24);
    const previous = await knownEntry(entries,projectId,source,draft,sourceFingerprint);
    if (previous) {
      if (hash(organizationChangeContent(previous.draft)) !== hash(organizationChangeContent(draft))) throw new OrganizationError('同じ発言から新しい仕事が既に提案・反映されています。既存の仕事への変更か確認してください。',409);
      return previous.preview;
    }
    if (draft.quote && !source.text.includes(draft.quote) && !draft.taskIds.some(taskId => `${data.tasks[taskId]?.title ?? ''}\n${data.tasks[taskId]?.description ?? ''}`.includes(draft.quote))) throw new OrganizationError('提案の引用が元の資料にありません。');
    const plannedAt = new Date().toISOString();
    let plan = planOrganization(data,projectId,uid,id,source,draft,plannedAt,{confirmed});
    data = await loadData(tx,uid,projectId,plan.affectedTaskIds);
    if (basis !== undefined && !await organizationBasisMatches(basis,projectId,source,data,plan.affectedTaskIds)) throw new OrganizationError('分析後に対象の仕事・コメント・手順が更新されました。最新の情報で照合し直してください。',409);
    plan = planOrganization(data,projectId,uid,id,source,draft,plannedAt,{confirmed});
    const stored: StoredPlan = {...plan,beforeSignature:signature(data,plan.affectedTaskIds),signatureVersion:2,sourceFingerprint};
    const next = [...entries.filter(e => e.preview.id !== id),stored];
    // Never silently evict held/accepted evidence; user can continue with a new request after this explicit boundary.
    if (next.length > 30 || JSON.stringify(canonical(next)).length > 800000) throw new OrganizationError('保存済みの整理記録が上限に達しました。記録を確認してから続けてください。');
    save(tx,uid,state.data(),next);
    return plan.preview;
  });
}
export async function actOnOrganization(uid: string, projectId: string, id: string, action: 'apply'|'hold'|'undo'|'reopen'|'skip'|'defer', rawFollowUp?: unknown) {
  if (!validOrganizationId(id) || !['apply','hold','undo','reopen','skip','defer'].includes(action)) throw new OrganizationError('整理案を確認してください。');
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const state = await tx.get(stateRef(uid)); const entries = readEntries(state.data()?.organization);
    const index = entries.findIndex(e => e.preview.id === id && e.preview.projectId === projectId);
    if (index < 0) throw new OrganizationError('整理案が見つかりません。もう一度変更を確認してください。',404);
    const entry = entries[index];
    const childIds = entry.affectedTaskIds;
    const data = await loadData(tx,uid,projectId,childIds);
    if (action === 'apply' && entry.preview.status === 'applied' || action === 'undo' && entry.preview.status === 'undone') return entry.preview;
    const now = new Date().toISOString();
    if (action === 'hold' || action === 'reopen' || action === 'skip' || action === 'defer') {
      if (entry.preview.status === 'applied') throw new OrganizationError('反映済みです。取り消す場合は「反映を戻す」を使ってください。',409);
      if (action === 'defer') {
        const followUp = validateFollowUp(rawFollowUp);
        entry.followUp = followUp;
        entry.preview.followUp = followUp;
        delete entry.preview.reappearedReason;
        entry.preview.status = 'held';
      } else {
        delete entry.followUp;
        delete entry.preview.followUp;
        delete entry.preview.reappearedReason;
        entry.preview.status = action === 'hold' ? 'held' : action === 'skip' ? 'skipped' : 'pending';
      }
    } else {
      if (action === 'apply') {
        await checkedOrganizationSource(tx,uid,entry.source);
        // A renamed draft can have been previewed before another version was
        // accepted. Recheck the decision inside this adoption transaction.
        if (['create','new_parent'].includes(entry.draft.kind)) {
          const fingerprint = entry.sourceFingerprint ?? await organizationSourceFingerprint(entry.source);
          const accepted = await knownEntry(entries.filter(other => other.preview.id !== id && other.preview.status === 'applied'),projectId,entry.source,entry.draft,fingerprint);
          if (accepted) throw new OrganizationError('同じ発言から新しい仕事が既に反映されています。既存の仕事への変更か確認してください。',409);
        }
        if (entry.preview.status !== 'pending' || entry.beforeSignature !== (entry.signatureVersion === 2 ? signature(data,entry.affectedTaskIds) : hash(data))) throw new OrganizationError('確認後に仕事が更新されました。変更後の姿を確認し直してください。',409);
        const current = planOrganization(data,projectId,uid,id,entry.source,entry.draft,entry.preview.createdAt,{confirmed:entry.confirmed});
        if (!current.preview.canApply) throw new OrganizationError(current.preview.clarifications?.join(' ') || '反映する変更がありません。',409);
        if (hash(organizationComparableWrites(current.writes)) !== hash(organizationComparableWrites(entry.writes))) throw new OrganizationError('関連する仕事の変更により反映範囲が変わりました。確認し直してください。',409);
        const commentTaskIds = [...new Set(current.writes.filter(write => write.path.split('/').length === 2).map(write => write.path.split('/')[1]))].sort();
        if (Object.keys(data.children).length + commentTaskIds.length > 250) throw new OrganizationError('コメント・添付・手順の保存上限に達しています。履歴を確認してから、もう一度反映してください。', 409);
        for (const taskId of commentTaskIds) {
          const existingComments = Object.keys(data.children).filter(path => path.startsWith(`tasks/${taskId}/comments/`)).length;
          if (existingComments >= 100) throw new OrganizationError('コメントの保存上限に達しています。履歴を確認してから、もう一度反映してください。', 409);
        }
        const summariesByTask = new Map(entry.preview.changes.map(change => [change.taskId, change.summary]));
        entry.appliedComments = commentTaskIds.map(taskId => {
          const commentId = `moai-${hash({ operationId:id, taskId, kind:'adoption-comment' }).slice(0,32)}`;
          const path = `tasks/${taskId}/comments/${commentId}`;
          if (data.children[path]) throw new OrganizationError('反映コメントが既に存在するため、内容を確認してください。', 409);
          const summary = summariesByTask.get(taskId)?.trim() || '提案した変更を仕事に反映しました。';
          return { path, after: { taskId, content:`提案を採用して反映しました。\n${summary}`, authorId:uid, authorLabel:'モアイ', authorIcon:'🤖', purpose:'memo', mentions:[], attachments:[], createdAt:new Date(now), updatedAt:new Date(now) } };
        });
        const moaiLabel = current.writes.some(write => !write.before && write.path.split('/').length === 2 && write.after.aiSuggested === true)
          ? await prepareMoaiLabel(db, tx, projectId, new Date(now)) : null;
        entry.writes = current.writes.map(write => write.path.split('/').length === 2 ? {...write,after:{...write.after,updatedAt:new Date(now),
          ...(entry.draft.kind === 'complete' && write.after.isCompleted && !write.before?.isCompleted ? {completedAt:new Date(now)} : {}),...(!write.before ? {createdAt:new Date(now),...(write.after.aiSuggested === true && moaiLabel ? {labelIds:[...new Set([...(Array.isArray(write.after.labelIds) ? write.after.labelIds.filter(id => id !== MOAI_LABEL_ID) : []),moaiLabel.id])]} : {})} : {})}} : write);
        const afterData = { ...data,tasks:{...data.tasks},children:{...data.children} };
        for (const write of entry.writes) {
          if (write.path.split('/').length === 2) afterData.tasks[write.path.split('/')[1]] = write.after;
          else afterData.children[write.path] = write.after;
        }
        for (const comment of entry.appliedComments) afterData.children[comment.path] = comment.after;
        assertOrganizationGraphSafe(afterData.tasks);
        entry.afterSignature = signature(afterData,entry.affectedTaskIds);
        const repeatWriters = [];
        for (const write of entry.writes) if (write.path.split('/').length === 2 && write.after.isCompleted && write.before) {
          repeatWriters.push(await prepareRecurrence(tx, db.doc(`projects/${projectId}/${write.path}`), { ...write.after, id:write.path.split('/')[1], projectId } as unknown as Task, new Date(now)));
        }
        moaiLabel?.write();
        for (const repeat of repeatWriters) repeat();
        entry.writes.forEach(write => tx.set(db.doc(`projects/${projectId}/${write.path}`),write.after));
        entry.appliedComments.forEach(comment => tx.set(db.doc(`projects/${projectId}/${comment.path}`),comment.after));
        entry.preview.status = 'applied';
      } else {
        if (entry.preview.status !== 'applied' || entry.afterSignature !== signature(data,entry.affectedTaskIds)) throw new OrganizationError('反映後に他の編集・コメント・添付があるため、一括取消はできません。最新の内容を残して修正してください。',409);
        for (const comment of entry.appliedComments ?? []) {
          if (!data.children[comment.path] || hash(data.children[comment.path]) !== hash(comment.after)) throw new OrganizationError('反映コメントが変更されたため、一括取消はできません。最新の内容を残して修正してください。',409);
        }
        const restored = {...data.tasks};
        for (const write of entry.writes) if (write.path.split('/').length === 2) restored[write.path.split('/')[1]] = write.before ?? {...write.after,isArchived:true};
        assertOrganizationGraphSafe(restored);
        for (const write of entry.writes) {
          const ref = db.doc(`projects/${projectId}/${write.path}`);
          if (write.before) tx.set(ref,write.path.split('/').length === 2 ? {...write.before,updatedAt:new Date(now)} : write.before);
          else if (write.path.split('/').length === 2) tx.update(ref,{isArchived:true,archivedAt:new Date(now),archivedBy:uid,updatedAt:new Date(now)});
          else tx.delete(ref);
        }
        for (const comment of entry.appliedComments ?? []) tx.delete(db.doc(`projects/${projectId}/${comment.path}`));
        entry.preview.status = 'undone';
      }
      const privateSource = entry.source.kind === 'incoming';
      for (const change of entry.preview.changes) {
        const log = db.collection(`projects/${projectId}/activityLogs`).doc();
        tx.set(log,{projectId,targetType:'task',targetId:change.taskId,targetName:change.title,action:'update',userId:uid,userName:'整理案を本人が採用',createdAt:new Date(now),
          changes:[{field:'organization',oldValue:'',newValue:action === 'undo' ? '整理の反映を取消' : change.summary}],
          source:{kind:entry.source.kind === 'meeting' ? 'meeting' : 'manual',title:privateSource ? '本人が連絡から反映' : entry.source.title,occurredAt:privateSource ? null : entry.source.occurredAt,...(!privateSource && entry.draft.quote ? {excerpt:entry.draft.quote} : {})},
          organization:{kind:entry.draft.kind,sourceTaskIds:entry.draft.taskIds,sourceId:privateSource ? 'private' : entry.source.id,operationId:id}});
      }
    }
    entries[index] = entry; save(tx,uid,state.data(),entries);
    return entry.preview;
  });
}
export async function listOrganization(uid: string,projectId: string) {
  return getAdminDb().runTransaction(async tx => {
    await organizationAccess(tx,uid,projectId);
    const state = await tx.get(stateRef(uid));
    const entries = readEntries(state.data()?.organization);
    const visible: OrganizationPreview[] = [];
    let changed = false;
    const now = new Date();
    for (const entry of entries.filter(e => e.preview.projectId === projectId)) {
      if (entry.source.kind === 'incoming') { try { await checkedOrganizationSource(tx,uid,entry.source); } catch { continue; } }
      const followUp = entry.followUp ?? entry.preview.followUp;
      if (entry.preview.status === 'held' && followUp?.kind === 'at' && !followUp.triggeredAt && Date.parse(followUp.at) <= now.getTime()) {
        const triggered = { ...followUp, triggeredAt: now.toISOString() } satisfies OrganizationFollowUp;
        entry.followUp = triggered;
        entry.preview = { ...entry.preview, status: 'pending', followUp: triggered, reappearedReason: '指定した日時になりました' };
        changed = true;
      }
      visible.push({...entry.preview, aiSuggested:entry.draft.aiSuggested === true, ...(entry.draft.kind === 'checklist' ? {checklist:entry.draft.checklist ?? []} : {})});
    }
    if (changed) save(tx, uid, state.data(), entries.map(entry => {
      const update = visible.find(item => item.id === entry.preview.id);
      return update ? { ...entry, preview: update } : entry;
    }));
    return visible;
  });
}

/** Rebuild a private proposal from its saved intent and current work; shared tasks stay untouched. */
export async function reconsiderOrganization(uid: string, projectId: string, id: string) {
  if (!validOrganizationId(id)) throw new OrganizationError('整理案を確認してください。');
  return getAdminDb().runTransaction(async tx => {
    const state = await tx.get(stateRef(uid));
    const entries = readEntries(state.data()?.organization);
    const index = entries.findIndex(entry => entry.preview.id === id && entry.preview.projectId === projectId);
    if (index < 0) throw new OrganizationError('整理案が見つかりません。', 404);
    const entry = entries[index];
    let data = await loadData(tx, uid, projectId, entry.affectedTaskIds);
    if (entry.preview.status === 'applied') throw new OrganizationError('この案は反映済みです。現在の仕事を確認してください。', 409);
    const source = await checkedOrganizationSource(tx, uid, entry.source);
    const now = new Date().toISOString();
    let plan = planOrganization(data, projectId, uid, id, source, entry.draft, now, { confirmed: false });
    data = await loadData(tx, uid, projectId, plan.affectedTaskIds);
    plan = planOrganization(data, projectId, uid, id, source, entry.draft, now, { confirmed: false });
    entries[index] = { ...plan, beforeSignature: signature(data, plan.affectedTaskIds), signatureVersion: 2, sourceFingerprint: await organizationSourceFingerprint(source) };
    if (JSON.stringify(canonical(entries)).length > 800000) throw new OrganizationError('保存済みの整理記録が上限に達しました。');
    save(tx, uid, state.data(), entries);
    return { source, draft: entry.draft, preview: plan.preview };
  });
}

export async function readOrganizationSource(uid: string,projectId: string,id: string) {
  return getAdminDb().runTransaction(async tx => {
    await organizationAccess(tx,uid,projectId);
    const state = await tx.get(stateRef(uid));
    const entry = readEntries(state.data()?.organization).find(e => e.preview.id === id && e.preview.projectId === projectId);
    if (!entry) throw new OrganizationError('元の資料が見つかりません。',404);
    return checkedOrganizationSource(tx,uid,entry.source);
  });
}

export async function organizationContext(uid: string,projectId: string) {
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const {ref,memberIds,defaultAssigneeId} = await organizationAccess(tx,uid,projectId);
    if (memberIds.length > 100) throw new OrganizationError('メンバーが取得上限を超えています。');
    const [profiles,lists] = await Promise.all([Promise.all(memberIds.map(id => tx.get(db.doc(`users/${id}`)))),tx.get(ref.collection('lists').limit(101))]);
    if (lists.size > 100) throw new OrganizationError('列が取得上限を超えています。');
    return {defaultAssigneeId,members:profiles.map((d,i) => ({id:memberIds[i],displayName:typeof d.data()?.displayName === 'string' ? d.data()!.displayName : '名前未取得'})),lists:lists.docs.map(d => ({id:d.id,name:typeof d.data().name === 'string' ? d.data().name : '列'}))};
  });
}

export async function filterKnownOrganizationDrafts(uid: string,projectId: string,source: OrganizationSource,drafts: OrganizationDraft[]) {
  return getAdminDb().runTransaction(async tx => {
    await organizationAccess(tx,uid,projectId,true);
    const state = await tx.get(stateRef(uid));
    const entries = readEntries(state.data()?.organization);
    const sourceFingerprint = await organizationSourceFingerprint(source);
    const matched = await Promise.all(drafts.map(draft => knownEntry(entries,projectId,source,draft,sourceFingerprint)));
    return drafts.filter((_draft,index) => !matched[index]);
  });
}

async function knownEntry(entries: StoredPlan[], projectId: string, source: OrganizationSource, draft: OrganizationDraft, fingerprint: string) {
  for (const entry of entries) {
    if (entry.preview.projectId !== projectId || !['held','applied','skipped'].includes(entry.preview.status)) continue;
    if ((entry.sourceFingerprint ?? await organizationSourceFingerprint(entry.source)) !== fingerprint) continue;
    if (hash(organizationChangeContent(entry.draft)) === hash(organizationChangeContent(draft))) return entry;
    // A renamed AI-generated creation from the same grounded utterance is not
    // another authorized creation. Different owners/parents remain independent.
    if (['create','new_parent'].includes(draft.kind) && entry.draft.kind === draft.kind && draft.quote.trim() && entry.draft.quote.trim() === draft.quote.trim()
      && hash([entry.draft.taskIds.slice().sort(),entry.draft.targetTaskId ?? null,entry.draft.assigneeIds?.slice().sort() ?? null]) === hash([draft.taskIds.slice().sort(),draft.targetTaskId ?? null,draft.assigneeIds?.slice().sort() ?? null])) return entry;
  }
  void source;
  return undefined;
}
