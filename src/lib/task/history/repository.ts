import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { readTaskPrivateSources } from './privateRepository';
import type { TaskHistoryPage } from './types';

export const ACTIVITY_PAGE_SIZE = 25;
export { activityEntry, historyDate } from './entries';
import { activityEntry } from './entries';

export function parseHistoryCursor(raw: string | null): { at: Timestamp; id: string } | null {
  if (!raw) return null;
  try {
    if (raw.length > 1000) throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (!Array.isArray(value) || value.length !== 3 || !Number.isSafeInteger(value[0]) || !Number.isSafeInteger(value[1]) || typeof value[2] !== 'string' || !/^[^/]{1,200}$/.test(value[2])) throw new Error();
    return { at: new Timestamp(value[0], value[1]), id: value[2] };
  } catch { throw new Error('INVALID_CURSOR'); }
}
export async function readTaskHistory(uid: string, projectId: string, taskId: string, rawCursor: string | null): Promise<TaskHistoryPage> {
  const cursor = parseHistoryCursor(rawCursor);
  const projectRef = getAdminDb().collection('projects').doc(projectId);
  const task = await projectRef.collection('tasks').doc(taskId).get();
  if (!task.exists) throw new Error('NOT_FOUND');
  const result: TaskHistoryPage = { entries: [], nextCursor: null, checkedAt: new Date().toISOString(), activityStatus: 'ready', issues: [] };
  const activity = async () => {
    // The task predicate MUST precede the limit. Project-wide recent history loses older task context.
    let query = projectRef.collection('activityLogs').where('targetType', '==', 'task').where('targetId', '==', taskId)
      .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(cursor.at, cursor.id);
    const page = await query.limit(ACTIVITY_PAGE_SIZE + 1).get();
    const docs = page.docs.slice(0, ACTIVITY_PAGE_SIZE);
    result.entries = docs.map(doc => activityEntry(doc.id, doc.data()));
    if (page.size > ACTIVITY_PAGE_SIZE) {
      const last = docs.at(-1)!; const at = last.data().createdAt;
      if (at instanceof Timestamp) result.nextCursor = Buffer.from(JSON.stringify([at.seconds, at.nanoseconds, last.id])).toString('base64url');
      else { result.activityStatus = 'error'; result.issues.push('古い履歴の日時形式を確認できません。'); }
    }
  };
  const privateSources = async () => {
    result.privateSources = await readTaskPrivateSources(uid, projectId, taskId, result.checkedAt);
  };
  const [activityRead, privateRead] = await Promise.allSettled([activity(), privateSources()]);
  if (activityRead.status === 'rejected') { result.activityStatus = 'error'; result.issues.push('このタスクの活動履歴を取得できません。再取得してください。'); }
  if (privateRead.status === 'rejected') result.privateSources = { entries: [], status: 'error', unavailableLinks: 0, issues: ['本人用のメール・Chatを取得できません。接続・権限を確認して再取得してください。'] };
  return result;
}
