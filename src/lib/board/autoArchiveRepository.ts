import { createHash } from 'node:crypto';
import { FieldPath, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { DEFAULT_AUTO_ARCHIVE_DAYS, validArchiveDays } from './autoArchivePreview';
import { archiveDate, planAutoArchive, type AutoArchiveTask } from './autoArchiveEngine';
import type { AutoArchiveRunResult, AutoArchiveSave, AutoArchiveView } from './autoArchiveTypes';
import { autoArchiveDay } from './autoArchiveSchedule';

export class AutoArchiveError extends Error { constructor(message: string, public status = 422) { super(message); } }
export const AUTO_ARCHIVE_TASK_LIMIT = 1000;
export const AUTO_ARCHIVE_WRITE_LIMIT = 200;
const PAGE_SIZE = 20;
type Setting = { version: 1; revision: number; days: number | null; mode: 'inherit' | 'custom'; updatedBy: string };
const validId = (value: unknown): value is string => typeof value === 'string' && /^[^/]{1,200}$/.test(value) && value !== '.' && value !== '..';
const defaultRef = (uid: string) => getAdminDb().doc(`users/${uid}/settings/autoArchive`);
const projectRef = (projectId: string) => getAdminDb().doc(`projects/${projectId}`);
const settingRef = (projectId: string) => projectRef(projectId).collection('settings').doc('autoArchive');
const runRef = (projectId: string) => projectRef(projectId).collection('settings').doc('autoArchiveRun');
function requireId(value: unknown) { if (!validId(value)) throw new AutoArchiveError('対象を確認してください。'); }
function setting(data: DocumentData | undefined, defaultUid?: string): Setting | null {
  if (!data) return null;
  const invalidMode = defaultUid !== undefined ? data.mode !== 'custom' : !['inherit', 'custom'].includes(data.mode);
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
    || !(data.days === null || validArchiveDays(data.days)) || !validId(data.updatedBy)
    || defaultUid !== undefined && data.updatedBy !== defaultUid || invalidMode) {
    throw new AutoArchiveError('自動アーカイブ設定を読み込めません。', 503);
  }
  return { version: 1, revision: data.revision, days: data.days, mode: data.mode, updatedBy: data.updatedBy };
}
const token = (...values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const memberQuery = (projectId: string, uid: string) => projectRef(projectId).collection('members').where('userId', '==', uid).limit(1);
async function roleFor(tx: Transaction, projectId: string, project: DocumentData, uid: string) {
  const members = await tx.get(memberQuery(projectId, uid));
  if (!Array.isArray(project.memberIds) || !project.memberIds.includes(uid)) return null;
  if (project.ownerId === uid) return 'admin';
  const role = members.docs[0]?.data().role;
  return ['admin', 'editor', 'viewer'].includes(role) ? role as string : null;
}
async function projectState(tx: Transaction, projectId: string) {
  const [projectDoc, overrideDoc, runDoc] = await Promise.all([tx.get(projectRef(projectId)), tx.get(settingRef(projectId)), tx.get(runRef(projectId))]);
  const project = projectDoc.data();
  if (!project) throw new AutoArchiveError('プロジェクトが見つかりません。', 404);
  if (!validId(project.ownerId)) throw new AutoArchiveError('プロジェクトの所有者を確認できません。', 503);
  const defaults = setting((await tx.get(defaultRef(project.ownerId))).data(), project.ownerId);
  const override = setting(overrideDoc.data());
  const mode = override?.mode ?? 'inherit';
  const effectiveDays = project.isArchived ? null : mode === 'custom' ? override!.days : defaults?.days ?? null;
  return { project, defaults, override, mode, effectiveDays, run: runDoc.data(), revision: token(project.ownerId, defaults, override) };
}
function lastRun(data: DocumentData | undefined): AutoArchiveView['lastRun'] {
  const at = archiveDate(data?.at)?.toISOString();
  if (!at || !Number.isSafeInteger(data?.archivedCount) || data!.archivedCount < 0) return null;
  return { at, archivedCount: data!.archivedCount, error: typeof data!.error === 'string' ? data!.error : null };
}
async function taskSnapshot(tx: Transaction, projectId: string) {
  const snapshot = await tx.get(projectRef(projectId).collection('tasks').limit(AUTO_ARCHIVE_TASK_LIMIT + 1));
  if (snapshot.size > AUTO_ARCHIVE_TASK_LIMIT) throw new AutoArchiveError(`タスクが${AUTO_ARCHIVE_TASK_LIMIT}件を超えるため、自動アーカイブを停止しています。`, 503);
  return snapshot;
}
const taskData = (id: string, data: DocumentData, projectId: string): AutoArchiveTask => ({ ...data, id, projectId: data.projectId ?? projectId });
const backgroundConfigured = () => process.env.TASK_AUTOMATION_SCHEDULED === 'true';

export async function readAutoArchive(uid: string, projectId: string | null): Promise<AutoArchiveView> {
  requireId(uid); if (projectId !== null) requireId(projectId);
  return getAdminDb().runTransaction(async tx => {
    const asOf = new Date();
    if (projectId === null) {
      const defaults = setting((await tx.get(defaultRef(uid))).data(), uid);
      return { projectId, revision: token(defaults), mode: 'custom', days: defaults ? defaults.days : DEFAULT_AUTO_ARCHIVE_DAYS,
        defaultDays: defaults?.days ?? null, effectiveDays: defaults?.days ?? null, configured: !!defaults, canEdit: true,
        scopeLabel: '自分が所有するプロジェクトの初期値', backgroundConfigured: backgroundConfigured(), asOf: asOf.toISOString(), preview: null, lastRun: null };
    }
    const state = await projectState(tx, projectId);
    const role = await roleFor(tx, projectId, state.project, uid);
    if (!role) throw new AutoArchiveError('このプロジェクトを閲覧する権限がありません。', 403);
    let preview: AutoArchiveView['preview'] = null;
    if (state.effectiveDays !== null) {
      const [tasks, lists] = await Promise.all([taskSnapshot(tx, projectId), tx.get(projectRef(projectId).collection('lists'))]);
      const names = new Map(lists.docs.map(doc => [doc.id, doc.data().name]));
      const result = planAutoArchive(tasks.docs.map(doc => taskData(doc.id, doc.data(), projectId)), projectId, state.effectiveDays, asOf);
      preview = { ...result, candidates: result.candidates.map(({ task, completedAt, elapsedDays }) => ({ id: task.id, title: task.title || '名称未設定のタスク', listName: names.get(task.listId ?? '') || 'リスト不明', completedAt: completedAt.toISOString(), elapsedDays })) };
    }
    return { projectId, revision: state.revision, mode: state.mode, days: state.override?.mode === 'custom' ? state.override.days : state.defaults ? state.defaults.days : DEFAULT_AUTO_ARCHIVE_DAYS,
      defaultDays: state.defaults?.days ?? null, effectiveDays: state.effectiveDays, configured: !!state.override || !!state.defaults, canEdit: role === 'admin' && !state.project.isArchived,
      scopeLabel: 'このプロジェクトの共有設定', backgroundConfigured: backgroundConfigured(), asOf: asOf.toISOString(), preview, lastRun: lastRun(state.run) };
  });
}

export async function saveAutoArchive(uid: string, input: AutoArchiveSave): Promise<AutoArchiveView> {
  requireId(uid);
  if (!input || typeof input !== 'object' || !(input.projectId === null || validId(input.projectId)) || !['inherit', 'custom'].includes(input.mode)
    || !(input.days === null || validArchiveDays(input.days)) || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)
    || input.projectId === null && input.mode !== 'custom') throw new AutoArchiveError('期間と設定対象を確認してください。');
  await getAdminDb().runTransaction(async tx => {
    let current: Setting | null; let revision: string;
    if (input.projectId === null) {
      current = setting((await tx.get(defaultRef(uid))).data(), uid); revision = token(current);
    } else {
      const state = await projectState(tx, input.projectId);
      const role = await roleFor(tx, input.projectId, state.project, uid);
      if (role !== 'admin' || state.project.isArchived) throw new AutoArchiveError('現在のプロジェクト管理権限を確認してください。', 403);
      current = state.override; revision = state.revision;
    }
    if (revision !== input.revision) throw new AutoArchiveError('設定が変更されました。読み直してください。', 409);
    tx.set(input.projectId === null ? defaultRef(uid) : settingRef(input.projectId), {
      version: 1, revision: (current?.revision ?? 0) + 1, mode: input.mode, days: input.mode === 'inherit' ? null : input.days, updatedBy: uid, updatedAt: new Date(),
    });
  });
  return readAutoArchive(uid, input.projectId);
}

