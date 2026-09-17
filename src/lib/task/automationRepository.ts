import { completionBlockReason } from './completion';
import { prepareRecurrence } from './recurrenceRepository';
import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { cacheRef, connectionRef, type Connection } from '@/lib/google/workspace/oauth';
import { isGoogleConfigured } from '@/lib/google/workspace/security';
import { refreshWorkspace, workspaceView } from '@/lib/google/workspace/repository';
import type { Task } from '@/types';
import { completesCriterion, expectedDateSchedule, evidenceRuleVersion, reminderDue, requiredChildrenState, selectEvidence, validRule } from './automationEngine';
import { hasAmbiguousEvidenceRevision } from './automationEvidenceRevision';
import { STAGE_LABELS, type AllChildrenCompletionPolicy, type AutomationWorkSnapshot, type AutomationGrant, type AutomationState, type AutomationView, type TaskEvidence, type TaskEvidenceRule } from './automationTypes';

export class AutomationError extends Error { constructor(message: string, public status = 422) { super(message); } }
const stateRef = (uid: string) => getAdminDb().doc(`users/${uid}/secretary/task-automation`);
const taskRef = (projectId: string, taskId: string) => getAdminDb().doc(`projects/${projectId}/tasks/${taskId}`);
const id = (value: unknown): value is string => typeof value === 'string' && /^[^/]{1,200}$/.test(value);
export function automationIso(value: unknown): string | null {
  if (typeof value === 'string') return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return automationIso(value.toDate());
  return null;
}
function canonical(value: unknown): unknown {
  if (value instanceof Date || value && typeof value === 'object' && 'toDate' in value) return automationIso(value);
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
}
export const automationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function taskVersion(task: DocumentData) {
  // Acquisition status changes do not invalidate the user's work; all actual work edits do.
  return automationHash(Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'automation')));
}
function stateData(uid: string, value?: DocumentData): AutomationState {
  if (!value) return { uid, automationEnabled: false, revision: 0, grants: [], reminders: [] };
  if (value.uid !== uid || !Array.isArray(value.grants) || !Array.isArray(value.reminders) || !Number.isSafeInteger(value.revision)) throw new AutomationError('自動更新設定を読み込めません。', 503);
  return value as AutomationState;
}
function saveState(tx: Transaction, state: AutomationState) {
  state.revision++; state.automationEnabled = state.grants.some(g => g.rule.enabled) || state.reminders.length > 0;
  if (JSON.stringify(state).length > 750000) throw new AutomationError('自動更新の履歴上限です。設定と履歴を確認してください。', 409);
  tx.set(stateRef(state.uid), state);
}
async function access(tx: Transaction, uid: string, projectId: string, write: boolean, requireAI = true) {
  const db = getAdminDb();
  const [project, members, settings, user] = await Promise.all([
    tx.get(db.doc(`projects/${projectId}`)), tx.get(db.collection(`projects/${projectId}/members`).where('userId', '==', uid).limit(1)),
    tx.get(db.doc(`users/${uid}/settings/aiSettings`)), tx.get(db.doc(`users/${uid}`)),
  ]);
  const p = project.data(); const role = members.docs[0]?.data().role; const allowed = settings.data()?.allowedProjectIds;
  if (!p || p.isArchived || !p.memberIds?.includes(uid) || !(write ? ['admin', 'editor'] : ['admin', 'editor', 'viewer']).includes(role) ||
    requireAI && allowed != null && (!Array.isArray(allowed) || !allowed.includes(projectId))) throw new AutomationError('現在のプロジェクト権限・AI利用範囲を確認してください。', 403);
  return { project: p, user: user.data(), role };
}
function activity(tx: Transaction, uid: string, projectId: string, taskId: string, task: DocumentData, message: string, action = 'update') {
  tx.create(getAdminDb().collection(`projects/${projectId}/activityLogs`).doc(), {
    projectId, targetType: 'task', targetId: taskId, targetName: task.title, userId: uid, userName: '任された自動更新',
    action, changes: [{ field: '確認結果', newValue: message }], createdAt: new Date(),
  });
}
export async function readAutomation(uid: string): Promise<AutomationView> {
  return getAdminDb().runTransaction(async tx => {
    const state = stateData(uid, (await tx.get(stateRef(uid))).data());
    const visible = new Set<string>();
    for (const projectId of new Set([...state.grants.map(g => g.rule.projectId), ...state.reminders.map(r => r.projectId)])) {
      try { await access(tx, uid, projectId, false, false); visible.add(projectId); } catch (e) { if (!(e instanceof AutomationError && e.status === 403)) throw e; }
    }
    return { revision: state.revision, grants: state.grants.filter(g => visible.has(g.rule.projectId)), reminders: state.reminders.filter(r => visible.has(r.projectId)), backgroundConfigured: process.env.TASK_AUTOMATION_SCHEDULED === 'true' };
  });
}
export async function saveAutomationRule(uid: string, rule: TaskEvidenceRule, revision: number) {
  if (!validRule(rule)) throw new AutomationError('対象・期間・本人名・完了条件・取得元を確認してください。');
  await getAdminDb().runTransaction(async tx => {
    await access(tx, uid, rule.projectId, true);
    const [sd, td, connection] = await Promise.all([tx.get(stateRef(uid)), tx.get(taskRef(rule.projectId, rule.taskId)),
      isGoogleConfigured() && rule.sources.includes('gmail') ? tx.get(connectionRef(uid)) : Promise.resolve(null)]);
    const state = stateData(uid, sd.data()); const task = td.data();
    if (state.revision !== revision) throw new AutomationError('設定が変わりました。読み直してください。', 409);
    if (!task || task.isArchived || task.isAbandoned || (!rule.order && task.assigneeIds?.length !== 1)) throw new AutomationError('担当が一人の個別タスクで設定してください。', 403);
    if (rule.enabled && (task.parentTaskId || task.taskKind === 'review_request')) throw new AutomationError('自動確認は親タスクで設定してください。');
    const c = connection?.data() as Connection | undefined;
    if (rule.enabled && rule.sources.includes('gmail') && !c?.enabled.includes('gmail')) throw new AutomationError('先に本人のGmailを接続してください。', 409);
    const old = state.grants.find(g => g.rule.projectId === rule.projectId && g.rule.taskId === rule.taskId);
    if (!old && state.grants.length >= 40) throw new AutomationError('自動更新の対象は40件までです。');
    const now = new Date().toISOString();
    const identityChanged = old && evidenceRuleVersion(old.rule) !== evidenceRuleVersion(rule);
    const editedAfterGrant = old && old.expectedTaskVersion !== taskVersion(task);
    // The grant is explicit and starts at the task's creation. Historical results are matched to its exact period/identity.
    const grant: AutomationGrant = { rule, uid, grantedAt: now, notBefore: automationIso(task.createdAt) ?? now,
      connectionEpoch: c?.epoch ?? null, expectedTaskVersion: taskVersion(task), check: rule.enabled ? 'unconfirmed' : 'revoked', checkedAt: null,
      reason: rule.enabled ? '指定した根拠を確認します。' : '自動更新を解除しました。', latestEvidenceAt: identityChanged ? null : old?.latestEvidenceAt ?? null, stage: identityChanged ? null : old?.stage ?? null,
      ownedCompletion: identityChanged || editedAfterGrant ? false : old?.ownedCompletion ?? false, records: old?.records ?? [] };
    state.grants = [...state.grants.filter(g => g !== old), grant];
    saveState(tx, state);
    tx.update(td.ref, { automation: { ...(task.automation ?? {}), ownerId: uid, stage: grant.stage, evidenceAt: grant.latestEvidenceAt, expectedDate: task.automation?.expectedDate ?? null, check: grant.check, checkedAt: now } });
    activity(tx, uid, rule.projectId, rule.taskId, task, rule.enabled ? '本人が指定した対象・期間・完了条件の自動更新を許可' : '本人が自動更新を解除');
  });
  return readAutomation(uid);
}
async function processGrant(uid: string, key: string, now: string) {
  const db = getAdminDb();
  await db.runTransaction(async tx => {
    const state = stateData(uid, (await tx.get(stateRef(uid))).data());
    const grant = state.grants.find(g => `${g.rule.projectId}/${g.rule.taskId}` === key);
    if (!grant?.rule.enabled) return;
    const rule = grant.rule;
    let canAccess = true;
    try { await access(tx, uid, rule.projectId, true); } catch (e) { if (e instanceof AutomationError && e.status === 403) canAccess = false; else throw e; }
    const taskDoc = await tx.get(taskRef(rule.projectId, rule.taskId)); let task = taskDoc.data();
    const sources: TaskEvidence[] = []; let incomplete = false; let revoked = false; let unavailable = false;
    if (canAccess && task && rule.sources.includes('comment')) {
      // A complete bounded read prevents applying an older positive while overlooking a newer cancellation.
      const comments = await tx.get(taskDoc.ref.collection('comments').limit(201));
      incomplete ||= comments.size > 200;
      for (const comment of comments.docs.slice(0, 200)) {
        const c = comment.data(); const at = automationIso(c.updatedAt) ?? automationIso(c.createdAt);
        if (!at || typeof c.content !== 'string' || c.content.length > 12000) { incomplete = true; continue; }
        sources.push({ id: comment.id, version: automationHash(c), source: 'comment', at, text: c.content, sender: '', authorId: c.authorId,
          url: `/projects/${rule.projectId}/board?task=${rule.taskId}&comment=${comment.id}` });
      }
    }
    if (canAccess && task && rule.sources.includes('gmail')) {
      if (!isGoogleConfigured()) revoked = true;
      else {
        const [cd, cache] = await Promise.all([tx.get(connectionRef(uid)), tx.get(cacheRef(uid))]);
        const connection = cd.data() as Connection | undefined;
        const source = workspaceView(connection, cache.data() as Parameters<typeof workspaceView>[1]).sources.gmail;
        revoked = !connection?.enabled.includes('gmail') || connection.epoch !== grant.connectionEpoch;
        unavailable = !source.fetchedAt || Date.parse(now) - Date.parse(source.fetchedAt) > 3600000 || source.status !== 'ready' && source.status !== 'partial';
        incomplete ||= source.status === 'partial';
        if (!revoked && !unavailable) for (const item of source.items) sources.push({ id: item.id, version: automationHash(item), source: 'gmail', at: item.at,
          text: `${item.title}\n${item.text}`, sender: item.sourceName, authorId: uid, url: item.url });
      }
    }
    const graph = canAccess && task && !task.parentTaskId ? await tx.get(db.collection(`projects/${rule.projectId}/tasks`).limit(501)) : null;
    const completionReason = task ? graph && graph.size > 500 ? '前提の全体を取得できません。' : completionBlockReason({ ...task,id:rule.taskId,projectId:rule.projectId } as Task, graph?.docs.map(d=>({...d.data(),id:d.id,projectId:rule.projectId}) as Task) ?? []) : null;
    if (task?.parentTaskId || task?.taskKind === 'review_request') { grant.check='conflict';grant.reason='以前の設定を保持しています。自動確認は親タスクで扱います。';saveState(tx,state);return; }
    const repeat = canAccess && task ? await prepareRecurrence(tx, taskDoc.ref, { ...task, id:rule.taskId, projectId:rule.projectId } as Task, new Date(now)) : () => {};
    grant.checkedAt = now;
    const updateCheck = (check: AutomationGrant['check'], reason: string) => { grant.check = check; grant.reason = reason; };
    if (!canAccess || revoked) updateCheck('revoked', '権限・接続範囲が変わったため停止しています。現在の設定で任せ直してください。');
    else if (!task || task.isArchived || task.isAbandoned || (!rule.order && task.assigneeIds?.length !== 1)) updateCheck('conflict', '担当・タスクの状態が変わったため停止しています。');
    else if (taskVersion(task) !== grant.expectedTaskVersion) updateCheck('conflict', '後からの編集を保持しています。現在の内容で任せ直すまで自動更新しません。');
    else if (unavailable || incomplete) updateCheck(unavailable ? 'unavailable' : 'partial', '最新の全対象を取得できません。以前の確定状態は保持しています。');
    else if (hasAmbiguousEvidenceRevision(grant, sources)) updateCheck('conflict', '反映済みの根拠が訂正され、現在の成立を確認できません。確定していた状態を保持して、自動更新を停止しています。');
    else if (grant.records.length >= 80) updateCheck('conflict', '保存履歴が上限に達したため、自動更新を停止しています。');
    else {
      const previousStage = grant.stage, previousEta = task.automation?.expectedDate ?? null;
      let lastOrderEvidence: TaskEvidence | null = null;
      let result = selectEvidence(grant, sources, now);
      if (!result) updateCheck(grant.stage ? 'confirmed' : 'unconfirmed', grant.stage ? '既に反映した根拠から追加の確定変更はありません。' : '対象・本人・期間・完了条件に一致する明確な根拠は未確認です。');
      while (result && grant.records.length < 80) {
        const before:AutomationWorkSnapshot = { ...(rule.order ? {automation:task.automation ?? null} : {}), isCompleted: task.isCompleted === true, completedAt: automationIso(task.completedAt), dueDate: automationIso(task.dueDate),
          isDueDateFixed: task.isDueDateFixed === true, durationDays: typeof task.durationDays === 'number' ? task.durationDays : null };
        const after:AutomationWorkSnapshot = { ...before };
        const schedule = rule.allowExpectedDate && result.expectedDate ? expectedDateSchedule({
          startDate: task.startDate == null ? null : automationIso(task.startDate) ?? 'invalid', dueDate: before.dueDate,
          durationDays: before.durationDays ?? null, isDueDateFixed: before.isDueDateFixed ?? false,
        }, result.expectedDate) : null;
        if (schedule && !schedule.ok) { updateCheck('conflict', schedule.reason); break; }
        if (schedule?.ok) { after.dueDate = schedule.dueDate; after.isDueDateFixed = schedule.isDueDateFixed; after.durationDays = schedule.durationDays; }
        const cancelled = result.stage === 'cancelled' || result.stage === 'refunded';
        if (completesCriterion(rule.criterion, result.stage) && !before.isCompleted) { if(completionReason){updateCheck('conflict',completionReason);break;} after.isCompleted = true; after.completedAt = now; grant.ownedCompletion = true; }
        if (cancelled && grant.ownedCompletion) { after.isCompleted = false; after.completedAt = null; grant.ownedCompletion = false; }
        const patch: DocumentData = { isCompleted: after.isCompleted, completedAt: after.completedAt ? new Date(after.completedAt) : null,
          dueDate: after.dueDate ? new Date(after.dueDate) : null, updatedAt: new Date(now),
          ...(schedule?.ok ? {isDueDateFixed:after.isDueDateFixed,durationDays:after.durationDays} : {}) };
        if(rule.order)after.automation={...(task.automation??{}),ownerId:uid,stage:result.stage,check:'confirmed',checkedAt:now,evidenceAt:result.evidence.at,expectedDate:['cancelled','refunded'].includes(result.stage)?null:result.expectedDate??task.automation?.expectedDate??null};
        grant.stage = result.stage; grant.latestEvidenceAt = result.evidence.at;
        updateCheck('confirmed', `${STAGE_LABELS[result.stage]}の明確な根拠を反映しました。`);
        grant.expectedTaskVersion = taskVersion({ ...task, ...patch });
        grant.records.push({ id: randomUUID(), expectedDate: result.expectedDate, ruleVersion: evidenceRuleVersion(rule), at: now, source: result.evidence.source, sourceId: result.evidence.id, sourceVersion: result.evidence.version,
          evidenceAt: result.evidence.at, sourceUrl: result.evidence.url, stage: result.stage, before, after, afterVersion: grant.expectedTaskVersion, undone: false });
        if (rule.order && result.evidence.source === 'gmail') lastOrderEvidence = result.evidence;
        tx.update(taskDoc.ref, patch);
        task = { ...task, ...patch, ...(rule.order?{automation:after.automation}:{}) };
        activity(tx, uid, rule.projectId, rule.taskId, task, `${STAGE_LABELS[result.stage]}${result.expectedDate ? `：${result.expectedDate}` : ''}（本人の許可範囲・根拠日時 ${result.evidence.at}）`, before.isCompleted === after.isCompleted ? 'update' : after.isCompleted ? 'complete' : 'reopen');
        result = selectEvidence(grant, sources, now);
      }
      const eta = ['cancelled','refunded'].includes(grant.stage ?? '') ? null : [...grant.records].reverse().find(r=>r.expectedDate)?.expectedDate ?? previousEta;
      if (rule.order && lastOrderEvidence && (previousStage !== grant.stage || previousEta !== eta)) {
        const due = automationIso(task.dueDate);
        const late = !!(eta && due && eta > new Date(Date.parse(due)+9*3600000).toISOString().slice(0,10));
        const recordId = automationHash([uid,key,lastOrderEvidence.id,lastOrderEvidence.version]);
        const message = `${rule.order.merchant}の${rule.order.item}：${STAGE_LABELS[grant.stage!]}${eta ? `。到着予定は${eta}です` : ''}${late ? '。仕事の期限より後になるため、確認してください' : ''}。`;
        tx.set(db.doc(`notifications/order-${recordId}`),{userId:uid,type:'task_updated',title:late?'到着予定が仕事の期限を過ぎます':`${rule.order.item}の状況が変わりました`,message,projectId:rule.projectId,taskId:rule.taskId,taskName:task.title,isRead:false,createdAt:new Date(now),data:{automation:true,requiresResponse:late,sourceUrl:lastOrderEvidence.url}});
      }
    }
    if (task?.isCompleted && canAccess) repeat();
    if (task && canAccess) tx.update(taskDoc.ref, { automation: { ...(task.automation ?? {}), ownerId: uid, stage: grant.stage, check: grant.check, checkedAt: now,
      evidenceAt: grant.latestEvidenceAt ?? task.automation?.evidenceAt ?? null, expectedDate: ['cancelled','refunded'].includes(grant.stage ?? '') ? null : [...grant.records].reverse().find(r=>r.expectedDate)?.expectedDate ?? task.automation?.expectedDate ?? null } });
    saveState(tx, state);
  });
}
export async function undoAutomation(uid: string, projectId: string, taskId: string, recordId: string, revision: number) {
  await getAdminDb().runTransaction(async tx => {
    await access(tx, uid, projectId, true, false);
    const [sd, td] = await Promise.all([tx.get(stateRef(uid)), tx.get(taskRef(projectId, taskId))]);
    const state = stateData(uid, sd.data()); const grant = state.grants.find(g => g.rule.projectId === projectId && g.rule.taskId === taskId);
    const record = grant?.records.find(r => r.id === recordId); const task = td.data();
    if (state.revision !== revision || !grant || !record || !task) throw new AutomationError('最新の履歴を読み直してください。', 409);
    if (record.undone) return;
    if (grant.records.at(-1)?.id !== recordId || taskVersion(task) !== record.afterVersion) throw new AutomationError('後からの変更があるため戻せません。現在のタスクを確認してください。', 409);
    const before = record.before;
    const notice=grant.rule.order ? await tx.get(getAdminDb().doc(`notifications/order-${automationHash([uid,`${projectId}/${taskId}`,record.sourceId,record.sourceVersion])}`)) : null;
    if(notice?.exists)tx.update(notice.ref,{isRead:true,title:'自動反映を取り消しました',message:'元の報告を残して、自動更新を停止しました。',data:{...notice.data()?.data,requiresResponse:false,retracted:true}});
    tx.update(td.ref, { isCompleted: before.isCompleted, completedAt: before.completedAt ? new Date(before.completedAt) : null,
      dueDate: before.dueDate ? new Date(before.dueDate) : null,
      ...(typeof before.isDueDateFixed === 'boolean' ? {isDueDateFixed:before.isDueDateFixed} : {}),
      ...('durationDays' in before ? {durationDays:before.durationDays} : {}), updatedAt: new Date(), automation: { ...('automation' in before ? before.automation : task.automation), check: 'conflict' } });
    if('automation' in before){grant.stage=before.automation?.stage??null;grant.latestEvidenceAt=before.automation?.evidenceAt??null;}
    record.undone = true; grant.rule.enabled = false; grant.check = 'conflict'; grant.reason = '反映を取り消し、自動更新を停止しました。';
    saveState(tx, state); activity(tx, uid, projectId, taskId, task, '本人が自動反映を取り消し、自動更新を停止');
  });
  await processParentPolicies(uid);
  return readAutomation(uid);
}
export async function saveCompletionPolicy(uid: string, projectId: string, taskId: string, input: Pick<AllChildrenCompletionPolicy, 'condition' | 'required'> | null, expectedUpdatedAt: string) {
  if (typeof expectedUpdatedAt !== 'string' || !automationIso(expectedUpdatedAt)) throw new AutomationError('親タスクの更新日時を取得し直してください。', 409);
  if (!id(projectId) || !id(taskId) || input && (typeof input.condition !== 'string' || !input.condition.trim() || input.condition.length > 500 || !Array.isArray(input.required) || input.required.length < 1 || input.required.length > 40 ||
    input.required.some(r => !id(r.taskId) || !id(r.assigneeId) || r.taskId === taskId) || new Set(input.required.map(r => r.taskId)).size !== input.required.length || new Set(input.required.map(r => r.assigneeId)).size !== input.required.length)) throw new AutomationError('必要な担当ごとのサブタスクと、全員分の完了条件を指定してください。');
  await getAdminDb().runTransaction(async tx => {
    await access(tx, uid, projectId, true);
    const [td, sd, children] = await Promise.all([tx.get(taskRef(projectId, taskId)), tx.get(stateRef(uid)), tx.get(getAdminDb().collection(`projects/${projectId}/tasks`).where('parentTaskId', '==', taskId).limit(101))]);
    const task = td.data(); if (!task || task.isArchived || task.isAbandoned) throw new AutomationError('対象の親タスクを確認してください。');
    if (input && (task.parentTaskId || task.taskKind === 'review_request')) throw new AutomationError('自動確認は親タスクで設定してください。');
    if (automationIso(task.updatedAt) !== automationIso(expectedUpdatedAt)) throw new AutomationError('親タスクが更新されています。入力を保持したまま、現在の条件・担当を確認してください。', 409);
    if (input && (children.size > 100 || input.required.some(r => { const child = children.docs.find(c => c.id === r.taskId)?.data(); return !child || child.isArchived || child.isAbandoned || child.assigneeIds?.length !== 1 || child.assigneeIds[0] !== r.assigneeId; }))) throw new AutomationError('必要な各担当の個別タスクが一致しません。');
    const state = stateData(uid, sd.data());
    // Keep successive policy edits distinct even within the same clock millisecond.
    const now = new Date(Math.max(Date.now(), Date.parse(automationIso(task.updatedAt)!) + 1)).toISOString();
    state.reminders = state.reminders.filter(r => r.projectId !== projectId || r.taskId !== taskId);
    if (input) state.reminders.push({ projectId, taskId, dueDate: automationIso(task.dueDate) ?? '', snoozedUntil: null, notifiedSignature: null, sequence: 0 });
    tx.delete(getAdminDb().doc(`notifications/task-automation-${automationHash([uid, projectId, taskId]).slice(0, 40)}`));
    tx.update(td.ref, { completionPolicy: input ? { ...input, kind: 'all_required_children', grantedBy: uid, grantedAt: now } : null, updatedAt: new Date(now) });
    saveState(tx, state); activity(tx, uid, projectId, taskId, task, input ? `全員条件を設定：${input.condition}` : '全員条件の自動判定を解除');
  });
  await processParentPolicies(uid);
  return readAutomation(uid);
}
/** Parent ownership is persisted on the existing task; no arbitrary parent is completed. */
async function processParentPolicies(uid: string, now = new Date().toISOString()) {
  const outer = stateData(uid, (await stateRef(uid).get()).data());
  for (const reminder of outer.reminders) await getAdminDb().runTransaction(async tx => {
    const db = getAdminDb(); const state = stateData(uid, (await tx.get(stateRef(uid))).data());
    const current = state.reminders.find(r => r.projectId === reminder.projectId && r.taskId === reminder.taskId); if (!current) return;
    const notification = db.doc(`notifications/task-automation-${automationHash([uid, reminder.projectId, reminder.taskId]).slice(0, 40)}`);
    try { await access(tx, uid, reminder.projectId, true); } catch (e) {
      if (e instanceof AutomationError && e.status === 403) {
        // Revoke only this user's stale product notification, never the shared task state.
        tx.delete(notification); current.notifiedSignature = null; saveState(tx, state); return;
      }
      throw e;
    }
    const [td, children] = await Promise.all([tx.get(taskRef(reminder.projectId, reminder.taskId)), tx.get(db.collection(`projects/${reminder.projectId}/tasks`).limit(501))]);
    const task = td.data(); const policy = task?.completionPolicy as AllChildrenCompletionPolicy | undefined;
    if (!task || task.isArchived || task.isAbandoned || !policy || policy.grantedBy !== uid) {
      state.reminders = state.reminders.filter(r => r !== current); tx.delete(notification); saveState(tx, state); return;
    }
    if (task.parentTaskId || task.taskKind === 'review_request' || children.size > 500) return;
    const tasks = children.docs.map(d => ({ ...d.data(), id: d.id, projectId: reminder.projectId } as Task));
    const result = requiredChildrenState({ id:reminder.taskId, projectId:reminder.projectId, completionPolicy: policy }, tasks); if (!result) return;
    const newPolicy = { ...policy }; const patch: DocumentData = {};
    const owned = policy.completedByAutomation && policy.completedVersion === automationHash(Object.fromEntries(Object.entries(task).filter(([key]) => !['completionPolicy', 'automation'].includes(key))));
    if (result.complete && !task.isCompleted && !policy.completedByAutomation && !completionBlockReason({ ...task, id: reminder.taskId, projectId: reminder.projectId } as Task, tasks)) { patch.isCompleted = true; patch.completedAt = new Date(now); newPolicy.completedByAutomation = true; }
    else if (!result.complete && task.isCompleted && owned) { patch.isCompleted = false; patch.completedAt = null; newPolicy.completedByAutomation = false; delete newPolicy.completedVersion; }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date(now);
      if (newPolicy.completedByAutomation) newPolicy.completedVersion = automationHash(Object.fromEntries(Object.entries({ ...task, ...patch }).filter(([key]) => !['completionPolicy', 'automation'].includes(key))));
      const repeat = patch.isCompleted === true ? await prepareRecurrence(tx, td.ref, { ...task, ...patch, id:reminder.taskId, projectId:reminder.projectId } as Task, new Date(now)) : () => {};
      repeat();
      patch.completionPolicy = newPolicy; tx.update(td.ref, patch);
      activity(tx, uid, reminder.projectId, reminder.taskId, task, patch.isCompleted ? `全員条件が成立：${policy.condition}` : `全員条件が成立しなくなりました：${policy.condition}`, patch.isCompleted ? 'complete' : 'reopen');
    }
    const dueDate = automationIso(task.dueDate) ?? '';
    if (current.dueDate !== dueDate) { current.dueDate = dueDate; current.snoozedUntil = null; current.notifiedSignature = null; tx.delete(notification); }
    if (result.complete || (patch.isCompleted ?? task.isCompleted)) { current.notifiedSignature = null; tx.delete(notification); }
    else if (reminderDue(dueDate, now, current.snoozedUntil)) {
      const pending = result.rows.filter(r => !r.complete);
      const signature = automationHash([dueDate, pending.map(r => [r.taskId, r.assigneeId, r.task?.automation?.check ?? 'unconfirmed']), current.sequence]);
      if (signature !== current.notifiedSignature) {
        tx.set(notification, { userId: uid, type: 'due_reminder', title: '全員分の完了をまだ確認できません',
          message: `「${task.title}」で${pending.length}人分の完了が未確認です。担当ごとの確認状況を開けます。`, projectId: reminder.projectId, taskId: reminder.taskId, taskName: task.title,
          isRead: false, createdAt: new Date(now), data: { automation: true, dueDate, pending: pending.map(r => ({ taskId: r.taskId, assigneeId: r.assigneeId, check: r.task?.automation?.check ?? 'unconfirmed' })) } });
        current.notifiedSignature = signature;
      }
    }
    saveState(tx, state);
  });
}
export async function changeAutomationReminder(uid: string, projectId: string, taskId: string, until: string | null) {
  if (!id(projectId) || !id(taskId) || until && (!automationIso(until) || Date.parse(until) <= Date.now() || Date.parse(until) > Date.now() + 30 * 86400000)) throw new AutomationError('再通知の時刻を確認してください。');
  await getAdminDb().runTransaction(async tx => {
    await access(tx, uid, projectId, true, false);
    const state = stateData(uid, (await tx.get(stateRef(uid))).data()); const r = state.reminders.find(r => r.projectId === projectId && r.taskId === taskId);
    if (!r) throw new AutomationError('現在の通知対象を確認してください。');
    r.snoozedUntil = until; r.sequence++; r.notifiedSignature = null; saveState(tx, state);
    tx.delete(getAdminDb().doc(`notifications/task-automation-${automationHash([uid, projectId, taskId]).slice(0, 40)}`));
  });
  if (!until) await processParentPolicies(uid);
  return readAutomation(uid);
}
export async function runTaskAutomation(uid: string, refresh = true) {
  const state = stateData(uid, (await stateRef(uid).get()).data());
  if (refresh && state.grants.some(g => g.rule.enabled && g.rule.sources.includes('gmail'))) await refreshWorkspace(uid, 15, false);
  const errors: string[] = [];
  for (const grant of state.grants.filter(g => g.rule.enabled)) {
    try { await processGrant(uid, `${grant.rule.projectId}/${grant.rule.taskId}`, new Date().toISOString()); }
    catch { errors.push('一部の自動更新を確認できませんでした。確定状態は保持しています。'); }
  }
  // Find parents authorized by other users, but only execute their own explicit, current policy.
  const owners = new Set([uid]);
  for (const grant of state.grants.filter(g => g.rule.enabled)) {
    const child = (await taskRef(grant.rule.projectId, grant.rule.taskId).get()).data();
    if (id(child?.parentTaskId)) { const parent = (await taskRef(grant.rule.projectId, child.parentTaskId).get()).data(); if (id(parent?.completionPolicy?.grantedBy)) owners.add(parent.completionPolicy.grantedBy); }
  }
  for (const owner of owners) await processParentPolicies(owner);
  return { ...await readAutomation(uid), errors };
}
export async function runAutomationBatch(cursor?: string) {
  const db = getAdminDb();
  let query = db.collectionGroup('secretary').where('automationEnabled', '==', true).orderBy(FieldPath.documentId()).limit(20);
  if (cursor) {
    if (!/^users\/[^/]{1,200}\/secretary\/task-automation$/.test(cursor)) throw new AutomationError('実行カーソルが不正です。');
    query = query.startAfter(db.doc(cursor));
  }
  const docs = await query.get(); let failed = 0;
  for (const doc of docs.docs) {
    if (!/^users\/[^/]+\/secretary\/task-automation$/.test(doc.ref.path)) continue;
    try { const result = await runTaskAutomation(doc.ref.parent.parent!.id); if (result.errors.length) failed++; } catch { failed++; }
  }
  return { checked: docs.size, failed, nextCursor: docs.size === 20 ? docs.docs.at(-1)!.ref.path : null };
}

