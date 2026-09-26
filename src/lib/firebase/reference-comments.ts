import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './config';
import type { ReferenceComment, CommentAttachment } from '@/types';

export type ReferenceCommentInput = { id: string; content: string; authorLabel: string; attachments: CommentAttachment[] };

export function subscribeToReferenceComments(projectId: string, referenceId: string, receive: (comments: ReferenceComment[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(collection(getFirebaseDb(), 'projects', projectId, 'references', referenceId, 'comments'), orderBy('createdAt', 'asc')), snapshot => {
    receive(snapshot.docs.map(item => {
      const data = item.data();
      return { ...data, id: item.id, referenceId, createdAt: data.createdAt?.toDate() ?? new Date(), updatedAt: data.updatedAt?.toDate() ?? new Date() } as ReferenceComment;
    }));
  }, onError);
}

// One document per post: histories can grow without enlarging the reference document.
// Retrying an uncertain acknowledgement uses the same ID and cannot add a second post.
export async function postReferenceComment(projectId: string, referenceId: string, input: ReferenceCommentInput) {
  const authorId = getFirebaseAuth().currentUser?.uid;
  if (!authorId) throw new Error('ログインしてください。');
  if (!input.content.trim() && !input.attachments.length) throw new Error('コメントを入力してください。');
  if (input.content.length > 20000) throw new Error('コメントは20000文字までです。');
  const db = getFirebaseDb();
  await runTransaction(db, async transaction => {
    const parent = await transaction.get(doc(db, 'projects', projectId, 'references', referenceId));
    if (!parent.exists() || parent.data().isArchived) throw new Error('関連情報が見つからないか、保管されています。');
    const target = doc(db, 'projects', projectId, 'references', referenceId, 'comments', input.id);
    const existing = await transaction.get(target);
    if (existing.exists()) {
      if (existing.data().authorId !== authorId) throw new Error('投稿を確認できませんでした。');
      return;
    }
    transaction.set(target, { referenceId, content: input.content.trim(), authorId, authorLabel: input.authorLabel, attachments: input.attachments, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}

export async function changeReferenceComment(projectId: string, referenceId: string, comment: ReferenceComment, content: string | null) {
  const db = getFirebaseDb();
  await runTransaction(db, async transaction => {
    const parent = await transaction.get(doc(db, 'projects', projectId, 'references', referenceId));
    if (!parent.exists() || parent.data().isArchived) throw new Error('関連情報が見つからないか、保管されています。');
    const target = doc(db, 'projects', projectId, 'references', referenceId, 'comments', comment.id);
    const current = await transaction.get(target);
    if (!current.exists() || current.data().updatedAt?.toMillis() !== comment.updatedAt.getTime()) throw new Error('コメントが更新されました。最新の内容を確認してください。');
    if (content === null) transaction.delete(target);
    else {
      if ((!content.trim() && !comment.attachments?.length) || content.length > 20000) throw new Error('コメントを確認してください。');
      transaction.update(target, { content: content.trim(), updatedAt: serverTimestamp() });
    }
  });
}