async function processProject(projectId: string, callerUid?: string): Promise<{ archived: number; failed: boolean }> {
  return getAdminDb().runTransaction(async tx => {
    const state = await projectState(tx, projectId);
    if (callerUid && !await roleFor(tx, projectId, state.project, callerUid)) throw new AutoArchiveError('閲覧権限が変更されました。', 403);
    if (state.project.isArchived || state.effectiveDays === null) return { archived: 0, failed: false };
    const actor = state.mode === 'custom' ? state.override!.updatedBy : state.project.ownerId as string;
    const at = new Date();
    // A successful settings save advances the policy revision. All callers and
    // the scheduled worker share this transaction ledger, including empty runs.
    const day = autoArchiveDay(at);
    const policyRevision = token(state.project.ownerId, state.mode, state.mode === 'custom' ? state.override : [state.defaults, state.override]);
    const runStatus = { at, day, policyRevision };
    if (await roleFor(tx, projectId, state.project, actor) !== 'admin') {
      if (state.run?.day !== day || state.run?.policyRevision !== policyRevision || !state.run.error) tx.set(runRef(projectId), { ...runStatus, archivedCount: 0, error: '自動アーカイブを許可した管理者の権限が失効しています。現在の管理者が設定を保存し直してください。' });
      return { archived: 0, failed: true };
    }
    if (state.run?.day === day && state.run?.policyRevision === policyRevision) return { archived: 0, failed: !!state.run.error };
    let tasks: Awaited<ReturnType<typeof taskSnapshot>>;
    try { tasks = await taskSnapshot(tx, projectId); }
    catch (error) {
      if (!(error instanceof AutoArchiveError && error.status === 503)) throw error;
      tx.set(runRef(projectId), { ...runStatus, archivedCount: 0, error: error.message });
      return { archived: 0, failed: true };
    }
    const plan = planAutoArchive(tasks.docs.map(doc => taskData(doc.id, doc.data(), projectId)), projectId, state.effectiveDays, at);
    if (plan.candidates.length > AUTO_ARCHIVE_WRITE_LIMIT) {
      tx.set(runRef(projectId), { ...runStatus, archivedCount: 0, error: `対象が${AUTO_ARCHIVE_WRITE_LIMIT}件を超えるため、自動アーカイブを停止しています。期間を長くするか、対象を確認してください。` });
      return { archived: 0, failed: true };
    }
    // All settings, roles, and the entire task family snapshot were read before these writes.
    const refs = new Map(tasks.docs.map(doc => [doc.id, doc.ref]));
    for (const { task, completedAt, elapsedDays } of plan.candidates) {
      tx.update(refs.get(task.id)!, { isArchived: true, archivedAt: at, archivedBy: actor, updatedAt: at, autoArchiveCompletedAt: completedAt });
      tx.create(projectRef(projectId).collection('activityLogs').doc(), {
        projectId, targetType: 'task', targetId: task.id, targetName: task.title || '名称未設定のタスク', action: 'update', userId: actor, userName: '自動アーカイブ',
        changes: [{ field: 'アーカイブ', oldValue: '表示中', newValue: `完了から${elapsedDays}日経過（設定${state.effectiveDays}日）により自動アーカイブ` }], createdAt: at,
      });
    }
    tx.set(runRef(projectId), { ...runStatus, archivedCount: plan.candidates.length, error: null });
    return { archived: plan.candidates.length, failed: false };
  });
}

