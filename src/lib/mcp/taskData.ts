import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, type DocumentData, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { organizationAccess } from '@/lib/task/organizationRepository';
import { applyWorkflowInTransaction } from '@/lib/task/workflowRepository';
import { submitTaskCommentInTransaction } from '@/lib/task/commentSubmissionRepository';
import { saveRecurrenceInTransaction } from '@/lib/task/recurrenceRepository';
import { saveCompletionPolicyInTransaction, processParentPolicies } from '@/lib/task/automationRepository';
import { setReactionInTransaction } from '@/lib/comments/repository';
import { expandTaskReviews } from '@/lib/task/reviews';
import { stampTaskWrite } from '@/lib/task/changeStamp.server';
import { validCivilDate } from '@/lib/task/recurrence';
import { assertTaskDates } from '@/lib/task/dateValidation';
import { hasCircularDependency, recalculateDates } from '@/lib/utils/task';
import { mutateChecklistItems, validateChecklistDeadline, type ChecklistItemMutation } from '@/lib/utils/checklist-item';
import { moveChecklistItem } from '@/lib/utils/checklist';
import { getTaskSubtasks, moveTaskSubtask } from '@/lib/task/subtasks';
import { taskEditChanges } from '@/lib/task/history/recentChanges';
import { object, assertId, controlledFields, models, OPERATIONS, READ_RESOURCES, TaskDataError, validateSchema, type JsonSchema } from './taskContract';
import { uploadTaskFile, readTaskFile } from './taskFiles';
import { readCoordination, mutateCoordination, assertCoordinationWorkflow } from './coordinator';
import { trackMcpWrites } from './coordinatorProvenance';
import { assertCoordinationDelegation } from './coordinatorTransport';
import type { ApiKeyPermission } from '@/types/apiKey';
import type { Task, ChecklistItem, CommentAttachment } from '@/types';
import type { WorkflowInput } from '@/lib/task/workflow';
import type { ReviewRequestInput } from '@/lib/task/commentSubmission';
import type { RecurrenceSettings } from '@/lib/task/recurrence';
import type { AllChildrenCompletionPolicy } from '@/lib/task/automationTypes';

export interface TaskPrincipal {
  userId: string; grantId: string; expiresAt: number; authorizationExpiresAt: number;
  projectIds: string[]; taskScopes: string[]; permissions: ApiKeyPermission[]; coordinationDelegationId?: string; coordinationSourceAccessTokenExpiresAt?: number;
}
export interface TaskOperation {
  id: string; resource: keyof typeof OPERATIONS; action: string; task_id?: string; resource_id?: string;
  expected_version?: string; expected_task_version?: string; unset?: string[]; data: Record<string, unknown>;
}
function fail(code: string, message: string, status = 422): never { throw new TaskDataError(code, message, status); }
export function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return jsonValue(value.toDate());
  if (Array.isArray(value)) return value.map(jsonValue);
  return object(value) ? Object.fromEntries(Object.keys(value).filter(k => k !== 'apiChangedAt').sort().map(k => [k, jsonValue(value[k])])) : value;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(jsonValue(value))).digest('hex');
