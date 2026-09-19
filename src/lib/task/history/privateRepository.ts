import { getAdminDb } from '@/lib/firebase/admin';
import { isGoogleConfigured } from '@/lib/google/workspace/security';
import { cacheRef, connectionRef, type Connection } from '@/lib/google/workspace/oauth';
import { workspaceView } from '@/lib/google/workspace/repository';
import type { IncomingDecision } from '@/lib/secretary/incomingDecisions';
import { taskPrivateSources } from './privateSources';

/** Read only this viewer's grants, linkage records, and already-fetched Google cache.
 * No all-project secretary scan and no Gmail network/read-state mutation on task open. */
export async function readTaskPrivateSources(uid: string, projectId: string, taskId: string, checkedAt: string) {
  if (!isGoogleConfigured()) return taskPrivateSources([], { userId: uid, email: null, allowedProject: false, checkedAt }, `${projectId}/${taskId}`);
  const db = getAdminDb();
  const [settings, state, connection, cache] = await Promise.all([
    db.doc(`users/${uid}/settings/aiSettings`).get(), db.doc(`users/${uid}/secretary/state`).get(), connectionRef(uid).get(), cacheRef(uid).get(),
  ]);
  const allowed = settings.data()?.allowedProjectIds;
  const allowedProject = allowed === undefined || allowed === null || Array.isArray(allowed) && allowed.every(id => typeof id === 'string') && allowed.includes(projectId);
  const raw = state.data()?.incomingDecisions;
  if (raw !== undefined && !Array.isArray(raw)) throw new Error('Invalid private linkage state');
  const decisions = (raw ?? []) as IncomingDecision[];
  if (decisions.some(d => !d || !Array.isArray(d.related) || !Array.isArray(d.sources))) throw new Error('Invalid private linkage record');
  const google = workspaceView(connection.data() as Connection | undefined, cache.data() as Parameters<typeof workspaceView>[1]);
  return taskPrivateSources(decisions, { userId: uid, email: google.email, allowedProject, checkedAt,
    sources: { gmail: google.sources.gmail, chat: google.sources.chat } }, `${projectId}/${taskId}`);
}
