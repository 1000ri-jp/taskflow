import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { mapTaskDataToTask, mapTaskToApiItem } from '@/lib/firebase/admin-projects';
import { TASK_CHANGE_FIELD } from './changeStamp';
import { asTimestamp, changeLowerBound, changeTime, decodeChangeCursor, encodeChangeCursor, TaskChangeError, timeIso } from './changeCursor';

const storedTimeIso = (value: unknown): string | null => {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Bounded state delta: pages share one readTime; subsequent rounds re-read an overlap. */
export async function listProjectTaskChanges(projectId: string, rawCursor: string | null, limit: number) {
  const cursor = decodeChangeCursor(rawCursor, projectId);
  const mode = cursor === null ? 'bootstrap' : cursor.kind === 'page' ? cursor.mode : 'delta';
  const from = cursor?.kind === 'checkpoint' ? changeLowerBound(cursor.at) : cursor?.kind === 'page' ? cursor.from : undefined;
  const db = getAdminDb();
  let query: Query = db.collection('projects').doc(projectId).collection('tasks');
  if (mode === 'delta') query = query.where(TASK_CHANGE_FIELD, '>=', asTimestamp(from!)).orderBy(TASK_CHANGE_FIELD, 'asc');
  query = query.orderBy(FieldPath.documentId(), 'asc');
  if (cursor?.kind === 'page') query = mode === 'delta' ? query.startAfter(asTimestamp(cursor.after.at!), cursor.after.id) : query.startAfter(cursor.after.id);
  query = query.limit(limit + 1);
  let snapshot;
  try {
    snapshot = await db.runTransaction(tx => tx.get(query), cursor?.kind === 'page' ? { readOnly: true, readTime: asTimestamp(cursor.at) } : { readOnly: true });
  } catch (error) {
    // Never silently advance a stale snapshot. The caller restarts from its completed checkpoint.
    if (cursor?.kind === 'page' && error instanceof Error && 'code' in error && (error.code === 9 || error.code === 3) && /read.?time|too old|snapshot/i.test(error.message)) throw new TaskChangeError('CURSOR_EXPIRED', 409);
    throw error;
  }
  const at = cursor?.kind === 'page' ? cursor.at : changeTime(snapshot.readTime);
  const docs = snapshot.docs.slice(0, limit);
  const tasks = docs.map(doc => {
    const data = doc.data();
    const task = mapTaskDataToTask(projectId, doc.id, data);
    return { ...mapTaskToApiItem(task), updatedAt: storedTimeIso(data.updatedAt), isArchived: task.isArchived,
      createdAt: storedTimeIso(data.createdAt),
      changeVersion: timeIso(changeTime(doc.updateTime)) };
  });
  const last = docs.at(-1);
  const nextCursor = snapshot.docs.length > limit && last ? encodeChangeCursor({ v: 1, project: projectId, kind: 'page', mode, at, ...(from ? { from } : {}),
    after: { id: last.id, ...(mode === 'delta' ? { at: changeTime(last.get(TASK_CHANGE_FIELD) as Timestamp) } : {}) } }) : null;
  return { tasks, nextCursor, checkpoint: nextCursor === null ? encodeChangeCursor({ v: 1, project: projectId, kind: 'checkpoint', at }) : null, snapshotAt: timeIso(at) };
}
