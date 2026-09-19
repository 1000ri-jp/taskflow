import { taskEditChanges } from './history/recentChanges';
import { completionBlockReason } from './completion';
import { assertTaskDates, hasTaskDateChange } from './dateValidation';
import { OrganizationError } from './organizationEngine';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Task } from '@/types';
import { nextRecurrence, repeatTask, repeatChecklist, validRecurrence, type RecurrenceSettings } from './recurrence';

/** All reads happen before the returned writer. The receipt also survives deletion/reopening of a task. */
export async function prepareRecurrence(tx: Transaction, ref: DocumentReference, source: Task, now: Date) {
  if (!source.recurrence) return () => {};
  let next;
  try { next = repeatTask(source, now); } catch (error) { throw new OrganizationError(error instanceof Error ? error.message : '繰り返し設定を確認してください。',409); }
  if (!next) return () => {};
  const projectRef = getAdminDb().doc(`projects/${source.projectId}`);
  const receiptRef = projectRef.collection('recurrenceReceipts').doc(`${source.recurrence.seriesId}-${source.recurrence.occurrence}`);
  const nextRef = projectRef.collection('tasks').doc(next.id);
  const [receipt, existing, list, checklists] = await Promise.all([
    tx.get(receiptRef), tx.get(nextRef), tx.get(projectRef.collection('lists').doc(next.task.listId)), tx.get(ref.collection('checklists').limit(101)),
  ]);
  if (receipt.exists) {
    if (receipt.data()?.sourceTaskId !== source.id) throw new OrganizationError('繰り返し元のタスクが一致しません。',409);
    return () => {};
  }
  if (existing.exists || !list.exists || checklists.size > 100) throw new OrganizationError('次回タスクの作成先・チェックリストを確認できません。繰り返し設定を見直してください。',409);
  return () => {
    tx.set(nextRef, next.task);
    for (const checklist of checklists.docs) tx.set(nextRef.collection('checklists').doc(checklist.id), repeatChecklist(checklist.data(), next.id, next.shiftDays, now));
    tx.set(receiptRef, { sourceTaskId:source.id, nextTaskId:next.id, createdAt:now });
  };
}
export async function updateTaskWithRecurrence(ref: DocumentReference, patch: Record<string, unknown>) {
  const db = getAdminDb();
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref); if (!snapshot.exists) throw new Error('タスクが見つかりません。');
    const source = { ...snapshot.data(), id:ref.id, projectId:ref.parent.parent!.id } as Task;
    if (patch.isCompleted === true) await assertCanComplete(tx, ref, source);
    const updated = { ...source, ...patch } as Task;
    if (hasTaskDateChange(patch)) assertTaskDates(updated);
    const repeat = patch.isCompleted === true ? await prepareRecurrence(tx, ref, updated, new Date()) : () => {};
    tx.update(ref, patch); repeat();
  });
}
export async function saveRecurrence(uid: string, projectId: string, taskId: string, expectedVersion: string, settings: RecurrenceSettings | null) {
  // Lazy import avoids a cycle when organization adoption itself completes a recurring task.
  const { organizationAccess } = await import('./organizationRepository');
  const { OrganizationError, validOrganizationId } = await import('./organizationEngine');
  if (!validOrganizationId(taskId) || typeof expectedVersion !== 'string' || settings !== null && (!validRecurrence({ ...settings, occurrence:0 }) || Object.keys(settings).some(k => !['seriesId','unit','interval','anchorDate','endDate','listId'].includes(k)))) throw new OrganizationError('繰り返し設定を確認してください。');
  return getAdminDb().runTransaction(async tx => {
    const { ref } = await organizationAccess(tx, uid, projectId);
    const taskRef = ref.collection('tasks').doc(taskId), snapshot = await tx.get(taskRef);
    const task = snapshot.data(); if (!task) throw new OrganizationError('タスクが見つかりません。',404);
    const updated = task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt?.toDate?.().toISOString();
    // Retrying the exact saved settings is harmless even after a lost response.
    if (settings && task.recurrence?.seriesId === settings.seriesId) {
      if (Object.entries(settings).some(([key,value]) => task.recurrence[key] !== value) || task.recurrence.occurrence !== 0) throw new OrganizationError('設定が変更されています。開き直してください。',409);
      return task.recurrence;
    }
    if (settings === null && task.recurrence == null) return null;
    if (updated !== expectedVersion) throw new OrganizationError('タスクが更新されています。閉じて開き直してから設定してください。',409);
    if (task.parentTaskId || task.isCompleted || task.isArchived || task.isAbandoned || task.taskKind === 'review_request') throw new OrganizationError('未完了の通常タスクに設定してください。');
    if (validRecurrence(task.recurrence)) {
      const receipt = await tx.get(ref.collection('recurrenceReceipts').doc(`${task.recurrence.seriesId}-${task.recurrence.occurrence}`));
      if (receipt.exists) throw new OrganizationError('次回分が作成済みです。次回タスクの繰り返し設定を変更してください。');
    }
    if (settings) {
      const list = await tx.get(ref.collection('lists').doc(settings.listId));
      if (!list.exists || list.data()?.autoCompleteOnEnter) throw new OrganizationError('次回分には、完了扱いにならないリストを選んでください。');
      nextRecurrence({ ...settings, occurrence:0 });
    }
    const recurrence = settings ? { ...settings, occurrence:0 } : null;
    tx.update(taskRef, { recurrence, updatedAt:new Date() });
    return recurrence;
  });
}

