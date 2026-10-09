import { createHash } from 'node:crypto';
import type { DocumentData, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { assertId, TaskDataError } from './taskContract';
import { coordinationFingerprint } from './coordinatorProvenance';
import { coordinationProjectIds } from './coordinator';
import { activeUser, oidcConfig } from './oidc';
import type { CoordinationCapability, CoordinationPolicy } from './coordinatorTypes';
import type { TaskPrincipal } from './taskData';

const delegationId = (projectId: string, planId: string) => coordinationFingerprint([projectId, planId]);
const privateRef = (id: string) => getAdminDb().doc(`mcpCoordinationDelegations/${id}`);
function denied(code: string, message: string, status = 403): never { throw new TaskDataError(code, message, status); }
interface CoordinationDelegation {
  projectId: string; planId: string; principal: TaskPrincipal; principalFingerprint: string; expiresAt: number; sourceAccessTokenExpiresAt: number; updatedAt: string;
}
export interface CoordinationWorkerHeartbeatInput { worker_id: string; capability_ids: string[]; source_ids: string[]; ttl_seconds?: number }
export interface CoordinationWorkerHeartbeat { projectId: string; workerId: string; capabilityIds: string[]; sourceIds: string[]; seenAt: string; expiresAt: string }
export interface CoordinationWorkerAvailability {
  serverNow: string; status: 'available' | 'unavailable' | 'missing';
  workers: {
    workerId: string; projectId: string; seenAt: string | null; expiresAt: string | null;
    status: 'fresh' | 'expired' | 'invalid'; fresh: boolean; available: boolean;
    capabilities: { capabilityId: string; sourceIds: string[] }[];
  }[];
}

function heartbeatInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value ? value : null;
}
function heartbeatIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 30 &&
    value.every(id => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(id)) && new Set(value).size === value.length;
}
/** Public project-scoped preflight evidence; never return stored worker documents verbatim. */
export async function readCoordinationWorkerAvailability(projectRef: DocumentReference, policy?: CoordinationPolicy): Promise<CoordinationWorkerAvailability> {
  const rows = await projectRef.collection('mcpCoordinationWorkers').limit(101).get()
    .catch(() => denied('WORKER_AVAILABILITY_UNAVAILABLE', '実行環境の現在の稼働状況を取得できません。確認してから再開してください。', 503));
  if (rows.size > 100) denied('RESOURCE_LIMIT', '実行環境の登録が取得上限を超えています。省略せず停止しました。', 409);
  const now = new Date(), nowMs = now.getTime();
  const capabilities = policy?.capabilities ?? [];
  const workers = rows.docs.filter(row => row.data().projectId === projectRef.id).map(row => {
    const stored = row.data(), seenAt = heartbeatInstant(stored.seenAt), expiresAt = heartbeatInstant(stored.expiresAt);
    const seenMs = seenAt ? Date.parse(seenAt) : NaN, expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const ttl = (expiresMs - seenMs) / 1000;
    const scopeValid = heartbeatIds(stored.capabilityIds) && heartbeatIds(stored.sourceIds);
    const valid = /^[A-Za-z0-9_-]{1,128}$/.test(row.id) && stored.workerId === row.id && scopeValid &&
      Number.isFinite(seenMs) && Number.isFinite(expiresMs) && Number.isInteger(ttl) && ttl >= 30 && ttl <= 180 && seenMs <= nowMs;
    const status = !valid ? 'invalid' as const : expiresMs > nowMs ? 'fresh' as const : 'expired' as const;
    const supported = scopeValid ? capabilities.filter(capability => stored.capabilityIds.includes(capability.id) &&
      capability.executor === 'local_worker' && capability.status === 'verified' && capability.availability === 'connected' &&
      capability.transport.supported && capability.scope.projectIds.includes(projectRef.id)).map(capability => ({
      capabilityId: capability.id,
      sourceIds: capability.scope.sourceIds.filter(sourceId => stored.sourceIds.includes(sourceId)),
    })).filter(capability => capability.sourceIds.length > 0) : [];
    return { workerId: row.id, projectId: projectRef.id, seenAt, expiresAt, status, fresh: status === 'fresh',
      available: status === 'fresh' && policy?.enabled === true && policy.mode === 'active' && supported.length > 0,
      capabilities: supported };
  });
  return { serverNow: now.toISOString(), status: !workers.length ? 'missing' : workers.some(worker => worker.available) ? 'available' : 'unavailable', workers };
}
function plainPrincipal(auth: TaskPrincipal): TaskPrincipal {
  return { userId: auth.userId, grantId: auth.grantId, expiresAt: auth.expiresAt, authorizationExpiresAt: auth.authorizationExpiresAt, projectIds: [...auth.projectIds], taskScopes: [...auth.taskScopes], permissions: [...auth.permissions] };
}
/** Save the existing grant-scoped offline job authorization; no bearer token or grant is minted. */
export async function saveCoordinationDelegation(tx: Transaction, auth: TaskPrincipal, projectId: string, planId: string) {
  const binding = (await tx.get(getAdminDb().doc(`mcpOAuthGrants/${createHash('sha256').update(auth.grantId).digest('hex')}`))).data();
  const grantExpiry = binding?.expiresAt instanceof Date ? binding.expiresAt.getTime() : binding?.expiresAt?.toMillis?.();
  if (binding?.userId !== auth.userId || binding?.projectId !== projectId || binding?.mode !== 'production' || !binding?.taskScopes?.includes('tasks:read') || !binding?.taskScopes?.includes('tasks:write') || !Number.isFinite(grantExpiry)) denied('DELEGATION_REVOKED', '現在のOAuth許可から作業委任を保存してください。');
  const expiresAt = Math.min(auth.authorizationExpiresAt, grantExpiry);
  const principal = { ...plainPrincipal(auth), projectIds: [projectId], expiresAt, authorizationExpiresAt: expiresAt };
  if (![auth.expiresAt, auth.authorizationExpiresAt, expiresAt].every(value => Number.isFinite(value) && value > Date.now()) || !auth.projectIds.includes(projectId)) denied('AUTHORIZATION_EXPIRED', '作業委任には現在有効な接続が必要です。', 401);
  const stored: CoordinationDelegation = { projectId, planId, principal, principalFingerprint: coordinationFingerprint(principal), expiresAt, sourceAccessTokenExpiresAt: auth.coordinationSourceAccessTokenExpiresAt ?? auth.expiresAt, updatedAt: new Date().toISOString() };
  tx.set(privateRef(delegationId(projectId, planId)), stored);
}
export function revokeCoordinationDelegation(tx: Transaction, projectId: string, planId: string) { tx.delete(privateRef(delegationId(projectId, planId))); }
function checkStored(auth: TaskPrincipal, projectId: string, stored?: DocumentData) {
  if (!stored || stored.projectId !== projectId || stored.principalFingerprint !== coordinationFingerprint(plainPrincipal(auth))) denied('DELEGATION_REVOKED', 'この作業委任は更新または取消されました。', 403);
  if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now() || [auth.expiresAt, auth.authorizationExpiresAt].some(value => !Number.isFinite(value) || value <= Date.now())) denied('AUTHORIZATION_EXPIRED', '作業委任の接続期限が切れています。', 401);
}
/** Called by common read/write paths, including a fresh transaction check on writes. */
export async function assertCoordinationDelegation(auth: TaskPrincipal, projectId: string, tx?: Transaction) {
  if (!auth.coordinationDelegationId) return;
  const get = (path: string) => tx ? tx.get(getAdminDb().doc(path)) : getAdminDb().doc(path).get();
  const stored = (await get(privateRef(auth.coordinationDelegationId).path)).data(); checkStored(auth, projectId, stored);
  const binding = (await get(`mcpOAuthGrants/${createHash('sha256').update(auth.grantId).digest('hex')}`)).data();
  const expiry = binding?.expiresAt instanceof Date ? binding.expiresAt.getTime() : binding?.expiresAt?.toMillis?.();
  if (binding?.userId !== auth.userId || binding?.projectId !== projectId || binding?.mode !== 'production' || !binding?.taskScopes?.includes('tasks:read') || !binding?.taskScopes?.includes('tasks:write') || !Number.isFinite(expiry) || expiry <= Date.now()) denied('DELEGATION_REVOKED', '元のOAuth許可が失効または取消されました。', 403);
  const sourceGrant = (await get(`mcpOAuthState/${createHash('sha256').update(`Grant:${auth.grantId}`).digest('hex')}`)).data();
  const sourceExpiry = sourceGrant?.expiresAt instanceof Date ? sourceGrant.expiresAt.getTime() : sourceGrant?.expiresAt?.toMillis?.();
  if (!Number.isFinite(sourceExpiry) || sourceExpiry <= Date.now()) denied('DELEGATION_REVOKED', '元のOAuth許可が失効または取消されました。', 403);
  try {
    const config = oidcConfig();
    if (!config.productionEnabled || !config.taskAccessEnabled || binding.clientId !== config.clientId ||
        binding.resource !== config.resource || !Number.isFinite(binding.authTime)) throw new Error('Invalid source authorization');
    await activeUser(auth.userId, config, binding.authTime);
  } catch { denied('DELEGATION_REVOKED', '元のOAuth許可またはGoogleアカウントが無効になりました。', 403); }
  checkStored(auth, projectId, stored);
  if (expiry <= Date.now() || sourceExpiry <= Date.now()) denied('DELEGATION_REVOKED', '元のOAuth許可が失効または取消されました。', 403);
}
/** Admin-host-only helper; never exposed as an MCP resource or tool result. */
export async function loadCoordinationDelegation(projectId: string, planId: string): Promise<TaskPrincipal> {
  assertId(projectId); assertId(planId);
  if (!coordinationProjectIds().includes(projectId)) denied('PILOT_SCOPE', '承認済みの実行プロジェクトを指定してください。');
  const id = delegationId(projectId, planId), stored = (await privateRef(id).get()).data() as CoordinationDelegation | undefined;
  if (!stored?.principal) return denied('DELEGATION_MISSING', '現在の認証済み計画から作業委任を保存してください。');
  const auth = { ...stored.principal, coordinationDelegationId: id, coordinationSourceAccessTokenExpiresAt: stored.sourceAccessTokenExpiresAt ?? stored.principal.expiresAt }; await assertCoordinationDelegation(auth, projectId); return auth;
}
/** Existing privileged local host advertises only policy-registered scopes; expiry proves liveness. */
export async function heartbeatCoordinationWorker(projectId: string, input: CoordinationWorkerHeartbeatInput) {
  assertId(projectId); assertId(input.worker_id);
  if (!coordinationProjectIds().includes(projectId)) denied('PILOT_SCOPE', '承認済みの実行プロジェクトを指定してください。');
  const seconds = input.ttl_seconds ?? 90;
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 180 || !Array.isArray(input.capability_ids) || !input.capability_ids.length || input.capability_ids.length > 30 || !Array.isArray(input.source_ids) || !input.source_ids.length || input.source_ids.length > 30) denied('INVALID_INPUT', '実行者の能力・資料範囲・有効時間を確認してください。', 422);
  return getAdminDb().runTransaction(async tx => {
    const projectRef = getAdminDb().doc(`projects/${projectId}`), project = (await tx.get(projectRef)).data();
    const policy = (await tx.get(projectRef.collection('mcpCoordination').doc('policy'))).data() as CoordinationPolicy | undefined;
    if (!project || project.isArchived || !policy) denied('POLICY_REQUIRED', '有効なプロジェクトと登録済みの実行方針が必要です。');
    const capabilities = input.capability_ids.map(id => policy!.capabilities.find(capability => capability.id === id));
    if (capabilities.some(capability => !capability || capability.executor !== 'local_worker' || !capability.scope.projectIds.includes(projectId)) || input.source_ids.some(id => !capabilities.some(capability => capability!.scope.sourceIds.includes(id)))) denied('EXECUTION_SCOPE', '登録済みの能力・資料範囲内で実行者を接続してください。');
    const now = new Date(); const heartbeat: CoordinationWorkerHeartbeat = { projectId, workerId: input.worker_id, capabilityIds: [...new Set(input.capability_ids)], sourceIds: [...new Set(input.source_ids)], seenAt: now.toISOString(), expiresAt: new Date(now.getTime() + seconds * 1000).toISOString() };
    tx.set(projectRef.collection('mcpCoordinationWorkers').doc(input.worker_id), heartbeat); return heartbeat;
  });
}
export async function stopCoordinationWorker(projectId: string, workerId: string) {
  assertId(projectId); assertId(workerId); if (!coordinationProjectIds().includes(projectId)) denied('PILOT_SCOPE', '承認済みの実行プロジェクトを指定してください。');
  await getAdminDb().runTransaction(async tx => { tx.delete(getAdminDb().doc(`projects/${projectId}/mcpCoordinationWorkers/${workerId}`)); });
}
export async function assertLiveCoordinationWorker(tx: Transaction, projectId: string, workerId: string, capability: CoordinationCapability, sourceId: string | undefined) {
  const worker = (await tx.get(getAdminDb().doc(`projects/${projectId}/mcpCoordinationWorkers/${workerId}`))).data() as CoordinationWorkerHeartbeat | undefined;
  if (!worker || worker.projectId !== projectId || !Number.isFinite(Date.parse(worker.expiresAt)) || Date.parse(worker.expiresAt) <= Date.now() || !worker.capabilityIds.includes(capability.id) || !sourceId || !worker.sourceIds.includes(sourceId) || !capability.scope.sourceIds.includes(sourceId)) denied('WORKER_UNAVAILABLE', '対象の実行環境が未接続・失効・資料範囲外です。人間待ちとして残してください。', 409);
}
