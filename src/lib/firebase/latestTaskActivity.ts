import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from './config';
import { historyDate } from '@/lib/task/history/entries';
import { recentActivityEntry } from '@/lib/task/history/recentChanges';
import type { HistoryEntry } from '@/lib/task/history/types';

export function subscribeToLatestTaskActivity(projectId: string, taskId: string, receive: (entry: HistoryEntry | null) => void, fail: (error: Error) => void) {
  const logs = collection(getFirebaseDb(), 'projects', projectId, 'activityLogs');
  let active = true;
  let stopFallback: (() => void) | undefined;
  const stop = onSnapshot(query(logs, where('targetType', '==', 'task'), where('targetId', '==', taskId), orderBy('createdAt', 'desc'), limit(1)), snapshot => {
    const row = snapshot.docs[0];
    if (active) receive(row ? recentActivityEntry(row.id, row.data()) : null);
  }, error => {
    if (!active) return;
    if (error.code !== 'failed-precondition') { fail(error); return; }
    // Older installations may not have the history composite index yet. Read only
    // this target's records with a single-field index; never limit before sorting.
    stopFallback = onSnapshot(query(logs, where('targetId', '==', taskId)), snapshot => {
      const rows = snapshot.docs.map(row => ({ id: row.id, data: row.data() })).filter(row => row.data.targetType === 'task');
      rows.sort((a, b) => (Date.parse(historyDate(b.data.createdAt) ?? '') || 0) - (Date.parse(historyDate(a.data.createdAt) ?? '') || 0) || b.id.localeCompare(a.id));
      if (active) receive(rows[0] ? recentActivityEntry(rows[0].id, rows[0].data) : null);
    }, error => { if (active) fail(error); });
  });
  return () => { active = false; stop(); stopFallback?.(); };
}
