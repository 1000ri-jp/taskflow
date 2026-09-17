import { createHash } from 'node:crypto';
import type { DocumentData, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { OrganizationError, validOrganizationId } from './organizationEngine';
import { organizationAccess } from './organizationRepository';
import { canonicalOrganizationValue } from './organizationIdentity';
import { planProjectMove, projectMoveTaskIds, type ProjectMoveInput, type ProjectMoveResult } from './projectMove';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonicalOrganizationValue(value))).digest('hex');
const fail = (message: string, status = 409): never => { throw new OrganizationError(message, status); };
const validateIds = (...ids: unknown[]) => { if (ids.some(id => !validOrganizationId(id))) fail('移動先・操作を確認してください。', 400); };
async function rows(tx: Transaction, ref: DocumentReference, collection: string, maximum = 500) {
  const snapshot = await tx.get(ref.collection(collection).limit(maximum + 1));
  if (snapshot.size > maximum) fail('関連データが多いため、一括で移動できません。変更は保存していません。');
  return Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
}
export async function projectMoveContext(uid: string, projectId: string, taskId: string) {
  validateIds(projectId, taskId);
  return getAdminDb().runTransaction(async tx => {
    const source = await organizationAccess(tx, uid, projectId);
    const task = await tx.get(source.ref.collection('tasks').doc(taskId));
    if (!task.exists) fail('タスクが見つかりません。', 404);
    const snapshot = await tx.get(getAdminDb().collection('projects').where('memberIds', 'array-contains', uid).limit(101));
    if (snapshot.size > 100) fail('プロジェクトの一覧を一度に取得できません。');
    const projects = [];
    for (const project of snapshot.docs) {
      if (project.id === projectId || project.data().isArchived) continue;
      try { await organizationAccess(tx, uid, project.id); } catch (error) { if (error instanceof OrganizationError && error.status === 403) continue; throw error; }
      const lists = await rows(tx, project.ref, 'lists', 100);
      projects.push({ id: project.id, name: project.data().name as string,
        lists: Object.entries(lists).sort(([,a],[,b]) => (a.order ?? 0) - (b.order ?? 0)).map(([id, list]) => ({ id, name: list.name as string })) });
    }
    return { currentName: snapshot.docs.find(p => p.id === projectId)?.data().name ?? '現在のプロジェクト', projects };
  });
}
export async function moveProjectTask(uid: string, projectId: string, taskId: string, input: ProjectMoveInput, apply: boolean) {
  validateIds(projectId, taskId, input.id, input.targetProjectId, input.listId);
  if (input.id.length > 80 || projectId === input.targetProjectId || apply && (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version))) fail('移動先・確認内容を選び直してください。', 400);
  return getAdminDb().runTransaction(async tx => {
    const db = getAdminDb();
    const source = await organizationAccess(tx, uid, projectId);
    const target = await organizationAccess(tx, uid, input.targetProjectId);
    const receiptRef = source.ref.collection('taskMoveReceipts').doc(input.id);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data()!;
      if (saved.uid !== uid || saved.taskId !== taskId || saved.targetProjectId !== input.targetProjectId || saved.listId !== input.listId || saved.version !== input.version) fail('同じ操作の保存記録が一致しません。');
      return saved.result as ProjectMoveResult;
    }
    const [tasks, targetTasks, lists, labels, tags, targetLabels, targetTags, milestones, targetProject] = await Promise.all([
      rows(tx, source.ref, 'tasks'), rows(tx, target.ref, 'tasks'), rows(tx, target.ref, 'lists', 100),
      rows(tx, source.ref, 'labels', 100), rows(tx, source.ref, 'tags', 100),
      rows(tx, target.ref, 'labels', 100), rows(tx, target.ref, 'tags', 100), rows(tx, source.ref, 'milestones', 100), tx.get(target.ref),
    ]);
    const list = lists[input.listId]; if (!list) fail('移動先のリストが見つかりません。');
    const ids = projectMoveTaskIds(tasks, taskId);
    const now = new Date();
    const plan = planProjectMove({ sourceId: projectId, targetId: input.targetProjectId, taskId, listId: input.listId,
      tasks, targetTasks, targetMembers: target.memberIds, targetList: list, labels, tags, targetLabels, targetTags, milestones: Object.values(milestones) }, input.id, now);
    const children: Record<string, DocumentData> = {}, history: Record<string, DocumentData> = {}, repeats: Record<string, DocumentData> = {};
    const pointers: Record<string, { projectId: string; taskId: string; commentId?: string }> = {};
    for (const id of ids) {
      const from = source.ref.collection('tasks').doc(id), to = target.ref.collection('tasks').doc(id);
      for (const collection of ['comments', 'attachments', 'checklists']) {
        // Also reject orphan data at the destination, so no old child is accidentally resurrected.
        const [records, existing] = await Promise.all([rows(tx, from, collection, 120), rows(tx, to, collection, 1)]);
        if (Object.keys(existing).length) fail('移動先に以前の関連記録が残っています。上書きせずに停止しました。');
        for (const [key, record] of Object.entries(records)) children[`tasks/${id}/${collection}/${key}`] = record;
      }
      const logs = await tx.get(source.ref.collection('activityLogs').where('targetId', '==', id).limit(121));
      if (logs.size > 120) fail('変更履歴が多いため、一括で移動できません。');
      for (const log of logs.docs) history[`moved-${hash(log.ref.path)}`] = { ...log.data(), projectId: input.targetProjectId };
      const recurrence = tasks[id].recurrence;
      if (recurrence) {
        validateIds(recurrence.seriesId);
        if (!Number.isSafeInteger(recurrence.occurrence) || recurrence.occurrence < 0) fail('繰り返しの記録を確認できません。');
        const key = `${recurrence.seriesId}-${recurrence.occurrence}`;
        const [before, after] = await Promise.all([tx.get(source.ref.collection('recurrenceReceipts').doc(key)), tx.get(target.ref.collection('recurrenceReceipts').doc(key))]);
        if (after.exists && (!before.exists || hash(after.data()) !== hash(before.data()))) fail('移動先に同じ繰り返しの記録があります。');
        if (before.exists) repeats[key] = before.data()!;
      }
      pointers[id] = { projectId: input.targetProjectId, taskId: id };
      for (const [reviewId, request] of Object.entries(tasks[id].reviewRequests ?? {}) as [string, { commentId: string }][]) {
        validateIds(reviewId, request.commentId);
        pointers[reviewId] = { projectId: input.targetProjectId, taskId: id, commentId: request.commentId };
        pointers[`review-${request.commentId}`] = pointers[reviewId];
      }
    }
    // All records, bounds and collisions are checked before any write is scheduled.
    for (const [id, log] of Object.entries(history)) {
      const existing = await tx.get(target.ref.collection('activityLogs').doc(id));
      if (existing.exists && hash(existing.data()) !== hash(log)) fail('移動先の履歴と一致しません。上書きせずに停止しました。');
    }
    const writeCount = Object.keys(plan.writes).length + ids.length + Object.keys(children).length * 2 + Object.keys(history).length + Object.keys(repeats).length + Object.keys(pointers).length + 3;
    if (writeCount > 450 || Buffer.byteLength(JSON.stringify({ tasks: ids.map(id => tasks[id]), children, history })) > 2_000_000) fail('コメント・添付・履歴が多いため、一括で移動できません。変更は保存していません。');
    const version = hash({ tasks: ids.map(id => tasks[id]), children, history, repeats, members: target.memberIds, list, labels, tags, targetLabels, targetTags });
    if (!apply) return { version, taskCount: ids.length, commentCount: Object.keys(children).filter(path => path.includes('/comments/')).length,
      attachmentCount: Object.keys(children).filter(path => path.includes('/attachments/')).length,
      checklistCount: Object.keys(children).filter(path => path.includes('/checklists/')).length, targetName: targetProject.data()!.name as string, listName: list.name as string };
    if (input.version !== version) fail('確認後にタスクや関連記録が更新されました。「内容を確認」から読み直してください。');
    const result = { projectId: input.targetProjectId, taskId };
    for (const [path, data] of Object.entries(plan.writes)) tx.set(db.doc(`${target.ref.path}/${path}`), data);
    for (const [path, data] of Object.entries(children)) { tx.set(db.doc(`${target.ref.path}/${path}`), data); tx.delete(db.doc(`${source.ref.path}/${path}`)); }
    for (const id of ids) tx.delete(source.ref.collection('tasks').doc(id));
    for (const [id, log] of Object.entries(history)) tx.set(target.ref.collection('activityLogs').doc(id), log);
    for (const [id, data] of Object.entries(repeats)) tx.set(target.ref.collection('recurrenceReceipts').doc(id), data);
    for (const [id, location] of Object.entries(pointers)) tx.set(source.ref.collection('taskMoves').doc(id), { ...location, movedAt: now });
    const log = { targetType: 'task', targetId: taskId, targetName: tasks[taskId].title, action: 'move', userId: uid, userName: 'メンバー',
      changes: [{ field: 'プロジェクト', oldValue: projectId, newValue: input.targetProjectId }], createdAt: now };
    for (const ref of [source.ref, target.ref]) tx.set(ref.collection('activityLogs').doc(`project-move-${input.id}`), { ...log, projectId: ref.id });
    tx.set(receiptRef, { uid, taskId, ...input, version, result, createdAt: now });
    return result;
  });
}

