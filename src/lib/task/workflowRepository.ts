import { expandTaskReviews, requiresReviewResponse } from './reviews';
import { prepareRecurrence } from './recurrenceRepository';
import { getAdminDb } from '@/lib/firebase/admin';
import { organizationAccess } from './organizationRepository';
import { planWorkflow, workflowReceipt, type WorkflowInput, type WorkflowReceipt } from './workflow';
import { OrganizationError, validOrganizationId } from './organizationEngine';
import type { Task } from '@/types';
import { FieldValue } from 'firebase-admin/firestore';

const date = (value: unknown) => value instanceof Date ? value : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() as Date : null;
export async function applyWorkflow(uid: string, projectId: string, taskId: string, input: WorkflowInput) {
  if (![taskId, input.id].every(validOrganizationId)) throw new OrganizationError('仕事と操作を確認してください。');
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const { ref, memberIds } = await organizationAccess(tx, uid, projectId);
    const receiptRef = ref.collection('activityLogs').doc(`workflow-${input.id}`);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()?.userId !== uid || receipt.data()?.targetId !== taskId || receipt.data()?.workflowAction !== input.action) throw new OrganizationError('操作の記録が一致しません。', 409);
      return { alreadyApplied: true, receipt: (receipt.data()?.receipt as WorkflowReceipt | undefined) ?? null };
    }
    const [snapshot, profile] = await Promise.all([tx.get(ref.collection('tasks').limit(501)), tx.get(db.doc(`users/${uid}`))]);
    if (snapshot.size > 500) throw new OrganizationError('関連する仕事をすべて確認できません。', 409);
    const tasks = expandTaskReviews(snapshot.docs.map(doc => {
      const data = doc.data();
      return { ...data, id: doc.id, projectId, updatedAt: date(data.updatedAt), createdAt: date(data.createdAt), completedAt: date(data.completedAt) } as Task;
    }));
    const task = tasks.find(t => t.id === taskId);
    if (!task) throw new OrganizationError('仕事が見つかりません。', 404);
    if (input.subtaskPatch?.assigneeIds?.some(id => !memberIds.includes(id) && !task.assigneeIds.includes(id))) throw new OrganizationError('現在のプロジェクトメンバーを選んでください。', 409);
    const now = new Date();
    let plan;
    try { plan = planWorkflow(task, tasks, uid, input, now); }
    catch (error) { throw new OrganizationError(error instanceof Error ? error.message : '操作を確認してください。', 409); }
    if (input.action === 'configure' && input.details?.milestoneId) {
      const milestone = await tx.get(ref.collection('milestones').doc(input.details.milestoneId));
      if (!milestone.exists) throw new OrganizationError('関連する節目を確認できません。', 409);
    }
    const reviewNotifications = task.taskKind === 'review_request' && task.sourceCommentId ? await Promise.all(task.assigneeIds.filter(id=>memberIds.includes(id)).map(async id=>({id,snap:await tx.get(db.doc(`notifications/${task.sourceCommentId}:${id}`))}))) : [];
    const notifiedUserIds = [...new Set(plan.recipients.filter(id => id !== uid && memberIds.includes(id)))];
    const resultReceipt = workflowReceipt(task, tasks, input, now, plan, notifiedUserIds);
    const userName = typeof profile.data()?.displayName === 'string' ? profile.data()!.displayName : 'メンバー';
    const repeat = plan.patch.isCompleted === true ? await prepareRecurrence(tx, ref.collection('tasks').doc(taskId), { ...task, ...plan.patch }, now) : () => {};
    repeat();
    if (task.reviewRecordId) {
      const parent = tasks.find(t => t.id === task.parentTaskId)!;
      const saved = parent.reviewRequests![task.reviewRecordId];
      tx.update(ref.collection('tasks').doc(parent.id), { [`reviewRequests.${task.reviewRecordId}`]: { ...saved, cycle: plan.patch.review ?? task.review, updatedAt: now.toISOString() }, updatedAt: now });
    } else tx.update(ref.collection('tasks').doc(taskId), { ...plan.patch, ...('clearTaskKind' in plan && plan.clearTaskKind ? { taskKind: FieldValue.delete() } : {}), updatedAt: now });
    const record = { projectId, targetType: 'task', targetId: taskId, targetName: task.title, action: 'update', userId: uid, userName, createdAt: now,
      workflowAction: input.action, sourceTaskId: task.parentTaskId ?? taskId,
      changes: [{ field: 'workEvent', newValue: plan.text }],
      before: Object.fromEntries([...new Set([...Object.keys(plan.patch), ...('clearTaskKind' in plan && plan.clearTaskKind ? ['taskKind'] : [])])].map(key => [key, task[key as keyof Task] ?? null])),
      after: plan.patch, receipt: resultReceipt };
    tx.set(receiptRef, record);
    if (task.parentTaskId) tx.set(ref.collection('activityLogs').doc(`workflow-parent-${input.id}`), { ...record, targetId: task.parentTaskId });
    if (task.taskKind === 'review_request' && task.sourceCommentId) {
      const updated = { ...task, ...plan.patch };
      for (const {id: reviewer, snap} of reviewNotifications) tx.set(db.doc(`notifications/${task.sourceCommentId}:${reviewer}`), {
        userId: reviewer, type: 'review_requested', title: '確認依頼', message: updated.review?.request ?? task.description,
        projectId, taskId: task.sourceCommentTaskId ?? task.parentTaskId, taskName: tasks.find(t => t.id === task.parentTaskId)?.title ?? task.title,
        ...(!snap.exists ? {isRead: false, createdAt: now} : {}),
        ...(input.action === 'resubmit' ? { isRead: false } : {}),
        data: { ...(updated.review?.urgency ? { urgency: updated.review.urgency } : {}), requiresResponse: requiresReviewResponse(updated, reviewer), commentId: task.sourceCommentId, sourceTaskId: task.sourceCommentTaskId ?? task.parentTaskId, reviewTaskId: task.id },
      }, { merge: true });
    }
    for (const recipient of notifiedUserIds) {
      tx.set(db.doc(`notifications/workflow-${input.id}-${recipient}`), {
        userId: recipient, type: 'task_bell', title: `${userName}さん：${plan.text.split('：')[0]}`, message: plan.text,
        projectId, taskId: plan.nextTaskId, taskName: tasks.find(t => t.id === plan.nextTaskId)?.title ?? task.title,
        senderId: uid, senderName: userName, isRead: false, createdAt: now, data: { workflow: true, reviewTaskId: taskId, ...(task.sourceCommentId ? { commentId: task.sourceCommentId, sourceTaskId: task.sourceCommentTaskId ?? task.parentTaskId } : {}) },
      });
    }
    return { alreadyApplied: false, receipt: resultReceipt };
  });
}
