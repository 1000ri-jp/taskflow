import { getAuthHeaders } from '@/lib/firebase/authToken';
import { getFirebaseAuth } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { ReactionAction, ReactionList, ReactionTarget, CommentReaction, SeenStampId, StampSettings, CustomSeenStampId } from './reactions';

export async function stampRequest<T>(uid: string, path: string, data?: unknown, method?: 'DELETE'): Promise<T> {
  if (isE2EMockAuthEnabled()) return (await import('./mock')).mockStampRequest<T>(uid, path, data, method);
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('ログインを確認してください。');
  const headers = await getAuthHeaders();
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('ログインが変更されました。');
  const response = await fetch(path, { method: method ?? (data === undefined ? 'GET' : 'PUT'), headers, cache: 'no-store', signal: AbortSignal.timeout(15000), ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'スタンプを確認できませんでした。');
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('ログインが変更されました。');
  return result;
}

type Pending = { target: ReactionTarget; resolve: (data: ReactionList) => void; reject: (error: unknown) => void };
const queues = new Map<string, Pending[]>();
/** Batch comments entering the viewport together; no timer or requests when idle. */
export function fetchCommentReactions(uid: string, target: ReactionTarget): Promise<ReactionList> {
  return new Promise((resolve, reject) => {
    const key = JSON.stringify([uid, target.projectId, target.taskId]);
    const pending = queues.get(key);
    if (pending) { pending.push({ target, resolve, reject }); return; }
    const queue = [{ target, resolve, reject }];
    queues.set(key, queue);
    setTimeout(async () => {
      queues.delete(key);
      for (let offset = 0; offset < queue.length; offset += 20) {
        const batch = queue.slice(offset, offset + 20);
        const params = new URLSearchParams({ projectId: target.projectId, taskId: target.taskId });
        [...new Set(batch.map(item => item.target.commentId))].forEach(id => params.append('commentId', id));
        try {
          const result = await stampRequest<Record<string, ReactionList>>(uid, `/api/comment-reactions?${params}`);
          batch.forEach(item => result[item.target.commentId] ? item.resolve(result[item.target.commentId]) : item.reject(new Error('コメントが見つかりません。')));
        } catch (error) { batch.forEach(item => item.reject(error)); }
      }
    }, 40);
  });
}
export const putCommentReaction = (uid: string, action: ReactionAction) => stampRequest<{ reaction: CommentReaction | null }>(uid, '/api/comment-reactions', action);
export const fetchStampSettings = (uid: string) => stampRequest<StampSettings>(uid, '/api/comment-stamp-settings');
export const putStampSettings = (uid: string, seenStampId: SeenStampId) => stampRequest<StampSettings>(uid, '/api/comment-stamp-settings', { seenStampId });
export const deleteCustomStamp = (uid: string, id: CustomSeenStampId) => stampRequest<StampSettings>(uid, '/api/comment-stamp-settings/custom', { id }, 'DELETE');
export const stampSettingsKey = (uid: string) => ['comment-stamp-settings', uid] as const;

export async function uploadCustomStamp(uid: string, input: { id: CustomSeenStampId; name: string; file: File }): Promise<StampSettings> {
  if (isE2EMockAuthEnabled()) return (await import('./mock')).uploadMockStamp(uid, input);
  const ensureOwner = () => {
    if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('ログインが変更されました。画面を開き直してください。');
  };
  ensureOwner();
  const authHeaders = await getAuthHeaders();
  ensureOwner();
  const form = new FormData();
  form.set('id', input.id); form.set('name', input.name); form.set('file', input.file);
  // Let the browser supply the multipart boundary; retain only the auth header.
  const response = await fetch('/api/comment-stamp-settings/custom', {
    method: 'POST', headers: { Authorization: authHeaders.Authorization }, body: form,
    cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  ensureOwner();
  const result = await response.json();
  ensureOwner();
  if (!response.ok) throw new Error(result.error || 'スタンプの保存を確認できませんでした。');
  return result;
}