/** Purchase intake reuses the task comment, automation grant and activity receipt. */
export async function recordPurchaseReport(uid: string, raw: unknown) {
  const {parsePurchaseSubmission,purchaseReportText}=await import('./purchase/submission');
  const {mergePurchaseProgress}=await import('./purchase/types');
  let input: ReturnType<typeof parsePurchaseSubmission>;
  try { input=parsePurchaseSubmission(raw); } catch(error) { throw new AutomationError(error instanceof Error ? error.message : '報告内容を確認してください。',422); }
  const db=getAdminDb();
  return db.runTransaction(async tx=>{
    const {user}=await access(tx,uid,input.projectId,true,input.track);
    const ref=taskRef(input.projectId,input.taskId);
    const receiptRef=db.doc(`projects/${input.projectId}/activityLogs/purchase-${input.id}`);
    const commentReceiptRef=db.doc(`projects/${input.projectId}/activityLogs/comment-${input.id}`);
    const [receipt,commentReceipt,td]=await Promise.all([tx.get(receiptRef),tx.get(commentReceiptRef),tx.get(ref)]);
    if(receipt.exists){if(receipt.data()?.userId!==uid||receipt.data()?.targetId!==input.taskId)throw new AutomationError('受付先が一致しません。',409);return {commentId:input.id,taskId:input.taskId,tracked:receipt.data()?.tracked===true,backgroundConfigured:process.env.TASK_AUTOMATION_SCHEDULED==='true',alreadyApplied:true};}
    if(commentReceipt.exists){if(commentReceipt.data()?.userId!==uid||commentReceipt.data()?.sourceTaskId!==input.taskId)throw new AutomationError('受付先が一致しません。',409);return {commentId:input.id,taskId:input.taskId,tracked:false,alreadyApplied:true};}
    if(!input.track){
      const {submitTaskCommentInTransaction}=await import('./commentSubmissionRepository');
      const {OrganizationError}=await import('./organizationEngine');
      try {
        const result=await submitTaskCommentInTransaction(tx,uid,{id:input.id,projectId:input.projectId,taskId:input.taskId,authorId:uid,authorName:user?.displayName||'本人',content:purchaseReportText(input.report),purpose:'memo',notifyIds:[],review:null,attachments:input.attachment?[input.attachment]:[]});
        return {commentId:result.commentId,taskId:input.taskId,tracked:false,alreadyApplied:result.alreadySubmitted};
      }catch(error){if(error instanceof OrganizationError)throw new AutomationError(error.message,error.status);throw error;}
    }
    const [sd,connection,comment]=await Promise.all([tx.get(stateRef(uid)),isGoogleConfigured()?tx.get(connectionRef(uid)):Promise.resolve(null),tx.get(ref.collection('comments').doc(input.id))]);
    if(comment.exists)throw new AutomationError('同じ投稿IDが既にあります。元の報告を確認してください。',409);
    const task=td.data(), state=stateData(uid,sd.data()), c=connection?.data() as Connection|undefined;
    if(!task||task.parentTaskId||task.taskKind==='review_request'||task.isArchived||task.isAbandoned||task.isCompleted)throw new AutomationError('未完了の親タスクを選んでください。',409);
    if(input.track&&!c?.enabled.includes('gmail'))throw new AutomationError('Gmailが未接続です。「報告だけ記録」で先に残せます。',409);
    const prior=state.grants.find(g=>g.rule.projectId===input.projectId&&g.rule.taskId===input.taskId);
    if(prior && (!prior.rule.order || prior.rule.order.orderNumber!==input.report.orderNumber || prior.rule.order.merchant!==input.report.merchant))throw new AutomationError('この仕事には別の追跡設定があります。既存の自動確認を確認してください。',409);
    if(prior&&prior.records.length>=80)throw new AutomationError('追跡の履歴が上限です。記録を確認してください。',409);
    if(!prior&&state.grants.length>=40)throw new AutomationError('追跡の対象が上限です。既存の自動確認を確認してください。',409);
    if(task.automation?.ownerId&&task.automation.ownerId!==uid)throw new AutomationError('別の担当者がこの仕事を追跡しています。',409);
    const now=new Date(),at=now.toISOString(),report={...input.report,...mergePurchaseProgress(prior?.stage??null,task.automation?.expectedDate??null,input.report)};
    const order={merchant:report.merchant,orderNumber:report.orderNumber,item:report.item,orderedOn:report.orderedOn};
    const rule:TaskEvidenceRule={projectId:input.projectId,taskId:input.taskId,enabled:input.track,order,subject:report.item,period:report.orderedOn??'',person:uid,sender:'',criterion:'tracking',allowExpectedDate:false,sources:['gmail']};
    // A new grant permits status tracking only. Task completion and its deadline are unchanged.
    const grant:AutomationGrant={rule,uid,grantedAt:at,notBefore:report.orderedOn?new Date(`${report.orderedOn}T00:00:00+09:00`).toISOString():automationIso(task.createdAt)??at,connectionEpoch:c?.epoch??null,expectedTaskVersion:taskVersion(task),check:input.track?'unconfirmed':'revoked',checkedAt:null,reason:input.track?'この注文の状況を追跡します。':'購入報告を記録しました。',latestEvidenceAt:null,stage:report.stage,ownedCompletion:false,records:[]};
    const summary: import('./automationTypes').TaskAutomationSummary = {ownerId:uid,merchant:report.merchant,sourceCommentId:input.id,stage:report.stage,check:'confirmed',checkedAt:at,evidenceAt:at,expectedDate:['cancelled','refunded'].includes(report.stage??'')?null:report.expectedDate??task.automation?.expectedDate??null};
    if(prior){
      grant.records=prior.records;grant.latestEvidenceAt=at;
      grant.notBefore=prior.notBefore;
      const before={automation:task.automation??null,isCompleted:!!task.isCompleted,completedAt:automationIso(task.completedAt),dueDate:automationIso(task.dueDate)};
      grant.records.push({id:input.id,at,ruleVersion:evidenceRuleVersion(rule),source:'comment',sourceId:input.id,sourceVersion:at,evidenceAt:at,sourceUrl:`/projects/${input.projectId}/board?task=${input.taskId}&comment=${input.id}`,stage:report.stage!,expectedDate:report.expectedDate,before,after:{...before,automation:summary},afterVersion:taskVersion(task),undone:false});
      state.grants=state.grants.map(g=>g===prior?grant:g);
    }else state.grants.push(grant);
    tx.set(ref.collection('comments').doc(input.id),{taskId:input.taskId,content:purchaseReportText(input.report),authorId:uid,authorLabel:user?.displayName??'本人',authorIcon:null,purpose:'memo',mentions:[],attachments:input.attachment?[input.attachment]:[],createdAt:now,updatedAt:now});
    tx.update(ref,{automation:summary});
    tx.set(receiptRef,{projectId:input.projectId,targetType:'task',targetId:input.taskId,targetName:task.title,userId:uid,userName:user?.displayName??'本人',action:'update',tracked:input.track,changes:[{field:'purchaseReport',newValue:'購入報告を記録'}],createdAt:now});
    saveState(tx,state);
    return {commentId:input.id,taskId:input.taskId,tracked:input.track,backgroundConfigured:process.env.TASK_AUTOMATION_SCHEDULED==='true',alreadyApplied:false};
  });
}
