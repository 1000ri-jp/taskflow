import { getAdminDb } from '@/lib/firebase/admin';
import type { Transaction } from 'firebase-admin/firestore';
import { organizationAccess } from './organizationRepository';
import { OrganizationError } from './organizationEngine';
import type { TaskReviewRequest } from './reviews';
import { reviewTaskId, sourceCommentHref, validateCommentSubmission, type CommentSubmission } from '@/lib/task/commentSubmission';

const CommentSubmissionRejected = OrganizationError;

/** All-or-nothing parent conversation, notifications and retry receipt.
 * The activity record survives comment deletion, so retry never recreates a deleted
 * comment or overwrites a completed child task / a recipient's read notification.
 */
export async function submitTaskCommentRecord(uid: string, input: CommentSubmission) {
  return getAdminDb().runTransaction(tx => submitTaskCommentInTransaction(tx, uid, input));
}

/** Reuse the same comment, permission and receipt contract from composite saves. */
export async function submitTaskCommentInTransaction(tx: Transaction, uid: string, input: CommentSubmission) {
  let recipients: string[];
  try {recipients = validateCommentSubmission(input);} catch(e) {throw new CommentSubmissionRejected(e instanceof Error ? e.message : '投稿内容を確認してください。',422);}
  if (uid !== input.authorId) throw new CommentSubmissionRejected('投稿者が一致しません。',403);
  const db = getAdminDb();
  const projectRef = db.doc(`projects/${input.projectId}`);
  const parentRef = db.doc(`projects/${input.projectId}/tasks/${input.taskId}`);
  const commentRef = parentRef.collection('comments').doc(input.id);
  const receiptRef = projectRef.collection('activityLogs').doc(`comment-${input.id}`);
  const childId = input.review ? reviewTaskId(input.id) : null;
  await organizationAccess(tx, uid, input.projectId);
  const receipt = await tx.get(receiptRef);
  if (receipt.exists) {
    const saved = receipt.data()!;
    if (saved.userId !== input.authorId || saved.sourceTaskId !== input.taskId) throw new CommentSubmissionRejected('送信状態が一致しません。',409);
    return { commentId: input.id, reviewTaskId: saved.reviewTaskId as string | null, alreadySubmitted: true };
  }
  const [projectSnap, parentSnap, commentSnap] = await Promise.all([tx.get(projectRef), tx.get(parentRef), tx.get(commentRef)]);
  if (!projectSnap.exists || !parentSnap.exists) throw new CommentSubmissionRejected('プロジェクトまたは親タスクが見つかりません。');
  const project = projectSnap.data()!, parent = parentSnap.data()!;
  if (input.expectedTaskVersion !== undefined && (parent.updatedAt instanceof Date ? parent.updatedAt : parent.updatedAt?.toDate?.())?.toISOString() !== input.expectedTaskVersion) throw new CommentSubmissionRejected('仕事の情報が変わりました。確認内容を見直してください。');
  if (project.isArchived || parent.isArchived || input.review && (parent.isCompleted || parent.isAbandoned)) throw new CommentSubmissionRejected('アーカイブ済みのタスクには投稿できません。');
  if (commentSnap.exists) throw new CommentSubmissionRejected('同じ投稿IDが既に存在します。画面のコメントを確認してください。',409);
  const allowedMembers: unknown[] = Array.isArray(project.memberIds) ? project.memberIds : [];
  if (recipients.some(id => !allowedMembers.includes(id))) throw new CommentSubmissionRejected('プロジェクトに参加していない通知先・依頼先が含まれています。');
  if (parent.parentTaskId) throw new CommentSubmissionRejected('やりとりは親タスクから投稿してください。');
  if (input.review?.nextTaskId) {
    const next = await tx.get(projectRef.collection('tasks').doc(input.review.nextTaskId));
    if (!next.exists || next.data()!.isArchived || next.data()!.isAbandoned || next.data()!.isCompleted) throw new CommentSubmissionRejected('確認後の仕事を選び直してください。');
  }
  if (input.review && (Object.keys(parent.reviewRequests ?? {}).length >= 200 || JSON.stringify(parent.reviewRequests ?? {}).length > 300000)) throw new CommentSubmissionRejected('このタスクの確認履歴が多いため、新しい親タスクで続けてください。既存の履歴は残ります。',422);
  const time = new Date();
  const content = input.content.trim() || (input.review ? `確認依頼：${input.review.content.trim()}` : '');
  const requestTitle = input.review ? `確認依頼：${input.review.content.trim().split(/\r?\n/)[0].slice(0,100)}` : '';
  tx.set(commentRef, {
    taskId: input.taskId, content, authorId: input.authorId, authorLabel: input.authorName,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    authorIcon: null, mentions: recipients, attachments: input.attachments,
    ...(childId ? { reviewTaskId: childId } : {}), createdAt: time, updatedAt: time,
  });
  if (input.review && childId) {
    const request: TaskReviewRequest = { commentId: input.id, assigneeIds: [...new Set(input.review.assigneeIds)], dueDate: input.review.dueDate,
      createdBy: uid, createdAt: time.toISOString(), updatedAt: time.toISOString(),
      cycle: { ...(input.review.urgency ? { urgency: input.review.urgency } : {}), policy: input.review.policy ?? 'any', round: 1, request: input.review.content.trim(), attachments: input.attachments, requestedAt: time.toISOString(), responses: {}, nextTaskId: input.review.nextTaskId ?? null } };
    tx.update(parentRef, { [`reviewRequests.${childId}`]: request, updatedAt: time });
  }
  recipients.forEach(userId => {
    const isReviewer = Boolean(input.review?.assigneeIds.includes(userId));
    const notificationId = `${input.id}:${userId}`;
    tx.set(db.doc(`notifications/${notificationId}`), {
      userId, type: isReviewer ? 'review_requested' : 'comment_added',
      title: isReviewer ? `${input.authorName}さんから確認依頼` : `${input.authorName}さんからコメント`,
      message: isReviewer ? input.review!.content.trim() : content || '添付ファイルがあります',
      projectId: input.projectId, projectName: project.name,
      taskId: input.taskId, taskName: parent.title,
      senderId: input.authorId, senderName: input.authorName, isRead: false,
      data: { ...(isReviewer && input.review?.urgency ? { urgency: input.review.urgency } : {}), ...(isReviewer && input.review?.dueDate ? { dueDate: input.review.dueDate } : {}), requiresResponse: isReviewer, reviewTaskId: childId, commentId: input.id, sourceTaskId: input.taskId, sourceCommentHref: sourceCommentHref(input.projectId, input.taskId, input.id) },
      createdAt: time,
    });
  });
  tx.set(receiptRef, {
    projectId: input.projectId, targetType: 'task', targetId: input.taskId,
    targetName: childId ? requestTitle : parent.title, action: childId ? 'create' : 'update',
    userId: input.authorId, userName: input.authorName, createdAt: time,
    sourceTaskId: input.taskId, commentId: input.id, reviewTaskId: childId,
    changes: [{ field: 'comment', newValue: childId ? '親タスクに確認依頼を登録' : 'コメントを投稿' }],
  });
  return { commentId: input.id, reviewTaskId: childId, alreadySubmitted: false };
}