/** Old links reveal a destination only while the person can read each project. */
export async function locateMovedTask(uid: string, projectId: string, taskId: string) {
  validateIds(projectId, taskId);
  return getAdminDb().runTransaction(async tx => {
    let location: ProjectMoveResult & { commentId?: string } = { projectId, taskId };
    const visited = new Set<string>();
    for (let step = 0; step < 8; step++) {
      validateIds(location.projectId, location.taskId);
      const key = `${location.projectId}/${location.taskId}`;
      if (visited.has(key)) return null;
      visited.add(key);
      const ref = getAdminDb().doc(`projects/${location.projectId}`);
      const [project, members, task] = await Promise.all([tx.get(ref), tx.get(ref.collection('members').where('userId', '==', uid).limit(1)), tx.get(ref.collection('tasks').doc(location.taskId))]);
      if (!project.data()?.memberIds?.includes(uid) || !['admin', 'editor', 'viewer'].includes(members.docs[0]?.data().role)) return null;
      if (task.exists) return step ? location : null;
      const pointer = await tx.get(ref.collection('taskMoves').doc(location.taskId));
      if (!pointer.exists) return null;
      const saved = pointer.data()!;
      location = { projectId: saved.projectId, taskId: saved.taskId, ...(saved.commentId ? { commentId: saved.commentId } : {}) };
    }
    return null;
  });
}