export async function completeFromBoard(uid: string, projectId: string, taskId: string, raw: Record<string, unknown>) {
  const { organizationAccess } = await import('./organizationRepository');
  const { OrganizationError, validOrganizationId } = await import('./organizationEngine');
  if (!validOrganizationId(taskId) || !raw || typeof raw !== 'object' || Array.isArray(raw) || raw.isCompleted !== true
    || Object.keys(raw).some(k => !['isCompleted','completedAt','listId','order','startDate'].includes(k))
    || raw.listId !== undefined && !validOrganizationId(raw.listId)
    || raw.order !== undefined && (typeof raw.order !== 'number' || !Number.isFinite(raw.order))
    || raw.startDate !== undefined && raw.startDate !== null && (typeof raw.startDate !== 'string' || !Number.isFinite(Date.parse(raw.startDate)))) throw new OrganizationError('完了するタスクの内容を確認してください。');
  await getAdminDb().runTransaction(async tx => {
    const { ref } = await organizationAccess(tx, uid, projectId);
    const taskRef = ref.collection('tasks').doc(taskId), snapshot = await tx.get(taskRef);
    const data = snapshot.data(); if (!data || data.isArchived || data.taskKind === 'review_request') throw new OrganizationError('タスクの状態を確認してください。');
    await assertCanComplete(tx, taskRef, { ...data, id: taskId, projectId } as Task);
    if (raw.listId) { const list = await tx.get(ref.collection('lists').doc(raw.listId as string)); if (!list.exists) throw new OrganizationError('移動先のリストが見つかりません。'); }
    const now = new Date();
    const patch = { ...raw, completedAt:data.isCompleted ? data.completedAt ?? now : now, updatedAt:now, ...(raw.startDate !== undefined ? { startDate:raw.startDate ? new Date(raw.startDate as string) : null } : {}) };
    if (hasTaskDateChange(patch)) assertTaskDates({ ...data, ...patch });
    const repeat = await prepareRecurrence(tx, taskRef, { ...data, ...patch, id:taskId, projectId } as Task, now);
    const changes = taskEditChanges(data, patch);
    const person = changes.length ? (await tx.get(getAdminDb().doc(`users/${uid}`))).data() : null;
    tx.update(taskRef, patch); repeat();
    if (changes.length) tx.set(ref.collection('activityLogs').doc(`complete-${crypto.randomUUID()}`), {
      projectId, targetType: 'task', targetId: taskId, targetName: data.title || '',
      action: data.isCompleted ? 'update' : 'complete', userId: uid, userName: person?.displayName || 'メンバー',
      changes, createdAt: now,
    });
  });
}

async function assertCanComplete(tx: Transaction, ref: DocumentReference, task: Task) {
  const snapshot = await tx.get(ref.parent.limit(501));
  if (snapshot.size > 500) throw new OrganizationError('関連する仕事をすべて確認できません。',409);
  const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, projectId: task.projectId }) as Task);
  const reason = completionBlockReason(task, tasks);
  if (reason) throw new OrganizationError(reason,409);
}
