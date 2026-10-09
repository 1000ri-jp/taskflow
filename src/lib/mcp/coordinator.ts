import { createHash } from 'node:crypto';
import type { DocumentData, DocumentReference, Transaction, Query } from 'firebase-admin/firestore';
import { reviewResult, type TaskReviewRequest } from '@/lib/task/reviews';
import { assertId, models, TaskDataError, validateSchema } from './taskContract';
import { coordinationFingerprint, type TrustedMcpWrite } from './coordinatorProvenance';
import { assertLiveCoordinationWorker, readCoordinationWorkerAvailability, saveCoordinationDelegation, revokeCoordinationDelegation } from './coordinatorTransport';
import type { CoordinationExecutionInput, CoordinationCapability, CoordinationPlan, CoordinationPlanInput, CoordinationPolicy, CoordinationWork } from './coordinatorTypes';
import type { TaskOperation, TaskPrincipal } from './taskData';

export const COORDINATION_SCHEMA_VERSION = 'slowth-coordination/v1';
export const COORDINATION_PILOT_PROJECT = 'SlBpu8BPYgIARk4DoYOV';
export function coordinationProjectIds(): string[] {
  const configured = process.env.SLOWTH_MCP_COORDINATION_PROJECT_IDS;
  const ids = configured === undefined ? [COORDINATION_PILOT_PROJECT] : configured.split(',').map(id => id.trim()).filter(Boolean);
  ids.forEach(assertId); return [...new Set(ids)];
}
function reject(code: string, message: string, status = 409): never { throw new TaskDataError(code, message, status); }
const version = coordinationFingerprint;
const policyRef = (projectRef: DocumentReference) => projectRef.collection('mcpCoordination').doc('policy');
const planRef = (projectRef: DocumentReference, id: string) => projectRef.collection('mcpCoordinationPlans').doc(id);
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate().toISOString() : typeof value === 'string' ? value : '';
function expected(data: unknown, value: unknown) { if (typeof value !== 'string' || value !== (data ? version(data) : 'absent')) reject('VERSION_CONFLICT', '判断記録が更新されています。読み直してください。'); }
function text(value: unknown, maximum = 20000) { if (typeof value !== 'string' || !value.trim() || value.length > maximum) reject('INVALID_INPUT', '説明・判断理由・完了条件を確認してください。', 422); }
function ownKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key))) reject('INVALID_INPUT', '調整操作の項目を確認してください。', 422); }
function sameMembers(policy: CoordinationPolicy, memberIds: string[]) {
  [policy.aiMemberId, ...policy.humanReviewers, ...policy.humans.map(person => person.id)].forEach(id => { assertId(id); if (!memberIds.includes(id)) reject('INVALID_INPUT', '現在のメンバーから担当と確認者を選んでください。', 422); });
}
export function validateCoordinationPolicy(raw: Record<string, unknown>, projectId: string, memberIds: string[]): CoordinationPolicy {
  validateSchema(raw, models.CoordinationPolicy); const policy = raw as unknown as CoordinationPolicy;
  if (!coordinationProjectIds().includes(projectId)) reject('PILOT_SCOPE', '調整機能は承認済みの「タスク管理ツール」に限定されています。', 403);
  if (!Number.isInteger(policy.maxLeaseSeconds) || policy.maxLeaseSeconds < 30 || policy.maxLeaseSeconds > 900 || policy.capabilities.length > 30 || policy.humans.length > 100) reject('INVALID_INPUT', '担当能力数・作業確保時間を確認してください。', 422);
  sameMembers(policy, memberIds);
  const ids = new Set<string>();
  for (const capability of policy.capabilities) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(capability.id)) reject('INVALID_INPUT', '能力IDを確認してください。', 422); text(capability.name, 200);
    if (ids.has(capability.id) || !capability.scope.projectIds.length || capability.scope.projectIds.some(id => id !== projectId) || !capability.kinds.length || !capability.evidence.length) reject('INVALID_INPUT', '能力ID・対象・接続の証拠を確認してください。', 422);
    ids.add(capability.id);
  }
  if (new Set(policy.humanReviewers).size !== policy.humanReviewers.length || new Set(policy.humans.map(person => person.id)).size !== policy.humans.length) reject('INVALID_INPUT', '担当者の登録が重複しています。', 422);
  return policy;
}
function usableCapability(policy: CoordinationPolicy, work: CoordinationWork, projectId: string): CoordinationCapability {
  const capability = policy.capabilities.find(item => item.id === work.capabilityId);
  if (!capability || !capability.kinds.includes(work.kind as 'research' | 'draft' | 'implementation') || !capability.scope.projectIds.includes(projectId) || capability.status !== 'verified' || capability.availability !== 'connected' || !capability.transport.supported) reject('CAPABILITY_UNAVAILABLE', '必要な実行環境との接続が未確認です。質問として残してください。');
  return capability;
}
async function sourceSnapshot(projectRef: DocumentReference, taskId: string, tx?: Transaction) {
  const getDoc = (ref: DocumentReference) => tx ? tx.get(ref) : ref.get();
  const getQuery = (ref: Query) => tx ? tx.get(ref) : ref.get();
  const parent = await getDoc(projectRef.collection('tasks').doc(taskId));
  if (!parent.exists) reject('NOT_FOUND', '親タスクが見つかりません。', 404);
  const data = parent.data()!;
  if (data.parentTaskId || data.isArchived || data.isAbandoned || data.isCompleted || data.taskKind === 'review_request') reject('INVALID_PARENT', '有効な親タスクから判断してください。');
  const receipts = await getQuery(projectRef.collection('mcpTaskOperations').where('sourceTaskId', '==', taskId).limit(501));
  const receiptRows = receipts.docs;
  if (receiptRows.length > 500) reject('RESOURCE_LIMIT', '自己変更の確認が取得上限を超えています。履歴を分けて確認してください。');
  const trusted = receiptRows.flatMap(row => (row.data()?.trusted_writes ?? []) as TrustedMcpWrite[]);
  const self = (path: string, item: DocumentData) => trusted.some(write => write.path === path && !write.deleted && write.fingerprint === version(item));
  const material = (item: DocumentData) => Object.fromEntries(Object.entries(item).filter(([key]) => !['updatedAt', 'apiChangedAt', 'subtaskOrderIds', 'reviewRequests', 'automation'].includes(key)));
  const sources: Record<string, unknown> = { parent: material(data) };
  for (const collection of ['comments', 'checklists', 'attachments']) {
    const rows = await getQuery(projectRef.collection('tasks').doc(taskId).collection(collection).limit(201));
    const documents = rows.docs;
    if (documents.length > 200) reject('RESOURCE_LIMIT', '判断対象が取得上限を超えています。省略せず停止しました。');
    sources[collection] = documents.filter(row => !self(row.ref.path, row.data()!)).map(row => ({ id: row.id, ...material(row.data()!) }));
  }
  const children = await getQuery(projectRef.collection('tasks').where('parentTaskId', '==', taskId).limit(201));
  if (children.size > 200) reject('RESOURCE_LIMIT', '関連作業が取得上限を超えています。');
  const humanRelevantChildren = children.docs.filter(row => !self(row.ref.path, row.data()));
  sources.subtasks = humanRelevantChildren.map(row => ({ id: row.id, ...material(row.data()) }));
  const dependencyIds = [...new Set([...(data.dependsOnTaskIds ?? []), ...humanRelevantChildren.flatMap(row => row.data().dependsOnTaskIds ?? [])])];
  if (dependencyIds.length > 200) reject('RESOURCE_LIMIT', '前提作業が取得上限を超えています。');
  sources.dependencies = [];
  for (const id of dependencyIds.sort()) { assertId(id); const dependency = (await getDoc(projectRef.collection('tasks').doc(id))).data(); (sources.dependencies as unknown[]).push({ id, exists: !!dependency, ...(dependency ? { title: dependency.title, assigneeIds: dependency.assigneeIds, isCompleted: dependency.isCompleted, isArchived: dependency.isArchived, isAbandoned: dependency.isAbandoned, workState: dependency.workState ?? null } : {}) }); }
  return { parent: data, inputFingerprint: version(sources), sources, trusted };
}
function planOutput(plan: CoordinationPlan, parent: DocumentData) {
  const operations = plan.works.filter(work => plan.status !== 'cancelled' && !work.existingTask).map(work => ({
    id: `coord-create-${version([plan.id, work.id]).slice(0, 32)}`, resource: 'task', action: 'create', task_id: work.taskId,
    expected_task_version: iso(parent.updatedAt), data: { title: work.title, description: work.description,
      completionCriteria: work.acceptanceCriteria.join('\n'), listId: parent.listId, parentTaskId: plan.parentTaskId, assigneeIds: [work.assigneeId],
      dependsOnTaskIds: [] },
  }));
  return { item: plan, _version: version(plan), materialization: { operations, sequential: true,
    instructions: 'Create each missing stable task with write_task_data. Refresh the parent version between creates; exact retries reuse the original operation. After all exist, set dependency IDs using task.patch with fresh versions, then activate. Existing tasks keep manual owners and dates.' } };
}
export async function readCoordination(projectRef: DocumentReference, args: Record<string, unknown>) {
  if (args.resource === 'coordination_policy') {
    const policy = (await policyRef(projectRef).get()).data() as CoordinationPolicy | undefined;
    return { item: policy ?? null, _version: policy ? version(policy) : 'absent', schema_version: COORDINATION_SCHEMA_VERSION,
      pilot_project_id: COORDINATION_PILOT_PROJECT, configured_project_ids: coordinationProjectIds(),
      worker_availability: await readCoordinationWorkerAvailability(projectRef, policy) };
  }
  if (args.resource === 'coordination_plans') {
    const rows = await projectRef.collection('mcpCoordinationPlans').limit(101).get();
    if (rows.size > 100) reject('RESOURCE_LIMIT', '判断記録が100件を超えています。個別の親タスクを確認してください。');
    return { items: rows.docs.filter(row => args.task_id === undefined || row.data().parentTaskId === args.task_id).map(row => ({ ...row.data(), _version: version(row.data()) })), next_cursor: null };
  }
  assertId(args.task_id);
  if (args.resource === 'coordination_self_write') {
    const rows = await projectRef.collection('mcpTaskOperations').where('sourceTaskId', '==', args.task_id).limit(501).get();
    if (rows.size > 500) reject('RESOURCE_LIMIT', '自己変更の確認が取得上限を超えています。');
    return { trusted_writes: rows.docs.flatMap(row => row.data().trusted_writes ?? []), instructions: 'Ignore only an exact path+fingerprint match. Never ignore every change from ai00 or its UID.' };
  }
  if (args.resource === 'coordination_context') {
    const source = await sourceSnapshot(projectRef, args.task_id);
    const policy = (await policyRef(projectRef).get()).data() as CoordinationPolicy | undefined;
    return { input_fingerprint: source.inputFingerprint, parent_version: iso(source.parent.updatedAt), sources: source.sources,
      worker_availability: await readCoordinationWorkerAvailability(projectRef, policy) };
  }
  assertId(args.resource_id); const ref = planRef(projectRef, args.resource_id), plan = (await ref.get()).data() as CoordinationPlan | undefined;
  if (!plan || plan.parentTaskId !== args.task_id) reject('NOT_FOUND', '判断記録が見つかりません。', 404);
  if (args.resource === 'coordination_history') {
    const rows = await ref.collection('history').limit(201).get(); if (rows.size > 200) reject('RESOURCE_LIMIT', '作業履歴が取得上限を超えています。');
    return { items: rows.docs.map(row => ({ id: row.id, ...row.data() })), next_cursor: null };
  }
  const parent = (await projectRef.collection('tasks').doc(args.task_id).get()).data();
  return planOutput(plan, parent ?? {});
}
function validateExecution(execution: CoordinationExecutionInput | undefined, capability: CoordinationCapability | undefined, workKind: string, reviewers: string[]) {
  if (!execution) return;
  if (!capability || capability.executor !== 'local_worker' || workKind === 'human' || !capability.scope.sourceIds.includes(execution.sourceId)) reject('EXECUTION_SCOPE', '能力に登録済みの資料範囲を選んでください。', 403);
  text(execution.prompt);
  if (execution.reviewerIds && (!execution.reviewerIds.length || execution.reviewerIds.length > 30 || new Set(execution.reviewerIds).size !== execution.reviewerIds.length || execution.reviewerIds.some(id => !reviewers.includes(id)))) reject('HUMAN_REVIEW_REQUIRED', '登録済みの人間から今回の確認担当を指定してください。', 422);
  if (execution.files.length > 100 || execution.checks.length > 50) reject('INVALID_INPUT', '選択する資料・確認項目の件数を確認してください。', 422);
  const safePath = (path: string) => {
    if (!path || path.length > 500 || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => ['..', '.', '', '.git', '.next', 'node_modules'].includes(part) || part.startsWith('.env') || /credential|secret|token|auth\.json/i.test(part))) reject('EXECUTION_SCOPE', '資料は登録済みの相対パスから明示的に選んでください。', 403);
  };
  const paths = new Set<string>();
  for (const file of execution.files) { safePath(file.path); if (paths.has(file.path) || file.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(file.expectedSha256)) reject('INVALID_INPUT', '資料パスと現在のSHA-256を確認してください。', 422); paths.add(file.path); }
  for (const check of execution.checks) { safePath(check.path); if (paths.size && !paths.has(check.path)) reject('EXECUTION_SCOPE', '確認対象は明示的に選んだファイルに限定してください。', 403); }
}
function preparePlan(input: CoordinationPlanInput, id: string, taskId: string, policy: CoordinationPolicy, policyVersion: string, userId: string, now: string, memberIds: string[]): CoordinationPlan {
  validateSchema(input, models.CoordinationPlanInput); text(input.rationale);
  if (!/^[a-f0-9]{64}$/.test(input.inputFingerprint) || !input.works.length || input.works.length > 30) reject('INVALID_INPUT', '判断元と作業数を確認してください。', 422);
  const ids = new Set(input.works.map(work => work.id)); if (ids.size !== input.works.length) reject('INVALID_INPUT', '作業IDが重複しています。', 422);
  const works: CoordinationWork[] = input.works.map(work => {
    assertId(work.id); assertId(work.assigneeId); text(work.title, 500); text(work.description); work.acceptanceCriteria.forEach(item => text(item, 2000));
    if (!work.acceptanceCriteria.length || !memberIds.includes(work.assigneeId) || work.assigneeType === 'ai' && (work.assigneeId !== policy.aiMemberId || work.kind === 'human') || work.assigneeType === 'human' && work.kind !== 'human' || work.dependsOn.some(dependency => dependency === work.id || !ids.has(dependency)) || new Set(work.dependsOn).size !== work.dependsOn.length) reject('INVALID_INPUT', '担当・完了条件・前提関係を確認してください。', 422);
    if (work.taskId !== undefined) assertId(work.taskId);
    validateExecution(work.execution, policy.capabilities.find(capability => capability.id === work.capabilityId), work.kind, policy.humanReviewers);
    return { ...work, taskId: work.taskId ?? `coord-${version([taskId, id, work.id]).slice(0, 40)}`, existingTask: work.taskId !== undefined, requiresHumanReview: policy.requireHumanReview || policy.capabilities.find(capability => capability.id === work.capabilityId)?.requiresHumanReview === true || work.kind === 'implementation',
      executionRevision: 1, needsReconciliation: false, invalidation: null, previousReviewTaskIds: [], status: 'planned', lease: null, startedAt: null, checkpoint: null, waiting: null, reviewTaskId: null, humanEvidence: null };
  });
  const visiting = new Set(), visited = new Set();
  const walk = (id: string) => { if (visiting.has(id)) reject('INVALID_RELATION', '割り振り案の前提関係が循環しています。', 422); if (visited.has(id)) return; visiting.add(id); works.find(work => work.id === id)!.dependsOn.forEach(walk); visiting.delete(id); visited.add(id); };
  works.forEach(work => walk(work.id));
  if (new Set(works.map(work => work.taskId)).size !== works.length || works.some(work => work.taskId === taskId)) reject('INVALID_INPUT', '割り振り先のタスクIDが重複しています。', 422);
  return { id, parentTaskId: taskId, policyVersion, inputFingerprint: input.inputFingerprint, rationale: input.rationale, status: 'proposed', works, reviewTaskIds: [], humanTaskIds: works.filter(work => work.assigneeType === 'human').map(work => work.taskId), createdAt: now, updatedAt: now, createdBy: userId };
}
function invalidateDependents(plan: CoordinationPlan, prerequisite: CoordinationWork, now: string, reason: string) {
  const ids = new Set([prerequisite.id]); let changed = true;
  while (changed) { changed = false; for (const work of plan.works) if (!ids.has(work.id) && work.dependsOn.some(id => ids.has(id))) { ids.add(work.id); changed = true; } }
  for (const work of plan.works.filter(work => work.id !== prerequisite.id && ids.has(work.id) && work.status !== 'cancelled')) {
    work.executionRevision = (work.executionRevision ?? 1) + 1; work.needsReconciliation = true;
    work.invalidation = { workId: prerequisite.id, reason, at: now, evidence: prerequisite.humanEvidence };
    work.status = work.assigneeType === 'ai' ? 'changes_requested' : 'ready'; work.lease = null; work.startedAt = null; work.waiting = null;
    if (work.reviewTaskId) work.previousReviewTaskIds = [...new Set([...(work.previousReviewTaskIds ?? []), work.reviewTaskId])];
    work.reviewTaskId = null;
  }
}
function requireLease(work: CoordinationWork, token: unknown, now: string) {
  if (work.status !== 'running' || typeof token !== 'string' || work.lease?.token !== token || Date.parse(work.lease.expiresAt) <= Date.parse(now)) reject('LEASE_LOST', '作業確保が失効しました。最新の記録を読んで確保し直してください。');
}
async function readComment(tx: Transaction, projectRef: DocumentReference, taskId: string, id: unknown, expectedVersion: unknown, human: boolean) {
  assertId(id); const ref = projectRef.collection('tasks').doc(taskId).collection('comments').doc(id), comment = (await tx.get(ref)).data();
  if (!comment || version(comment) !== expectedVersion) reject('VERSION_CONFLICT', '質問・回答コメントを読み直してください。');
  if (human) {
    const rows = await tx.get(projectRef.collection('mcpTaskOperations').where('sourceTaskId', '==', taskId).limit(501));
    if (rows.size > 500) reject('RESOURCE_LIMIT', '回答元の確認が取得上限を超えています。');
    if (rows.docs.some(row => (row.data().trusted_writes as TrustedMcpWrite[] | undefined)?.some(write => write.path === ref.path && write.fingerprint === version(comment)))) reject('HUMAN_RESPONSE_REQUIRED', 'AI自身のコメントは人間の回答として扱えません。');
  }
  return comment;
}
export async function mutateCoordination(tx: Transaction, auth: TaskPrincipal, projectRef: DocumentReference, memberIds: string[], op: TaskOperation) {
  if (!coordinationProjectIds().includes(projectRef.id)) reject('PILOT_SCOPE', '調整機能は承認済みの「タスク管理ツール」に限定されています。', 403);
  const storedPolicy = (await tx.get(policyRef(projectRef))).data();
  const now = new Date().toISOString();
  if (op.resource === 'coordination_policy') {
    expected(storedPolicy, op.expected_version);
    const policy = validateCoordinationPolicy(op.data, projectRef.id, memberIds);
    tx.set(policyRef(projectRef), policy); return { item: policy, version: version(policy), schema_version: COORDINATION_SCHEMA_VERSION };
  }
  if (!storedPolicy) reject('POLICY_REQUIRED', '先に担当能力と判断方針を登録してください。');
  const policy = validateCoordinationPolicy(storedPolicy, projectRef.id, memberIds);
  assertId(op.task_id); assertId(op.resource_id);
  const ref = planRef(projectRef, op.resource_id), stored = (await tx.get(ref)).data() as CoordinationPlan | undefined;
  const storedParent = (await tx.get(projectRef.collection('tasks').doc(op.task_id))).data();
  // Cancellation uses the existing plan binding even after its original parent changes or disappears.
  if (op.action !== 'cancel' && (!storedParent || storedParent.parentTaskId || storedParent.isArchived || storedParent.isAbandoned)) reject('INVALID_PARENT', '有効な親タスクを指定してください。');
  const parent = storedParent ?? {};
  let plan: CoordinationPlan;
  if (op.action === 'propose') {
    expected(stored, op.expected_version);
    if (stored) reject('PLAN_EXISTS', '同じ判断記録の作業を継続してください。変更案には別の安定したIDを使ってください。');
    const source = await sourceSnapshot(projectRef, op.task_id, tx);
    if (op.expected_task_version !== iso(parent.updatedAt) || op.data.inputFingerprint !== source.inputFingerprint) reject('VERSION_CONFLICT', '判断中にタスク・コメントが更新されました。読み直してください。');
    const existing = await tx.get(projectRef.collection('mcpCoordinationPlans').where('parentTaskId', '==', op.task_id).limit(101));
    if (existing.size > 100) reject('RESOURCE_LIMIT', 'この親タスクの判断記録が上限を超えています。');
    if (existing.docs.some(row => ['proposed', 'active'].includes(row.data().status))) reject('ACTIVE_PLAN_EXISTS', '先に既存の判断記録を継続・再判断・取消してください。競合する割り振りは作成しません。');
    if (existing.docs.some(row => row.data().inputFingerprint === source.inputFingerprint && row.data().status !== 'cancelled')) reject('INPUT_ALREADY_PLANNED', '同じ依頼はすでに判断済みです。既存の割り振りを継続してください。');
    plan = preparePlan(op.data as unknown as CoordinationPlanInput, op.resource_id, op.task_id, policy, version(policy), auth.userId, now, memberIds);
    for (const work of plan.works.filter(work => work.existingTask)) {
      const task = (await tx.get(projectRef.collection('tasks').doc(work.taskId))).data();
      if (!task || task.parentTaskId !== op.task_id || task.isArchived || task.isAbandoned || task.isCompleted || !Array.isArray(task.assigneeIds) || task.assigneeIds.length !== 1 || task.assigneeIds[0] !== work.assigneeId) reject('MANUAL_ASSIGNMENT', '既存作業の担当や状態を保持し、実際の担当に合わせて判断してください。');
    }
  } else {
    if (!stored || stored.parentTaskId !== op.task_id) reject('NOT_FOUND', '判断記録が見つかりません。', 404);
    expected(stored, op.expected_version); plan = structuredClone(stored);
    if (plan.status === 'cancelled' || plan.status === 'completed' && op.action !== 'sync_human') reject('PLAN_TERMINAL', '終了済みの判断記録は変更できません。');
    if (op.action !== 'cancel' && (!policy.enabled || policy.mode !== 'active')) reject('COORDINATION_PAUSED', '自動割り振りと作業は方針で停止しています。');
    if (op.action === 'reconcile') {
      ownKeys(op.data, ['inputFingerprint', 'rationale', 'executionUpdates']); text(op.data.rationale);
      const source = await sourceSnapshot(projectRef, op.task_id, tx);
      if (op.data.inputFingerprint !== source.inputFingerprint) reject('VERSION_CONFLICT', '再判断中に依頼が変わりました。読み直してください。');
      const updates = op.data.executionUpdates ?? [];
      if (!Array.isArray(updates) || updates.length > 30 || new Set(updates.map(update => update?.work_id)).size !== updates.length) reject('INVALID_INPUT', '再判断する実行入力を確認してください。', 422);
      for (const update of updates) {
        if (!update || typeof update !== 'object' || Object.keys(update).some(key => !['work_id', 'execution'].includes(key))) reject('INVALID_INPUT', '再判断する実行入力を確認してください。', 422);
        assertId(update.work_id); const work = plan.works.find(item => item.id === update.work_id);
        if (!work || work.assigneeType !== 'ai' || ['done', 'cancelled', 'awaiting_review'].includes(work.status)) reject('INVALID_STATE', '未着手・修正中のAI作業の実行入力を判断してください。');
        validateSchema(update.execution, models.CoordinationExecutionInput); validateExecution(update.execution, policy.capabilities.find(capability => capability.id === work.capabilityId), work.kind, policy.humanReviewers);
        if (version(work.execution ?? null) !== version(update.execution)) { work.execution = update.execution; work.executionRevision = (work.executionRevision ?? 1) + 1; }
      }
      const sourceChanged = source.inputFingerprint !== plan.inputFingerprint;
      for (const work of plan.works) {
        const task = (await tx.get(projectRef.collection('tasks').doc(work.taskId))).data();
        if (plan.status === 'active' && (!task || task.parentTaskId !== op.task_id || task.isArchived || task.isAbandoned || task.assigneeIds?.length !== 1 || task.assigneeIds[0] !== work.assigneeId)) reject('MANUAL_ASSIGNMENT', '担当・割り振りの変更は現在の計画を取消し、既存タスクを再利用して判断し直してください。');
        if (work.status === 'running') { work.status = 'ready'; work.lease = null; work.startedAt = null; if (!work.needsReconciliation) work.executionRevision = (work.executionRevision ?? 1) + 1; }
        else if (sourceChanged && !work.needsReconciliation && ['ready', 'changes_requested'].includes(work.status) && work.assigneeType === 'ai') work.executionRevision = (work.executionRevision ?? 1) + 1;
        work.needsReconciliation = false;
      }
      plan.inputFingerprint = source.inputFingerprint; plan.policyVersion = version(policy); plan.rationale = op.data.rationale as string;
    } else if (op.action === 'activate') {
      ownKeys(op.data, []); if (plan.status !== 'proposed') reject('INVALID_STATE', '未反映の割り振り案から開始してください。');
      if ((await sourceSnapshot(projectRef, op.task_id, tx)).inputFingerprint !== plan.inputFingerprint) reject('COORDINATION_SOURCE_CHANGED', '割り振り中に依頼が変わりました。reconcileで再判断するか取消してください。');
      if (plan.policyVersion !== version(policy)) reject('VERSION_CONFLICT', '判断後に方針が変更されました。新しい方針で判断し直してください。');
      for (const work of plan.works) {
        const task = (await tx.get(projectRef.collection('tasks').doc(work.taskId))).data();
        const dependencies = work.dependsOn.map(id => plan.works.find(item => item.id === id)!.taskId);
        if (!task || task.parentTaskId !== op.task_id || task.isArchived || task.isAbandoned || task.isCompleted || !Array.isArray(task.assigneeIds) || task.assigneeIds.length !== 1 || task.assigneeIds[0] !== work.assigneeId || dependencies.some(id => !(task.dependsOnTaskIds ?? []).includes(id))) reject('MATERIALIZATION_REQUIRED', '割り振り先・担当・前提を共通タスク操作で保存し、最新の状態を確認してください。');
        work.status = 'ready';
      }
      plan.status = 'active';
    } else if (op.action === 'cancel') {
      ownKeys(op.data, ['reason']); text(op.data.reason, 2000); plan.status = 'cancelled';
      plan.works.filter(work => work.status !== 'done').forEach(work => { work.status = 'cancelled'; work.lease = null; });
    } else {
      if (plan.status !== 'active' && !(plan.status === 'completed' && op.action === 'sync_human')) reject('INVALID_STATE', '割り振りを保存してから作業を進めてください。');
      assertId(op.data.work_id); const work = plan.works.find(item => item.id === op.data.work_id); if (!work) reject('NOT_FOUND', '作業が見つかりません。', 404);
      const task = (await tx.get(projectRef.collection('tasks').doc(work.taskId))).data();
      if (!task || task.isArchived || task.isAbandoned || task.parentTaskId !== op.task_id || !Array.isArray(task.assigneeIds) || task.assigneeIds.length !== 1 || task.assigneeIds[0] !== work.assigneeId) reject('MANUAL_ASSIGNMENT', '作業の担当や状態が変更されています。最新の内容を判断し直してください。');
      if (op.action === 'claim') {
        ownKeys(op.data, ['work_id', 'worker_id', 'lease_seconds']); assertId(op.data.worker_id);
        if (work.assigneeType !== 'ai' || !['ready', 'changes_requested', 'running'].includes(work.status)) reject('INVALID_STATE', 'AIの未着手・修正作業だけを確保できます。');
        if (work.needsReconciliation) reject('RECONCILIATION_REQUIRED', '前提作業が開き直されました。保存済みの成果を読み、現在の入力でreconcileを行ってから再実行してください。');
        if (task.isCompleted) reject('TASK_ALREADY_COMPLETED', '人間が完了した仕事を再実行しません。結果を確認して計画を再判断してください。');
        if ((await sourceSnapshot(projectRef, op.task_id, tx)).inputFingerprint !== plan.inputFingerprint) reject('COORDINATION_SOURCE_CHANGED', '依頼・関連作業が変更されました。reconcileで再判断するか取消してください。');
        const capability = usableCapability(policy, work, projectRef.id);
        if (capability.executor === 'local_worker') await assertLiveCoordinationWorker(tx, projectRef.id, op.data.worker_id, capability, work.execution?.sourceId);
        if (work.dependsOn.some(id => plan.works.find(item => item.id === id)?.status !== 'done')) reject('DEPENDENCY_PENDING', '前提作業の完了・人間の確認を待ってください。');
        if (work.lease && Date.parse(work.lease.expiresAt) > Date.parse(now)) reject('LEASE_HELD', '別の実行が作業を確保しています。失効または完了を待ってください。');
        const seconds = op.data.lease_seconds ?? policy.maxLeaseSeconds;
        if (!Number.isInteger(seconds) || Number(seconds) < 30 || Number(seconds) > policy.maxLeaseSeconds) reject('INVALID_INPUT', '作業確保時間を確認してください。', 422);
        const token = createHash('sha256').update(JSON.stringify([op.id, auth.grantId, now])).digest('hex');
        work.lease = { token, workerId: op.data.worker_id, expiresAt: new Date(Date.parse(now) + Number(seconds) * 1000).toISOString() };
        work.status = 'running'; work.startedAt ??= now;
      } else if (op.action === 'checkpoint' || op.action === 'result') {
        validateSchema(op.data, models.CoordinationCheckpointInput); requireLease(work, op.data.lease_token, now); text(op.data.summary);
        if (work.dependsOn.some(id => plan.works.find(item => item.id === id)?.status !== 'done')) reject('DEPENDENCY_PENDING', '前提作業の確認が取り消されています。成果を保持して再判断してください。');
        if ((await sourceSnapshot(projectRef, op.task_id, tx)).inputFingerprint !== plan.inputFingerprint) reject('COORDINATION_SOURCE_CHANGED', '実行中に依頼・関連作業が変更されました。成果を確認して再判断してください。');
        const artifacts = op.data.artifacts as { label: string; url: string }[] ?? [];
        for (const artifact of artifacts) { text(artifact.label, 500); let url: URL; try { url = new URL(artifact.url); } catch { return reject('INVALID_INPUT', '成果物のURLを確認してください。', 422); } if (url.protocol !== 'https:' || url.username || url.password) reject('INVALID_INPUT', '成果物は認証情報を含まないHTTPS URLで指定してください。', 422); }
        const checks = op.data.checks as { name: string; passed: boolean; detail: string }[] ?? [];
        work.checkpoint = { summary: op.data.summary as string, artifacts, checks, at: now };
        if (op.action === 'checkpoint' && policy.capabilities.find(capability => capability.id === work.capabilityId)?.executor === 'local_worker') await assertLiveCoordinationWorker(tx, projectRef.id, work.lease!.workerId, usableCapability(policy, work, projectRef.id), work.execution?.sourceId);
        if (op.action === 'checkpoint') work.lease!.expiresAt = new Date(Date.parse(now) + policy.maxLeaseSeconds * 1000).toISOString();
        else {
          if (checks.some(check => !check.passed)) reject('CHECKS_FAILED', '失敗した検証を直すか、人間待ちとして残してください。');
          const capability = usableCapability(policy, work, projectRef.id);
          if (capability.executor === 'local_worker') await assertLiveCoordinationWorker(tx, projectRef.id, work.lease!.workerId, capability, work.execution?.sourceId);
          if (work.requiresHumanReview || policy.requireHumanReview || capability.requiresHumanReview) {
            assertId(op.data.review_task_id); const request = parent.reviewRequests?.[op.data.review_task_id] as TaskReviewRequest | undefined;
            if (!request || !request.assigneeIds.length || request.assigneeIds.some(id => !policy.humanReviewers.includes(id)) || work.execution?.reviewerIds && (request.assigneeIds.length !== work.execution.reviewerIds.length || request.assigneeIds.some(id => !work.execution!.reviewerIds!.includes(id))) || Object.keys(request.cycle.responses).length || Date.parse(request.cycle.requestedAt) < Date.parse(work.startedAt!)) reject('HUMAN_REVIEW_REQUIRED', '親タスクに今回の成果物の人間向け確認依頼を投稿してから結果を保存してください。');
            work.reviewTaskId = op.data.review_task_id; work.status = 'awaiting_review';
          } else work.status = 'done';
          work.lease = null;
        }
      } else if (op.action === 'wait') {
        validateSchema(op.data, models.CoordinationWaitInput); text(op.data.question, 2000);
        if (work.status === 'running') requireLease(work, op.data.lease_token, now);
        else if (!['ready', 'changes_requested'].includes(work.status)) reject('INVALID_STATE', '進行中または未着手の作業から確認を依頼してください。');
        await readComment(tx, projectRef, op.task_id, op.data.comment_id, op.data.comment_version, false);
        work.waiting = { question: op.data.question as string, commentId: op.data.comment_id as string, commentVersion: op.data.comment_version as string }; work.status = 'waiting_human'; work.lease = null;
      } else if (op.action === 'resume') {
        validateSchema(op.data, models.CoordinationResumeInput);
        if (work.status !== 'waiting_human') reject('INVALID_STATE', '人間の回答待ちの作業だけを再開できます。');
        const answer = await readComment(tx, projectRef, op.task_id, op.data.answer_comment_id, op.data.answer_comment_version, true);
        if (!memberIds.includes(String(answer.authorId)) || iso(answer.createdAt) <= iso((await tx.get(projectRef.collection('tasks').doc(op.task_id).collection('comments').doc(work.waiting!.commentId))).data()?.createdAt)) reject('HUMAN_RESPONSE_REQUIRED', '質問後のプロジェクトメンバーの回答を確認してください。');
        work.humanEvidence = { kind: 'comment', id: op.data.answer_comment_id as string, version: op.data.answer_comment_version as string }; work.waiting = null; work.status = 'ready'; work.startedAt = null; work.executionRevision = (work.executionRevision ?? 1) + 1;
        plan.inputFingerprint = (await sourceSnapshot(projectRef, op.task_id, tx)).inputFingerprint;
      } else if (op.action === 'sync_human') {
        ownKeys(op.data, ['work_id']);
        const previousStatus = work.status;
        if (work.status === 'awaiting_review' || work.status === 'done' && work.reviewTaskId) {
          const request = parent.reviewRequests?.[work.reviewTaskId!] as TaskReviewRequest | undefined;
          if (!request || !request.assigneeIds.length || request.assigneeIds.some(id => !policy.humanReviewers.includes(id))) reject('HUMAN_REVIEW_REQUIRED', '確認依頼と人間の返答を確認してください。');
          const outcome = reviewResult({ review: request.cycle, assigneeIds: request.assigneeIds });
          if (outcome === 'pending' && !request.cycle.correctedApproval) reject('HUMAN_REVIEW_PENDING', '人間の確認待ちです。');
          work.status = outcome === 'approved' ? 'done' : outcome === 'changes_requested' ? 'changes_requested' : 'awaiting_review'; work.humanEvidence = { kind: 'review', id: work.reviewTaskId!, version: version(request) };
        } else if (work.assigneeType === 'human' && work.status === 'done' && !task.isCompleted) {
          work.status = 'ready'; work.humanEvidence = { kind: 'task', id: work.taskId, version: iso(task.updatedAt) };
        } else if (work.assigneeType === 'human' && work.status === 'ready' && task.isCompleted) {
          if (work.needsReconciliation || work.invalidation && Date.parse(iso(task.updatedAt)) <= Date.parse(work.invalidation.at)) reject('HUMAN_RESPONSE_REQUIRED', '前提変更後の人間による新しい作業完了を確認してください。');
          const receipts = await tx.get(projectRef.collection('mcpTaskOperations').where('taskId', '==', work.taskId).limit(501));
          if (receipts.size > 500 || receipts.docs.some(row => row.data().trusted_writes?.some((write: TrustedMcpWrite) => write.path === projectRef.collection('tasks').doc(work.taskId).path && write.fingerprint === version(task)))) reject('HUMAN_RESPONSE_REQUIRED', '人間が完了した作業を確認してください。');
          work.status = 'done'; work.humanEvidence = { kind: 'task', id: work.taskId, version: iso(task.updatedAt) };
        } else reject('HUMAN_REVIEW_PENDING', '人間の作業完了または確認の返答待ちです。');
        if (previousStatus === 'done' && work.status !== 'done') invalidateDependents(plan, work, now, work.assigneeType === 'human' ? '人間が前提作業を開き直しました。変更された内容で成果を再判断してください。' : '前提作業の人間確認が取消・修正されました。成果を再判断してください。');
        if (work.status === 'changes_requested' && previousStatus !== 'changes_requested') { work.executionRevision = (work.executionRevision ?? 1) + 1; work.startedAt = null; }
        plan.inputFingerprint = (await sourceSnapshot(projectRef, op.task_id, tx)).inputFingerprint;
      } else reject('INVALID_INPUT', '調整操作を確認してください。', 422);
      plan.status = plan.works.every(item => item.status === 'done') ? 'completed' : 'active';
    }
    plan.updatedAt = now;
  }
  plan.reviewTaskIds = [...new Set(plan.works.flatMap(work => [...(work.previousReviewTaskIds ?? []), ...(work.reviewTaskId ? [work.reviewTaskId] : [])]))];
  if (Buffer.byteLength(JSON.stringify(plan)) > 750000) reject('RESOURCE_LIMIT', '判断記録が保存上限を超えています。');
  if (op.action === 'propose' || op.action === 'reconcile') {
    if (plan.works.some(work => work.execution && policy.capabilities.find(capability => capability.id === work.capabilityId)?.executor === 'local_worker')) await saveCoordinationDelegation(tx, auth, projectRef.id, plan.id);
  } else if (op.action === 'cancel') revokeCoordinationDelegation(tx, projectRef.id, plan.id);
  tx.set(ref, plan); tx.create(ref.collection('history').doc(version([auth.userId, op.id])), { action: op.action, workId: op.data.work_id ?? null, userId: auth.userId, at: now, beforeVersion: stored ? version(stored) : null, afterVersion: version(plan), data: op.data });
  const output = planOutput(plan, parent);
  const work = plan.works.find(item => item.id === op.data.work_id);
  return { ...output, version: output._version, ...(work?.lease ? { lease_token: work.lease.token, lease_expires_at: work.lease.expiresAt } : {}) };
}
/** MCP may request review or resubmit; the human's existing workflow owns acceptance. */
export async function assertCoordinationWorkflow(tx: Transaction, projectRef: DocumentReference, taskId: string, action: unknown) {
  if (!['approve', 'request_changes', 'correct_approval', 'complete'].includes(String(action))) return;
  const rows = await tx.get(projectRef.collection('mcpCoordinationPlans').where(action === 'complete' ? 'humanTaskIds' : 'reviewTaskIds', 'array-contains', taskId).limit(101));
  if (rows.size > 100) reject('RESOURCE_LIMIT', '確認記録の取得上限を超えています。');
  for (const row of rows.docs) for (const work of (row.data().works ?? []) as CoordinationWork[]) {
    if ((work.reviewTaskId === taskId || work.previousReviewTaskIds?.includes(taskId)) && ['approve', 'request_changes', 'correct_approval'].includes(String(action))) reject('HUMAN_REVIEW_REQUIRED', '調整されたAI作業の確認は人間がSlowth画面から返答してください。');
    if (work.taskId === taskId && work.assigneeType === 'human' && action === 'complete') reject('HUMAN_RESPONSE_REQUIRED', '人間に割り振られた仕事の完了は人間が記録してください。');
  }
}
