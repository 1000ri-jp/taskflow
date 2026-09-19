import { isValid, parseISO } from 'date-fns';
import type { CommentAttachment, CommentPurpose, Notification } from '@/types';

export const COMMENT_PURPOSE_LABELS: Record<CommentPurpose, string> = {
  memo: '共有メモ・報告',
  review_request: '確認依頼',
};

export interface ReviewRequestInput {
  urgency?: 'urgent';
  policy?: 'any' | 'all';
  nextTaskId?: string | null;
  content: string;
  assigneeIds: string[];
  dueDate: string | null;
}
export interface CommentSubmission {
  id: string;
  projectId: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  notifyIds: string[];
  expectedTaskVersion?: string;
  purpose?: CommentPurpose; // Optional for pending submissions created by older versions.
  review: ReviewRequestInput | null;
  attachments: CommentAttachment[];
}
export const validDocumentId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export const reviewTaskId = (submissionId: string) => `review-${submissionId}`;
export const sourceCommentHref = (projectId: string, taskId: string, commentId: string) => `/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(taskId)}&comment=${encodeURIComponent(commentId)}`;
export function notificationTaskHref(notification: Pick<Notification, 'projectId' | 'taskId' | 'type' | 'data'>) {
  const base = `/projects/${encodeURIComponent(notification.projectId)}/board`;
  if (!notification.taskId) return base;
  const commentId = notification.data?.commentId;
  const sourceId = notification.data?.sourceTaskId;
  return validDocumentId(commentId) && (notification.type === 'comment_added' || validDocumentId(sourceId))
    ? sourceCommentHref(notification.projectId, validDocumentId(sourceId) ? sourceId : notification.taskId, commentId)
    : `${base}?task=${encodeURIComponent(notification.taskId)}`;
}
export function validateCommentSubmission(input: CommentSubmission) {
  if (!input || typeof input !== 'object') throw new Error('投稿内容を読み込めません。');
  if (![input.id, input.projectId, input.taskId, input.authorId].every(validDocumentId)) throw new Error('投稿先を確認し、タスクを開き直してください。');
  if (typeof input.authorName !== 'string' || !input.authorName.trim() || input.authorName.length > 200) throw new Error('投稿者名を確認してください。');
  if (input.expectedTaskVersion !== undefined && (typeof input.expectedTaskVersion !== 'string' || !isValid(parseISO(input.expectedTaskVersion)))) throw new Error('元の仕事の状態を確認してください。');
  if (typeof input.content !== 'string' || input.content.length > 20000) throw new Error('コメントは20,000文字以内にしてください。');
  if (input.purpose !== undefined && (input.purpose !== 'memo' && input.purpose !== 'review_request'
    || (input.purpose === 'review_request') !== Boolean(input.review))) throw new Error('投稿の用途と確認依頼の内容が一致しません。用途を選び直してください。');
  if (!Array.isArray(input.notifyIds) || !input.notifyIds.every(validDocumentId)) throw new Error('通知先を選び直してください。');
  if (!Array.isArray(input.attachments) || input.attachments.length > 10) throw new Error('添付は10件までです。');
  if (input.attachments.some(file => {
    if (!file || !validDocumentId(file.id) || typeof file.name !== 'string' || !file.name || typeof file.type !== 'string' || !Number.isFinite(file.size) || file.size < 0) return true;
    try { return typeof file.url !== 'string' || new URL(file.url).protocol !== 'https:'; } catch { return true; }
  })) throw new Error('添付情報を確認してください。');
  if (input.review) {
    if (input.review.urgency !== undefined && input.review.urgency !== 'urgent') throw new Error('至急の指定を確認してください。');
    if (input.review.policy !== undefined && !['any','all'].includes(input.review.policy)) throw new Error('確認の完了条件を選び直してください。');
    if (input.review.nextTaskId != null && (!validDocumentId(input.review.nextTaskId) || input.review.nextTaskId === input.taskId)) throw new Error('確認後の仕事を選び直してください。');
    if (typeof input.review.content !== 'string' || !input.review.content.trim() || input.review.content.length > 2000) throw new Error('依頼内容を1〜2,000文字で入力してください。');
    if (!Array.isArray(input.review.assigneeIds) || !input.review.assigneeIds.length || !input.review.assigneeIds.every(validDocumentId)) throw new Error('確認依頼の担当者を選んでください。');
    if (input.review.dueDate !== null && (typeof input.review.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.review.dueDate) || !isValid(parseISO(input.review.dueDate)))) throw new Error('確認依頼の期限を正しい日付で入力してください。');
  }
  const recipients = [...new Set([...input.notifyIds, ...(input.review?.assigneeIds ?? [])])];
  if (recipients.length > 30) throw new Error('通知先・依頼先は合わせて30人までです。');
  if (!input.content.trim() && !input.review && !input.attachments.length) throw new Error('コメントまたは添付を入力してください。');
  return recipients;
}

export const pendingCommentKey = (authorId: string, projectId: string, taskId: string) => `taskflow.pendingComment.v1:${JSON.stringify([authorId, projectId, taskId])}`;
export function loadPendingComment(authorId: string, projectId: string, taskId: string): CommentSubmission | null {
  const raw = sessionStorage.getItem(pendingCommentKey(authorId, projectId, taskId));
  if (!raw) return null;
  const value = JSON.parse(raw) as CommentSubmission;
  validateCommentSubmission(value);
  if (value.authorId !== authorId || value.projectId !== projectId || value.taskId !== taskId) throw new Error('送信状態の保存先が一致しません。');
  return value;
}
