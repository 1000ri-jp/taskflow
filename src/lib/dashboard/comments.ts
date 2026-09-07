import { getProjectLists, getRecentTaskComments, getUsersByIds } from '@/lib/firebase/firestore';
import type { Comment } from '@/types';

export const INBOX_COMMENT_LIMIT = 10;
export interface CommentTaskRef { id: string; projectId: string; listId: string }
export interface InboxComment {
  key: string;
  taskId: string;
  projectId: string;
  comment: Comment;
  authorName: string;
  listName: string;
}

export function commentTaskKey(task: { projectId: string; id: string }) {
  return JSON.stringify([task.projectId, task.id]);
}

export function commentPreview(comment: Pick<Comment, 'content' | 'attachments'>) {
  const content = comment.content.replace(/\s+/g, ' ').trim();
  if (!content) return comment.attachments?.length ? `添付ファイル ${comment.attachments.length}件` : '本文なし';
  const characters = Array.from(content);
  return characters.length > 100 ? `${characters.slice(0, 100).join('')}…` : content;
}

export async function loadDashboardComments(tasks: CommentTaskRef[], isCancelled: () => boolean = () => false) {
  const entries: { task: CommentTaskRef; comment: Comment }[] = [];
  let cursor = 0;
  let failedTasks = 0;
  const errorCodes = new Set<string>();
  // Bound parallel reads; do not keep one live listener open for every task.
  await Promise.all(Array.from({ length: Math.min(6, tasks.length) }, async () => {
    while (cursor < tasks.length && !isCancelled()) {
      const task = tasks[cursor++];
      try {
        const comments = await getRecentTaskComments(task.projectId, task.id, INBOX_COMMENT_LIMIT);
        if (!isCancelled()) entries.push(...comments.map((comment) => ({ task, comment })));
      } catch (error) {
        failedTasks++;
        errorCodes.add(error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown');
      }
    }
  }));
  if (isCancelled()) return { items: [], failedTasks, errorCodes: [...errorCodes], metadataIncomplete: false };
  const latest = entries.sort((a, b) => b.comment.createdAt.getTime() - a.comment.createdAt.getTime()
    || `${commentTaskKey(a.task)}:${a.comment.id}`.localeCompare(`${commentTaskKey(b.task)}:${b.comment.id}`))
    .slice(0, INBOX_COMMENT_LIMIT);
  const authorIds = [...new Set(latest.filter(({ comment }) => !comment.authorLabel).map(({ comment }) => comment.authorId))];
  const projectIds = [...new Set(latest.map(({ task }) => task.projectId))];
  let metadataIncomplete = false;
  const [users, lists] = await Promise.all([
    authorIds.length ? getUsersByIds(authorIds).catch(() => { metadataIncomplete = true; return []; }) : [],
    Promise.all(projectIds.map(async (projectId) => {
      try { return { projectId, lists: await getProjectLists(projectId) }; }
      catch { metadataIncomplete = true; return { projectId, lists: [] }; }
    })),
  ]);
  const userNames = new Map(users.map((user) => [user.id, user.displayName]));
  const listNames = new Map(lists.flatMap(({ projectId, lists }) => lists.map((list) => [JSON.stringify([projectId, list.id]), list.name])));
  const items: InboxComment[] = latest.map(({ task, comment }) => ({
    key: JSON.stringify([task.projectId, task.id, comment.id]),
    taskId: task.id,
    projectId: task.projectId,
    comment,
    authorName: comment.authorLabel || userNames.get(comment.authorId) || '投稿者名未取得',
    listName: listNames.get(JSON.stringify([task.projectId, task.listId])) || '列名未取得',
  }));
  return { items, failedTasks, errorCodes: [...errorCodes], metadataIncomplete };
}