function cursorId(cursor: string | undefined) {
  if (cursor === undefined) return null;
  if (typeof cursor !== 'string' || !/^projects\/[^/]{1,200}$/.test(cursor) || !validId(cursor.slice(9))) throw new AutoArchiveError('実行位置を確認してください。');
  return cursor.slice(9);
}
async function runPage(uid?: string, cursor?: string): Promise<AutoArchiveRunResult> {
  if (uid !== undefined) requireId(uid);
  const after = cursorId(cursor);
  let query = getAdminDb().collection('projects').orderBy(FieldPath.documentId());
  if (uid) query = query.where('memberIds', 'array-contains', uid);
  if (after) query = query.startAfter(after);
  const page = await query.limit(PAGE_SIZE + 1).get();
  const projects = page.docs.slice(0, PAGE_SIZE);
  const result: AutoArchiveRunResult = { checked: 0, archived: 0, failed: 0, nextCursor: page.size > PAGE_SIZE ? `projects/${projects.at(-1)!.id}` : null };
  for (const project of projects) {
    result.checked++;
    try { const run = await processProject(project.id, uid); result.archived += run.archived; if (run.failed) result.failed++; }
    catch { result.failed++; }
  }
  return result;
}
export async function runAutoArchive(uid: string, cursor?: string): Promise<AutoArchiveRunResult> { return runPage(uid, cursor); }
export async function runAutoArchiveBatch(cursor?: string): Promise<AutoArchiveRunResult> { return runPage(undefined, cursor); }
