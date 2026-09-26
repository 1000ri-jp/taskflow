'use client';
import { useEffect, useState } from 'react';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { mutateOrganizationMock, readOrganizationMock } from '@/lib/task/organizationMock';
import { useAuthStore } from '@/stores/authStore';
import type { ReferenceComment } from '@/types';
import type { ReferenceCommentInput } from '@/lib/firebase/reference-comments';

export function useReferenceComments(projectId: string, referenceId: string) {
  const user = useAuthStore(state => state.user);
  const mock = isE2EMockAuthEnabled();
  const [comments, setComments] = useState<ReferenceComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const receive = (next: ReferenceComment[]) => { if (active) { setComments(next); setLoading(false); setError(''); } };
    if (mock) {
      const read = () => receive(readOrganizationMock(projectId).referenceComments?.[referenceId] ?? []);
      read();
      window.addEventListener('taskflow-work-updated', read);
      window.addEventListener('storage', read);
      unsubscribe = () => { window.removeEventListener('taskflow-work-updated', read); window.removeEventListener('storage', read); };
    } else {
      const fail = () => { if (active) { setLoading(false); setError('コメントを取得できませんでした。'); } };
      void import('@/lib/firebase/reference-comments').then(api => {
        if (active) unsubscribe = api.subscribeToReferenceComments(projectId, referenceId, receive, fail);
      }).catch(fail);
    }
    return () => { active = false; unsubscribe(); };
  }, [mock, projectId, referenceId, retry]);

  const post = async (input: ReferenceCommentInput) => {
    if (!user) throw new Error('ログインしてください。');
    if (mock) {
      await mutateOrganizationMock(projectId, state => {
        const reference = state.data.references?.[referenceId];
        if (!reference || reference.isArchived) throw new Error('関連情報が見つかりません。');
        state.referenceComments ??= {};
        const list = state.referenceComments[referenceId] ??= [];
        if (!list.some(comment => comment.id === input.id)) list.push({ ...input, referenceId, authorId: user.id, createdAt: new Date(), updatedAt: new Date() });
      });
    } else await (await import('@/lib/firebase/reference-comments')).postReferenceComment(projectId, referenceId, input);
  };
  const change = async (comment: ReferenceComment, content: string | null) => {
    if (mock) {
      await mutateOrganizationMock(projectId, state => {
        const list = state.referenceComments?.[referenceId] ?? [];
        const current = list.find(item => item.id === comment.id);
        if (!current || current.updatedAt.getTime() !== comment.updatedAt.getTime()) throw new Error('コメントが更新されました。最新の内容を確認してください。');
        if (content === null) state.referenceComments![referenceId] = list.filter(item => item.id !== comment.id);
        else { current.content = content.trim(); current.updatedAt = new Date(); }
      });
    } else await (await import('@/lib/firebase/reference-comments')).changeReferenceComment(projectId, referenceId, comment, content);
  };
  return { comments, loading, error, reload: () => setRetry(value => value + 1), post, change };
}