export function childVersion(data: DocumentData): string { return fingerprint(data); }
const iso = (value: unknown): string => typeof jsonValue(value) === 'string' ? jsonValue(value) as string : '';
const taskObject = (id: string, projectId: string, data: DocumentData) => ({ ...data, id, projectId, createdAt: asDate(data.createdAt), updatedAt: asDate(data.updatedAt), completedAt: asDate(data.completedAt), dueDate: asDate(data.dueDate), startDate: asDate(data.startDate) } as Task);
const asDate = (v: unknown): Date | null => v == null ? null : new Date(iso(v));
const outputItem = (id: string, data: DocumentData, task = false) => ({ ...jsonValue(data) as Record<string, unknown>, id, _version: task ? iso(data.updatedAt) : childVersion(data) });
function expectVersion(data: DocumentData, expected: unknown, task = true) {
  if (typeof expected !== 'string' || !expected || expected !== (task ? iso(data.updatedAt) : childVersion(data))) fail('VERSION_CONFLICT', '情報が更新されています。読み直してから変更してください。', 409);
}
export function requireTaskScope(auth: TaskPrincipal, write: boolean) {
  if (!auth.taskScopes?.includes('tasks:read') || write && !auth.taskScopes.includes('tasks:write')) fail('INSUFFICIENT_SCOPE', 'タスクの読み書きには追加のOAuth承認が必要です。', 403);
  if (![auth.expiresAt, auth.authorizationExpiresAt].every(v => Number.isFinite(v) && v > Date.now())) fail('AUTHORIZATION_EXPIRED', '接続の有効期限を確認してください。', 401);
}
async function access(auth: TaskPrincipal, projectId: string, write: boolean) {
  requireTaskScope(auth, write); assertId(projectId);
  await assertCoordinationDelegation(auth, projectId);
  if (!auth.projectIds.includes(projectId)) fail('FORBIDDEN', '許可されたプロジェクトを指定してください。', 403);
  try { await getProjectAccess(auth.userId, projectId, auth.permissions, auth.projectIds, write ? 'tasks:write' : 'tasks:read'); }
  catch { fail('FORBIDDEN', '現在のプロジェクト権限を確認してください。', 403); }
  const project = await getAdminDb().doc(`projects/${projectId}`).get();
  const settings = (await getAdminDb().doc(`users/${auth.userId}/settings/aiSettings`).get()).data()?.allowedProjectIds;
  if (settings != null && (!Array.isArray(settings) || !settings.includes(projectId))) fail('FORBIDDEN', '現在のAI利用範囲を確認してください。', 403);
  if (project.data()?.isArchived) fail('FORBIDDEN', 'アーカイブされたプロジェクトにはアクセスできません。', 403);
}
async function transactionAccess(tx: Transaction, auth: TaskPrincipal, projectId: string) {
  requireTaskScope(auth, true);
  await assertCoordinationDelegation(auth, projectId, tx);
  const binding = await tx.get(getAdminDb().doc(`mcpOAuthGrants/${fingerprintString(auth.grantId)}`));
  const value = binding.data(), expiry = value?.expiresAt;
  const milliseconds = expiry instanceof Date ? expiry.getTime() : expiry?.toMillis?.();
  if (value?.userId !== auth.userId || value?.projectId !== projectId || value?.mode !== 'production' ||
      !value?.taskScopes?.includes('tasks:write') || !value.taskScopes.includes('tasks:read') || !Number.isFinite(milliseconds) || milliseconds <= Date.now()) fail('FORBIDDEN', '現在のOAuth許可を確認してください。', 403);
  return organizationAccess(tx, auth.userId, projectId, true);
}
const fingerprintString = (v: string) => createHash('sha256').update(v).digest('hex');
function checked<T>(fn: () => T): T {
  try { return fn(); } catch (error) { if (error instanceof TaskDataError) throw error; return fail('DOMAIN_REJECTED', error instanceof Error ? error.message : '操作を確認してください。'); }
}
function selectedSchema(name: string, keys: string[], required: string[] = []): JsonSchema {
  return { type: 'object', properties: Object.fromEntries(keys.map(key => [key, models[name].properties![key]])), required, additionalProperties: false };
}
function editableSchema(model: string, managed: string[], required: string[] = []): JsonSchema {
  return selectedSchema(model, Object.keys(models[model].properties!).filter(key => !managed.includes(key)), required);
}
function validateEditable(data: Record<string, unknown>, model: string, forbidden: string[], partial = true) {
  validateSchema(data, models[model], 'data', partial);
  for (const key of Object.keys(data)) if (forbidden.includes(key)) fail('MANAGED_FIELD', `${key} は専用操作またはサーバーが記録する項目です。`);
}
function validateAttachments(value: unknown): asserts value is CommentAttachment[] {
  if (!Array.isArray(value) || value.length > 10) fail('INVALID_INPUT', '添付は10件までです。');
  for (const attachment of value) { validateSchema(attachment, models.CommentAttachment); assertId(attachment.id); assertAttachment(attachment); }
}
function assertAttachment(v: Record<string, unknown>) {
  let url; try { url = new URL(String(v.url)); } catch { fail('INVALID_INPUT', '添付のURLを確認してください。'); }
  if (url!.protocol !== 'https:' || url!.username || url!.password || !v.name || typeof v.name !== 'string' || v.name.length > 500 ||
      typeof v.size !== 'number' || !Number.isSafeInteger(v.size) || v.size < 0 || v.size > 10 * 1024 * 1024 || typeof v.type !== 'string' || v.type.length > 200) fail('INVALID_INPUT', '添付の名前・HTTPS URL・サイズを確認してください。');
}
function validateChecklist(items: unknown): asserts items is ChecklistItem[] {
  if (!Array.isArray(items) || items.length > 1000) fail('INVALID_INPUT', 'チェック項目を確認してください。');
  const ids = new Set();
  for (const item of items) {
    validateSchema(item, models.ChecklistItem); assertId(item.id);
    if (!item.text.trim() || item.text.length > 2000 || ids.has(item.id)) fail('INVALID_INPUT', 'チェック項目名・IDを確認してください。');
    ids.add(item.id); checked(() => validateChecklistDeadline({ dueDate: item.dueDate ?? null, dueTime: item.dueTime ?? null, deadlinePolicy: item.deadlinePolicy ?? null }));
  }
}
async function graph(tx: Transaction, projectRef: DocumentReference, projectId: string) {
  const rows = await tx.get(projectRef.collection('tasks').limit(501));
  if (rows.size > 500) fail('GRAPH_LIMIT', '関連するタスクが500件を超えています。この操作は反映していません。', 409);
  return rows.docs.map(row => taskObject(row.id, projectId, row.data()));
}
async function validateTask(tx: Transaction, projectRef: DocumentReference, task: Task, memberIds: string[], patch: Record<string, unknown>, creating: boolean) {
  if (!task.title.trim() || task.title.length > 500 || task.description.length > 20000 || task.durationDays !== null && (!Number.isInteger(task.durationDays) || task.durationDays < 1 || task.durationDays > 36500)) fail('INVALID_INPUT', '名前・説明・必要日数を確認してください。');
  if (task.taskKind === 'review_request') fail('MANAGED_FIELD', '確認依頼はコメント投稿から作成・編集してください。');
  for (const field of ['assigneeIds', 'labelIds', 'tagIds', 'dependsOnTaskIds', 'relatedTaskIds'] as const) {
    const ids = task[field] ?? [];
    if (ids.length > 100 || new Set(ids).size !== ids.length) fail('INVALID_INPUT', `${field} の件数・重複を確認してください。`);
    ids.forEach(assertId);
  }
  if (task.assigneeIds.some(id => !memberIds.includes(id)) || task.primaryAssigneeId && !task.assigneeIds.includes(task.primaryAssigneeId)) fail('INVALID_INPUT', '現在のメンバーから担当者・主担当を選んでください。');
  const list = await tx.get(projectRef.collection('lists').doc(task.listId));
  if (!list.exists) fail('NOT_FOUND', 'リストが見つかりません。', 404);
  if ((creating || Object.hasOwn(patch, 'listId')) && list.data()?.autoCompleteOnEnter && !task.isCompleted) fail('WORKFLOW_REQUIRED', '先にworkflow completeで完了してから、このリストへ移動してください。');
  if (task.milestoneId && !(await tx.get(projectRef.collection('milestones').doc(task.milestoneId))).exists) fail('NOT_FOUND', '節目が見つかりません。', 404);
  for (const [field, collection] of [['labelIds', 'labels'], ['tagIds', 'tags']] as const) if (Object.hasOwn(patch, field)) {
    for (const id of task[field]) if (!(await tx.get(projectRef.collection(collection).doc(id))).exists) fail('NOT_FOUND', `${field} の参照先が見つかりません。`, 404);
  }
  if (Object.hasOwn(patch, 'dependsOnTaskIds') || Object.hasOwn(patch, 'relatedTaskIds')) {
    const tasks = await graph(tx, projectRef, task.projectId);
    for (const id of [...(task.dependsOnTaskIds ?? []), ...(task.relatedTaskIds ?? [])]) {
      if (id === task.id || !tasks.some(t => t.id === id && !t.isArchived)) fail('INVALID_RELATION', '関連・前提タスクは同じプロジェクトの有効なタスクを選んでください。');
    }
    for (const id of task.dependsOnTaskIds) if (hasCircularDependency(task.id, id, tasks)) fail('INVALID_RELATION', 'タスクの前提関係が循環します。');
  }
  if (task.workState && (!task.workState.reason.trim() || task.workState.reason.length > 1000 || task.workState.resumeCondition.length > 1000 || task.workState.reviewAt !== null && !validCivilDate(task.workState.reviewAt))) fail('INVALID_INPUT', '待ち・保留の理由と再確認日を確認してください。');
  checked(() => assertTaskDates(task));
}

