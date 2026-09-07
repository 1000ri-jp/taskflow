import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { parseISO } from 'date-fns';
import { getFirebaseAuth, getFirebaseDb } from './config';
import { reviewTaskId, sourceCommentHref, validateCommentSubmission, type CommentSubmission } from '@/lib/task/commentSubmission';

export class CommentSubmissionRejected extends Error {
  readonly code = 'submission-rejected';
}

/** All-or-nothing comment, shared child task, notifications and retry receipt.
 * The activity record survives comment deletion, so retry never recreates a deleted
 * comment or overwrites a completed child task / a recipient's read notification.
 */
export async function submitTaskComment(input: CommentSubmission) {
  const recipients = validateCommentSubmission(input);
  const auth = getFirebaseAuth();
  if (!auth.currentUser || auth.currentUser.uid !== input.authorId) throw new Error('ログイン状態が変わりました。タスクを開き直してください。');
  const db = getFirebaseDb();
  const projectRef = doc(db, 'projects', input.projectId);
  const parentRef = doc(db, 'projects', input.projectId, 'tasks', input.taskId);
  const commentRef = doc(db, 'projects', input.projectId, 'tasks', input.taskId, 'comments', input.id);
  const receiptRef = doc(db, 'projects', input.projectId, 'activityLogs', `comment-${input.id}`);
  const childId = input.review ? reviewTaskId(input.id) : null;
  return runTransaction(db, async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists()) {
      const saved = receipt.data();
      if (saved.userId !== input.authorId || saved.sourceTaskId !== input.taskId) throw new Error('送信状態が一致しません。');
      return { commentId: input.id, reviewTaskId: saved.reviewTaskId as string | null, alreadySubmitted: true };
    }
    const [projectSnap, parentSnap, commentSnap] = await Promise.all([tx.get(projectRef), tx.get(parentRef), tx.get(commentRef)]);
    if (!projectSnap.exists() || !parentSnap.exists()) throw new CommentSubmissionRejected('プロジェクトまたは親タスクが見つかりません。');
    const project = projectSnap.data(), parent = parentSnap.data();
    if (project.isArchived || parent.isArchived) throw new CommentSubmissionRejected('アーカイブ済みのタスクには投稿できません。');
    if (commentSnap.exists()) throw new Error('同じ投稿IDが既に存在します。画面のコメントを確認してください。');
    const allowedMembers: unknown[] = Array.isArray(project.memberIds) ? project.memberIds : [];
    if (recipients.some(id => !allowedMembers.includes(id))) throw new CommentSubmissionRejected('プロジェクトに参加していない通知先・依頼先が含まれています。');
    if (auth.currentUser?.uid !== input.authorId) throw new Error('ログイン状態が変わりました。');
    const time = serverTimestamp();
    const content = input.content.trim() || (input.review ? `確認依頼：${input.review.content.trim()}` : '');
    const requestTitle = input.review ? `確認依頼：${input.review.content.trim().split(/\r?\n/)[0].slice(0,100)}` : '';
    tx.set(commentRef, {
      taskId: input.taskId, content, authorId: input.authorId, authorLabel: input.authorName,
      authorIcon: null, mentions: recipients, attachments: input.attachments,
      ...(childId ? { reviewTaskId: childId } : {}), createdAt: time, updatedAt: time,
    });
    if (input.review && childId) {
      tx.set(doc(db, 'projects', input.projectId, 'tasks', childId), {
        projectId: input.projectId, listId: parent.listId, parentTaskId: input.taskId,
        taskKind: 'review_request', sourceCommentId: input.id,
        title: requestTitle, description: input.review.content.trim(),
        order: Date.now(), assigneeIds: [...new Set(input.review.assigneeIds)],
        labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
        startDate: null, dueDate: input.review.dueDate ? Timestamp.fromDate(parseISO(input.review.dueDate)) : null,
        durationDays: null, isDueDateFixed: Boolean(input.review.dueDate),
        isCompleted: false, completedAt: null, isAbandoned: false,
        isArchived: false, archivedAt: null, archivedBy: null,
        createdBy: input.authorId, createdAt: time, updatedAt: time,
      });
    }
    recipients.forEach(userId => {
      const isReviewer = Boolean(input.review?.assigneeIds.includes(userId));
      const notificationId = `${input.id}:${userId}`;
      tx.set(doc(db, 'notifications', notificationId), {
        userId, type: isReviewer ? 'review_requested' : 'comment_added',
        title: isReviewer ? `${input.authorName}さんから確認依頼` : `${input.authorName}さんからコメント`,
        message: isReviewer ? input.review!.content.trim() : content || '添付ファイルがあります',
        projectId: input.projectId, projectName: project.name,
        taskId: isReviewer ? childId : input.taskId, taskName: isReviewer ? requestTitle : parent.title,
        senderId: input.authorId, senderName: input.authorName, isRead: false,
        data: { commentId: input.id, sourceTaskId: input.taskId, sourceCommentHref: sourceCommentHref(input.projectId, input.taskId, input.id) },
        createdAt: time,
      });
    });
    tx.set(receiptRef, {
      projectId: input.projectId, targetType: 'task', targetId: childId ?? input.taskId,
      targetName: childId ? requestTitle : parent.title, action: childId ? 'create' : 'update',
      userId: input.authorId, userName: input.authorName, createdAt: time,
      sourceTaskId: input.taskId, commentId: input.id, reviewTaskId: childId,
      changes: [{ field: 'comment', newValue: childId ? 'コメントと確認依頼を登録' : 'コメントを投稿' }],
    });
    return { commentId: input.id, reviewTaskId: childId, alreadySubmitted: false };
  });
}
