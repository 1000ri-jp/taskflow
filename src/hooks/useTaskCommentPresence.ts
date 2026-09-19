'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { ensureTaskCommentPresence, taskCommentPresenceKey, UNKNOWN_COMMENT_PRESENCE, useTaskCommentPresenceStore } from '@/lib/comments/taskPresence';

export function useTaskCommentPresence(projectId: string, taskId: string) {
  const anchor = useRef<HTMLDivElement>(null);
  const userId = useAuthStore(state => state.user?.id ?? null);
  const [visible, setVisible] = useState(false);
  const key = userId ? taskCommentPresenceKey({ userId, projectId, taskId }) : '';
  const presence = useTaskCommentPresenceStore(state => state.entries[key] ?? UNKNOWN_COMMENT_PRESENCE);
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { Promise.resolve().then(() => setVisible(true)); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !userId) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void ensureTaskCommentPresence({ userId, projectId, taskId }); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [visible, userId, projectId, taskId]);
  return { anchor, presence };
}