function cursorFor(scope: unknown, id: string) { return Buffer.from(JSON.stringify({ scope: fingerprint(scope), id })).toString('base64url'); }
async function page(query: Query, scope: unknown, cursor: unknown, limit: number, isTask = false) {
  let after;
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || cursor.length > 2000) fail('INVALID_CURSOR', 'ページ指定を確認してください。');
    try { const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (decoded.scope !== fingerprint(scope)) throw new Error(); assertId(decoded.id); after = decoded.id; }
    catch { fail('INVALID_CURSOR', '別の対象のページ指定は使用できません。'); }
  }
  let ordered = query.orderBy(FieldPath.documentId());
  if (after) ordered = ordered.startAfter(after);
  const rows = (await ordered.limit(limit + 1).get()).docs;
  const items = []; let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const item = outputItem(row.id, row.data(), isTask), size = Buffer.byteLength(JSON.stringify(item));
    if (size > 800000) fail('RESOURCE_TOO_LARGE', '1件の情報が取得上限を超えています。データを省略せず停止しました。', 413);
    if (bytes + size > 800000) break;
    items.push(item); bytes += size;
  }
  const more = rows.length > items.length;
  return { items, next_cursor: more ? cursorFor(scope, items.at(-1)!.id) : null };
}
export async function readTaskData(auth: TaskPrincipal, args: Record<string, unknown>) {
  const projectId = args.project_id === undefined ? auth.projectIds[0] : args.project_id;
  assertId(projectId); await access(auth, projectId, false);
  if (Object.keys(args).some(k => !['project_id', 'resource', 'task_id', 'resource_id', 'comment_id', 'cursor', 'limit', 'offset', 'length'].includes(k)) || !READ_RESOURCES.includes(String(args.resource))) fail('INVALID_INPUT', '読み取り対象を確認してください。');
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) fail('INVALID_INPUT', '取得件数は1〜50件です。');
  const projectRef = getAdminDb().doc(`projects/${projectId}`);
  const scopedPage = (query: Query, resource: string, task = false) => page(query, [projectId, resource, args.task_id ?? null, args.comment_id ?? null], args.cursor, Number(limit), task);
  if (args.resource === 'context') {
    if (args.cursor !== undefined) fail('INVALID_INPUT', 'contextにはページ指定を使用できません。');
    const project = (await projectRef.get()).data()!;
    const members = project.memberIds as string[];
    if (members.length > 1000) fail('RESOURCE_TOO_LARGE', 'メンバー数の上限を超えています。');
    const profiles = await Promise.all(members.map(async userId => {
      assertId(userId); const profile = (await getAdminDb().doc(`users/${userId}`).get()).data();
      return { id: userId, displayName: profile?.displayName ?? 'メンバー' };
    }));
    const context: Record<string, unknown> = { project: outputItem(projectId, project), actor_id: auth.userId, members: profiles };
    for (const collection of ['lists', 'labels', 'tags', 'milestones']) context[collection] = await page(projectRef.collection(collection), [projectId, collection], undefined, 50);
    return context;
  }
  if (['tasks', 'lists', 'labels', 'tags', 'milestones'].includes(String(args.resource))) return scopedPage(projectRef.collection(String(args.resource)), String(args.resource), args.resource === 'tasks');
  if (String(args.resource).startsWith('coordination_')) return readCoordination(projectRef, args);
  assertId(args.task_id);
  const taskRef = projectRef.collection('tasks').doc(args.task_id), task = (await taskRef.get()).data();
  if (!task) fail('NOT_FOUND', 'タスクが見つかりません。', 404);
  if (args.resource === 'attachment_content') { assertId(args.resource_id); return readTaskFile(auth, projectId, args.task_id, args.resource_id, args); }
  if (args.resource === 'task') {
    if (args.cursor !== undefined) fail('INVALID_INPUT', '各子リソースのページ指定を使用してください。');
    const aggregate: Record<string, unknown> = { task: outputItem(args.task_id, task, true), reviews: expandTaskReviews([taskObject(args.task_id, projectId, task)]).filter(t => t.reviewRecordId).map(t => outputItem(t.id, t, true)) };
    for (const resource of ['comments', 'checklists', 'attachments']) aggregate[resource] = await scopedPage(taskRef.collection(resource), resource);
    aggregate.subtasks = await scopedPage(projectRef.collection('tasks').where('parentTaskId', '==', args.task_id), 'subtasks', true);
    return aggregate;
  }
  if (['comments', 'checklists', 'attachments'].includes(String(args.resource))) {
    if (args.resource_id !== undefined) { assertId(args.resource_id); const row = await taskRef.collection(String(args.resource)).doc(args.resource_id).get(); if (!row.exists) fail('NOT_FOUND', '対象が見つかりません。', 404); return { item: outputItem(row.id, row.data()!) }; }
    return scopedPage(taskRef.collection(String(args.resource)), String(args.resource));
  }
  if (args.resource === 'subtasks') return scopedPage(projectRef.collection('tasks').where('parentTaskId', '==', args.task_id), 'subtasks', true);
  if (args.resource === 'history') return scopedPage(projectRef.collection('activityLogs').where('targetType', '==', 'task').where('targetId', '==', args.task_id), 'history');
  if (args.resource === 'reactions') {
    assertId(args.comment_id); const ref = taskRef.collection('comments').doc(args.comment_id);
    if (!(await ref.get()).exists) fail('NOT_FOUND', 'コメントが見つかりません。', 404);
    return scopedPage(ref.collection('reactions'), 'reactions');
  }
  fail('INVALID_INPUT', '読み取り対象を確認してください。');
}

