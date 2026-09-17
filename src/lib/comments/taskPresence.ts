'use client';
import { create } from 'zustand';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { taskHasComments } from '@/lib/firebase/firestore';

export type TaskCommentScope = { userId: string; projectId: string; taskId: string };
export type TaskCommentPresence =
  | { status: 'unknown' | 'loading' | 'error'; checkedAt: number }
  | { status: 'ready'; hasComments: boolean; checkedAt: number };
export const UNKNOWN_COMMENT_PRESENCE: TaskCommentPresence = { status: 'unknown', checkedAt: 0 };
export const COMMENT_PRESENCE_TTL = 60_000;
export const taskCommentPresenceKey = (scope: TaskCommentScope) => JSON.stringify([scope.userId, scope.projectId, scope.taskId]);
export const useTaskCommentPresenceStore = create<{ entries: Record<string, TaskCommentPresence> }>(() => ({ entries: {} }));
const pending = new Map<string, Promise<void>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
const isCurrentUser = (scope: TaskCommentScope) => useAuthStore.getState().user?.id === scope.userId;
function put(scope: TaskCommentScope, entry: TaskCommentPresence) {
  if (!isCurrentUser(scope)) return;
  const key = taskCommentPresenceKey(scope);
  useTaskCommentPresenceStore.setState(({ entries }) => {
    // Keep this nonpersistent display cache bounded in a long-lived app session.
    const next = { ...entries, [key]: entry };
    const oldest = Object.keys(next).sort((a, b) => next[a].checkedAt - next[b].checkedAt);
    for (const id of oldest.slice(0, Math.max(0, oldest.length - 1000))) if (!pending.has(id)) delete next[id];
    return { entries: next };
  });
}
export function publishTaskCommentPresence(scope: TaskCommentScope, hasComments: boolean) {
  put(scope, { status: 'ready', hasComments, checkedAt: Date.now() });
}
export function failTaskCommentPresence(scope: TaskCommentScope) {
  put(scope, { status: 'error', checkedAt: Date.now() });
}
function drain() {
  while (active < 3 && queue.length) {
    active++;
    void queue.shift()!().finally(() => { active--; drain(); });
  }
}
/** One bounded read per visible, stale task. No Firestore subscriptions or polling. */
export function ensureTaskCommentPresence(scope: TaskCommentScope): Promise<void> {
  if (!isCurrentUser(scope)) return Promise.resolve();
  const key = taskCommentPresenceKey(scope);
  if (pending.has(key)) return pending.get(key)!;
  const cached = useTaskCommentPresenceStore.getState().entries[key];
  if (cached?.status === 'ready' && Date.now() - cached.checkedAt < COMMENT_PRESENCE_TTL) return Promise.resolve();
  const token: TaskCommentPresence = { status: 'loading', checkedAt: Date.now() };
  put(scope, token);
  const result = new Promise<void>(resolve => {
    queue.push(async () => {
      try {
        // A detail stream can supply a newer result while this read is queued.
        if (!isCurrentUser(scope) || useTaskCommentPresenceStore.getState().entries[key] !== token) return;
        const exists = isE2EMockAuthEnabled()
          ? (await import('@/lib/task/detailMock')).readTaskDetailsMock(scope.projectId, scope.taskId).comments.length > 0
          : await taskHasComments(scope.projectId, scope.taskId);
        if (isCurrentUser(scope) && useTaskCommentPresenceStore.getState().entries[key] === token) publishTaskCommentPresence(scope, exists);
      } catch {
        if (isCurrentUser(scope) && useTaskCommentPresenceStore.getState().entries[key] === token) failTaskCommentPresence(scope);
      } finally { pending.delete(key); resolve(); }
    });
  });
  pending.set(key, result); drain();
  return result;
}
/** Ordered detail streams cannot prove absence when an old comment lacks createdAt. */
export function publishTaskCommentSnapshot(scope: TaskCommentScope, count: number, fromCache = false) {
  if (!isCurrentUser(scope) || fromCache) return;
  if (count > 0) { publishTaskCommentPresence(scope, true); return; }
  const key = taskCommentPresenceKey(scope);
  const current = useTaskCommentPresenceStore.getState().entries[key];
  if (current?.status === 'ready' && !current.hasComments && Date.now() - current.checkedAt < COMMENT_PRESENCE_TTL) return;
  // Supersede an older read; after it finishes, verify this newer empty snapshot.
  put(scope, UNKNOWN_COMMENT_PRESENCE);
  const before = pending.get(key);
  if (before) void before.then(() => ensureTaskCommentPresence(scope));
  else void ensureTaskCommentPresence(scope);
}