async function mutate(auth: TaskPrincipal, projectId: string, op: TaskOperation) {
  await access(auth, projectId, true);
  // Replay before uploading: retries remain safe after later archive/deletion.
  const previous = await getAdminDb().runTransaction(async tx => {
    const { ref } = await transactionAccess(tx, auth, projectId);
    const saved = (await tx.get(ref.collection('mcpTaskOperations').doc(fingerprint([auth.userId, op.id])))).data();
    if (!saved) return null;
    if (saved.requestHash !== fingerprint(op) || saved.userId !== auth.userId) fail('IDEMPOTENCY_CONFLICT', 'この操作IDには別の内容が記録されています。', 409);
    return { ...saved.result, already_applied: true };
  });
  if (previous) return previous;
  const uploaded = op.resource === 'attachment' && op.action === 'upload' ? await uploadTaskFile(auth, projectId, op) : null;
  const result = await getAdminDb().runTransaction(async transaction => {
    const tracked = trackMcpWrites(transaction), tx = tracked.tx;
    const { ref: projectRef, memberIds, defaultAssigneeId } = await transactionAccess(tx, auth, projectId);
    const receiptRef = projectRef.collection('mcpTaskOperations').doc(fingerprint([auth.userId, op.id]));
    const receipt = (await tx.get(receiptRef)).data(), signature = fingerprint(op);
    if (receipt) {
      if (receipt.requestHash !== signature || receipt.userId !== auth.userId) fail('IDEMPOTENCY_CONFLICT', 'この操作IDには別の内容が記録されています。', 409);
      return { ...receipt.result, already_applied: true };
    }
    if (op.resource === 'coordination_policy' || op.resource === 'coordination') {
      const normalized = jsonValue(await mutateCoordination(tx, auth, projectRef, memberIds, op)) as Record<string, unknown>;
      requireTaskScope(auth, true);
      tx.create(receiptRef, { userId: auth.userId, requestHash: signature, result: normalized, createdAt: new Date(), origin: 'mcp', resource: op.resource, action: op.action, taskId: op.task_id ?? null, sourceTaskId: op.task_id ?? null, resourceId: op.resource_id ?? null, trusted_writes: tracked.writes() });
      return { ...normalized, already_applied: false };
    }
    const taskId = op.resource === 'task' && op.action === 'create' ? (op.task_id ?? `mcp-${fingerprint([auth.userId, op.id]).slice(0, 40)}`) : op.task_id;
    assertId(taskId);
    const taskRef = projectRef.collection('tasks').doc(taskId), current = (await tx.get(taskRef)).data();
    if (op.resource !== 'workflow' && !(op.resource === 'task' && op.action === 'create') && !current) fail('NOT_FOUND', 'タスクが見つかりません。', 404);
    if (current?.isArchived && !(op.resource === 'workflow' && op.data.action === 'restore')) fail('ARCHIVED', 'アーカイブしたタスクは先に復元してください。', 409);
    const profile = (await tx.get(getAdminDb().doc(`users/${auth.userId}`))).data();
    const now = new Date(Math.max(Date.now(), (current ? Date.parse(iso(current.updatedAt)) || 0 : 0) + 1));
    let output: Record<string, unknown> = {};
    const childId = op.resource_id ?? `mcp-${fingerprint([auth.userId, op.id]).slice(0, 40)}`;
    assertId(childId);
    const childRef = (collection: string) => taskRef.collection(collection).doc(childId);
    const record = (message: string, changes?: unknown) => tx.set(projectRef.collection('activityLogs').doc(`mcp-${fingerprint([auth.userId, op.id])}`), {
      projectId, targetType: 'task', targetId: taskId, targetName: current?.title ?? String(op.data.title ?? ''),
      action: op.action === 'create' ? 'create' : 'update', userId: auth.userId, userName: profile?.displayName ?? 'メンバー',
      createdAt: now, changes: changes ?? [{ field: 'mcp', newValue: message }],
    });
    if (op.resource === 'workflow') {
      await assertCoordinationWorkflow(tx, projectRef, taskId, op.data.action);
      const input = { ...op.data, id: `mcp-${fingerprint([auth.userId, op.id])}`, expectedVersion: op.expected_version };
      validateSchema(input, models.WorkflowInput);
      output = await applyWorkflowInTransaction(tx, auth.userId, projectId, taskId, input as unknown as WorkflowInput);
    } else if (op.resource === 'comment' && op.action === 'submit') {
      const schema: JsonSchema = { type: 'object', properties: { content: models.Comment.properties!.content, purpose: models.Comment.properties!.purpose, notifyIds: { type: 'array', items: { type: 'string' }, maxItems: 30 }, review: { anyOf: [models.ReviewRequestInput, { type: 'null' }] }, attachments: { type: 'array', items: models.CommentAttachment, maxItems: 10 } }, required: ['content'], additionalProperties: false };
      validateSchema(op.data, schema); validateAttachments(op.data.attachments ?? []);
      if (typeof op.expected_version !== 'string') fail('VERSION_CONFLICT', '親タスクの更新日時を指定してください。', 409);
      output = await submitTaskCommentInTransaction(tx, auth.userId, {
        id: childId, projectId, taskId, authorId: auth.userId, authorName: profile?.displayName ?? 'メンバー',
        expectedTaskVersion: op.expected_version, content: op.data.content as string, notifyIds: op.data.notifyIds as string[] ?? [],
        purpose: op.data.purpose as 'memo' | 'review_request' | undefined, review: op.data.review as ReviewRequestInput ?? null, attachments: op.data.attachments as CommentAttachment[] ?? [],
      });
    } else if (op.resource === 'recurrence') {
      validateSchema(op.data, { type: 'object', properties: { settings: { anyOf: [models.RecurrenceSettings, { type: 'null' }] } }, required: ['settings'], additionalProperties: false });
      output = { recurrence: await saveRecurrenceInTransaction(tx, auth.userId, projectId, taskId, op.expected_version ?? '', op.data.settings as RecurrenceSettings | null) };
    } else if (op.resource === 'completion_policy') {
      validateSchema(op.data, { type: 'object', properties: { policy: { anyOf: [selectedSchema('AllChildrenCompletionPolicy', ['condition', 'required'], ['condition', 'required']), { type: 'null' }] } }, required: ['policy'], additionalProperties: false });
      await saveCompletionPolicyInTransaction(tx, auth.userId, projectId, taskId, op.data.policy as Pick<AllChildrenCompletionPolicy, 'condition' | 'required'> | null, op.expected_version ?? '');
      output = { saved: true };
    } else if (op.resource === 'reaction') {
      output = { reaction: await setReactionInTransaction(tx, auth.userId, { ...op.data, projectId, taskId }) };
    } else if (op.resource === 'task') {
      const creating = op.action === 'create';
      validateEditable(op.data, 'Task', Object.keys(controlledFields).filter(k => !(creating && k === 'parentTaskId')));
      if (creating && current) fail('IDEMPOTENCY_CONFLICT', '作成先のIDが既に使われています。', 409);
      if (!creating) expectVersion(current!, op.expected_version);
      const patch: DocumentData = { ...op.data };
      for (const date of ['startDate', 'dueDate']) if (typeof patch[date] === 'string') patch[date] = new Date(patch[date].length === 10 ? patch[date] + 'T00:00:00+09:00' : patch[date]);
      for (const key of op.unset ?? []) {
        if (controlledFields[key] || !models.Task.properties![key] || models.Task.required!.includes(key) || Object.hasOwn(patch, key)) fail('MANAGED_FIELD', `${key} は削除できません。`);
        patch[key] = FieldValue.delete();
      }
      if (creating && (!patch.title || !patch.listId)) fail('INVALID_INPUT', '名前とリストを指定してください。');
      const defaults: DocumentData = { projectId, title: '', description: '', order: 0, assigneeIds: defaultAssigneeId && memberIds.includes(defaultAssigneeId) ? [defaultAssigneeId] : [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: true, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, workProgress: 'not_started', createdBy: auth.userId, createdAt: now };
      let task = taskObject(taskId, projectId, { ...(creating ? defaults : current), ...patch, updatedAt: now });
      for (const key of op.unset ?? []) delete (task as unknown as Record<string, unknown>)[key];
      if (['startDate', 'dueDate', 'durationDays', 'isDueDateFixed'].some(k => Object.hasOwn(patch, k))) {
        // The UI helper handles one edited field at a time. Resolve a bulk
        // patch's mode first, then calculate from its complete merged schedule.
        const fixed = Object.hasOwn(patch, 'isDueDateFixed') ? task.isDueDateFixed
          : patch.durationDays != null ? false : patch.dueDate != null ? true : task.isDueDateFixed;
        const recalculated = recalculateDates(task, { startDate: task.startDate, isDueDateFixed: fixed });
        Object.assign(patch, recalculated); task = { ...task, ...recalculated };
      }
      await validateTask(tx, projectRef, task, memberIds, patch, creating);
      if (creating && task.parentTaskId) {
        assertId(task.parentTaskId); const parentRef = projectRef.collection('tasks').doc(task.parentTaskId), parent = (await tx.get(parentRef)).data();
        if (!parent || parent.parentTaskId || parent.isArchived || parent.isAbandoned || parent.isCompleted || parent.taskKind === 'review_request' || parent.listId !== task.listId) fail('INVALID_PARENT', '同じリストの有効な親タスクを指定してください。');
        expectVersion(parent, op.expected_task_version);
        if (task.taskKind || task.workState || task.recurrence) fail('INVALID_PARENT', 'サブタスクの設定を確認してください。');
        tx.update(parentRef, stampTaskWrite(parentRef, { subtaskOrderIds: [...new Set([...(parent.subtaskOrderIds ?? []), taskId])], updatedAt: now }));
      }
      const saved = creating ? { ...defaults, ...patch, updatedAt: now } : { ...patch, updatedAt: now };
      if (creating) tx.create(taskRef, stampTaskWrite(taskRef, saved)); else tx.update(taskRef, stampTaskWrite(taskRef, saved));
      record(creating ? 'タスクを作成' : 'タスクを編集', taskEditChanges(current ?? {}, saved));
      output = { task_id: taskId, version: now.toISOString() };
    } else if (op.resource === 'subtasks') {
      validateSchema(op.data, { type: 'object', properties: { itemId: { type: 'string' }, targetId: { type: 'string' } }, required: ['itemId', 'targetId'], additionalProperties: false });
      expectVersion(current!, op.expected_version);
      const tasks = await graph(tx, projectRef, projectId), parent = taskObject(taskId, projectId, current!);
      const visible = getTaskSubtasks(parent, tasks).map(t => t.id);
      const reordered = checked(() => moveTaskSubtask(visible, String(op.data.itemId), String(op.data.targetId)));
      const ids = [...reordered, ...(parent.subtaskOrderIds ?? []).filter(id => !visible.includes(id))];
      tx.update(taskRef, stampTaskWrite(taskRef, { subtaskOrderIds: ids, updatedAt: now })); record('サブタスクの順序を変更'); output = { task_id: taskId, version: now.toISOString(), subtaskOrderIds: ids };
    } else if (op.resource === 'comment') {
      const ref = childRef('comments'), saved = (await tx.get(ref)).data();
      if (!saved) fail('NOT_FOUND', 'コメントが見つかりません。', 404);
      expectVersion(saved, op.expected_version, false);
      if (saved.authorId !== auth.userId || saved.reviewTaskId) fail('FORBIDDEN', '自分の通常コメントのみ編集・削除できます。確認の元コメントは履歴として残します。', 403);
      validateSchema(op.data, op.action === 'delete' ? selectedSchema('Comment', []) : editableSchema('Comment', ['id', 'taskId', 'authorId', 'authorLabel', 'authorIcon', 'createdAt', 'updatedAt', 'reviewTaskId']));
      if (op.data.attachments) validateAttachments(op.data.attachments);
      if (op.data.purpose && op.data.purpose !== 'memo') fail('WORKFLOW_REQUIRED', '確認依頼は新しいコメント投稿から依頼してください。');
      const mentions = op.data.mentions as string[] | undefined;
      if (mentions && (mentions.length > 30 || new Set(mentions).size !== mentions.length || mentions.some(id => !memberIds.includes(id)))) fail('INVALID_INPUT', '現在のメンバーから通知先を選んでください。');
      const newNotifications = mentions ? await Promise.all(mentions.filter(id => !(saved.mentions ?? []).includes(id)).map(async id => ({ id, ref: getAdminDb().doc(`notifications/${childId}:${id}`), snapshot: await tx.get(getAdminDb().doc(`notifications/${childId}:${id}`)) }))) : [];

      const updated: DocumentData = { ...saved, ...op.data, updatedAt: now };
      if (op.action === 'patch' && !String(updated.content).trim() && !(updated.attachments as unknown[])?.length) fail('INVALID_INPUT', 'コメントまたは添付を入力してください。');
      if (op.action === 'delete') tx.delete(ref); else tx.update(ref, { ...op.data, updatedAt: now });
      for (const notification of newNotifications) if (!notification.snapshot.exists) tx.create(notification.ref, {
        userId: notification.id, type: 'comment_added', title: `${profile?.displayName ?? 'メンバー'}さんからコメント`, message: String(updated.content),
        projectId, taskId, taskName: current!.title, senderId: auth.userId, senderName: profile?.displayName ?? 'メンバー', isRead: false, createdAt: now,
        data: { commentId: childId, sourceTaskId: taskId, reviewTaskId: null },
      });
      tx.update(taskRef, stampTaskWrite(taskRef, { updatedAt: now })); record(`コメントを${op.action === 'delete' ? '削除' : '編集'}`);
      output = { resource_id: childId, ...(op.action === 'patch' ? { version: childVersion(updated) } : { deleted: true }), task_version: now.toISOString() };
    } else if (op.resource === 'checklist' || op.resource === 'checklist_item') {
      const ref = childRef('checklists'), saved = (await tx.get(ref)).data();
      const creating = op.resource === 'checklist' && op.action === 'create';
      if (creating && saved) fail('IDEMPOTENCY_CONFLICT', 'チェックリストIDが既に使われています。', 409);
      if (!creating && !saved) fail('NOT_FOUND', 'チェックリストが見つかりません。', 404);
      if (!creating) expectVersion(saved!, op.expected_version, false);
      let patch: DocumentData = { ...op.data };
      if (op.resource === 'checklist_item') {
        if (op.action === 'mutate') {
          const mutation = op.data as ChecklistItemMutation;
          validateSchema(op.data, models.ChecklistItemMutation);
          patch = { items: checked(() => mutateChecklistItems(saved!.items, mutation)) };
        } else {
          validateSchema(op.data, { type: 'object', properties: { itemId: { type: 'string' }, targetId: { type: 'string' } }, required: ['itemId', 'targetId'], additionalProperties: false });
          patch = { items: checked(() => moveChecklistItem(saved!.items, String(op.data.itemId), String(op.data.targetId))) };
        }
      } else validateSchema(patch, op.action === 'delete' ? selectedSchema('Checklist', []) : editableSchema('Checklist', ['id', 'taskId', 'createdAt'], creating ? ['title'] : []));
      const next = creating ? { taskId, title: '', order: 0, items: [], createdAt: now, ...patch } : { ...saved, ...patch };
      if (!next.title.trim() || next.title.length > 500) fail('INVALID_INPUT', 'チェックリスト名を確認してください。');
      validateChecklist(next.items);
      if (Buffer.byteLength(JSON.stringify(jsonValue(next))) > 850000) fail('RESOURCE_LIMIT', 'チェックリストが保存可能なサイズを超えています。', 413);
      const all = await tx.get(taskRef.collection('checklists').limit(501));
      if (all.size > 500) fail('RESOURCE_LIMIT', 'チェックリスト数の上限を超えています。');
      const items = all.docs.filter(d => d.id !== childId).flatMap(d => d.data().items ?? []);
      if (op.action !== 'delete') items.push(...next.items);
      const hasChecklistDeadlines = items.some((item: ChecklistItem) => !!item.dueDate);
      if (op.action === 'delete') tx.delete(ref); else if (creating) tx.create(ref, next); else tx.update(ref, patch);
      tx.update(taskRef, stampTaskWrite(taskRef, { hasChecklistDeadlines, updatedAt: now })); record('チェックリストを変更');
      output = { resource_id: childId, task_version: now.toISOString(), ...(op.action === 'delete' ? { deleted: true } : { version: childVersion(next) }) };
    } else if (op.resource === 'attachment') {
      if (uploaded?.purpose === 'comment') output = { attachment: uploaded.attachment };
      else {
        const ref = childRef('attachments'), saved = (await tx.get(ref)).data();
        const creating = ['add', 'upload'].includes(op.action);
        if (creating && saved) fail('IDEMPOTENCY_CONFLICT', '添付IDが既に使われています。', 409);
        if (!creating) { if (!saved) fail('NOT_FOUND', '添付が見つかりません。', 404); expectVersion(saved, op.expected_version, false); }
        const data = uploaded ? { name: uploaded.attachment.name, url: uploaded.attachment.url, type: uploaded.attachment.type, size: uploaded.attachment.size } : op.data;
        validateSchema(data, op.action === 'delete' ? selectedSchema('Attachment', []) : editableSchema('Attachment', ['id', 'taskId', 'uploadedBy', 'uploadedAt'], creating ? ['name', 'url', 'type', 'size'] : []));
        const next = { ...saved, ...data, ...(creating ? { taskId, uploadedBy: auth.userId, uploadedAt: now } : {}) };
        if (op.action !== 'delete') assertAttachment(next);
        if (op.action === 'delete') tx.delete(ref); else if (creating) tx.create(ref, next); else tx.update(ref, data);
        tx.update(taskRef, stampTaskWrite(taskRef, { updatedAt: now })); record('タスクの添付を変更');
        output = { resource_id: childId, task_version: now.toISOString(), ...(op.action === 'delete' ? { deleted: true, bytes_retained_for_history: true } : { version: childVersion(next), attachment: outputItem(childId, next) }) };
      }
    } else fail('INVALID_INPUT', '操作を確認してください。');
    // Recheck the request deadline immediately before committing any buffered writes.
    requireTaskScope(auth, true);
    const normalized = jsonValue(output) as Record<string, unknown>;
    tx.create(receiptRef, { userId: auth.userId, requestHash: signature, result: normalized, createdAt: now, origin: 'mcp', resource: op.resource, action: op.action, taskId, sourceTaskId: String(current?.parentTaskId ?? op.data.parentTaskId ?? taskId), resourceId: childId, trusted_writes: tracked.writes() });
    return { ...normalized, already_applied: false };
  });
  if (op.resource === 'completion_policy') {
    // Apply only this task's policy, preserving unrelated personal automation.
    try { await processParentPolicies(auth.userId, new Date().toISOString(), { projectId, taskId: op.task_id! }); }
    catch { return { ...result, policy_evaluation_pending: true }; }
  }
  return result;
}
export async function writeTaskData(auth: TaskPrincipal, args: Record<string, unknown>) {
  const projectId = args.project_id === undefined ? auth.projectIds[0] : args.project_id;
  assertId(projectId); await access(auth, projectId, true);
  if (Object.keys(args).some(k => !['project_id', 'operations', 'continue_on_error'].includes(k)) || !Array.isArray(args.operations) || args.operations.length < 1 || args.operations.length > 20 || args.continue_on_error !== undefined && typeof args.continue_on_error !== 'boolean') fail('INVALID_INPUT', '操作は1〜20件で指定してください。');
  const results = []; const ids = new Set();
  // Validate all envelopes before starting; business conflicts are reported per operation.
  for (const raw of args.operations) {
    if (!object(raw) || !object(raw.data) || Object.keys(raw).some(k => !['id', 'resource', 'action', 'task_id', 'resource_id', 'expected_version', 'expected_task_version', 'unset', 'data'].includes(k))) fail('INVALID_INPUT', '操作の形式を確認してください。');
    assertId(raw.id); if (ids.has(raw.id)) fail('INVALID_INPUT', 'バッチ内の操作IDを重複させないでください。'); ids.add(raw.id);
    if (!Object.hasOwn(OPERATIONS, String(raw.resource)) || !OPERATIONS[raw.resource as keyof typeof OPERATIONS].includes(String(raw.action))) fail('INVALID_INPUT', 'リソース・操作を確認してください。');
    for (const key of ['task_id', 'resource_id']) if (raw[key] !== undefined) assertId(raw[key]);
    for (const key of ['expected_version', 'expected_task_version']) if (raw[key] !== undefined && typeof raw[key] !== 'string') fail('INVALID_INPUT', 'バージョンを確認してください。');
    if (raw.unset !== undefined && (raw.resource !== 'task' || raw.action !== 'patch' || !Array.isArray(raw.unset) || raw.unset.length > 30 || raw.unset.some(k => typeof k !== 'string'))) fail('INVALID_INPUT', '削除する項目を確認してください。');
  }
  for (const [index, op] of (args.operations as TaskOperation[]).entries()) {
    try { results.push({ id: op.id, ok: true, result: await mutate(auth, projectId, op) }); }
    catch (error) {
      const known = error instanceof TaskDataError || object(error) && typeof error.status === 'number';
      results.push({ id: op.id, ok: false, error: { code: error instanceof TaskDataError ? error.code : known ? 'DOMAIN_REJECTED' : 'SAVE_UNCERTAIN', message: known && error instanceof Error ? error.message : '保存結果を確認できません。同じ操作ID・内容で再試行してください。' } });
      if (!args.continue_on_error) return { atomic: false, results, stopped_at: index, unattempted_ids: (args.operations as TaskOperation[]).slice(index + 1).map(o => o.id) };
    }
  }
  return { atomic: false, results, stopped_at: null, unattempted_ids: [] };
}
