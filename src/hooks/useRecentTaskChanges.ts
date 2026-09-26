"use client";
import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { recentActivityEntry, recentChangeText } from '@/lib/task/history/recentChanges';
import type { ActivityAction } from '@/types';
import type { HistoryEntry } from '@/lib/task/history/types';
import type { DashboardTask } from '@/lib/dashboard/brief';

type SavedChange = { projectId: string; taskId: string; entry: HistoryEntry; action?: ActivityAction };
export function recordedTaskChange(projectId: string, id: string, data: Record<string, unknown>): SavedChange | null {
  if (data.targetType !== 'task' || typeof data.targetId !== 'string') return null;
  const entry = recentActivityEntry(id, data);
  if (!Number.isFinite(Date.parse(entry.recordedAt ?? entry.at ?? ''))) return null;
  if (entry.changes?.length && entry.changes.every(change => change.before === change.after)) return null;
  const description = recentChangeText(entry);
  if (!description || ['変更項目は記録されていません', 'タスクの変更'].includes(description) || description.includes('内容の変更なし（再保存）')) return null;
  return { projectId, taskId: data.targetId, entry, action: typeof data.action === 'string' ? data.action as ActivityAction : undefined };
}
export function recentChangedTasks(changes: SavedChange[], tasks: readonly DashboardTask[]) {
  const taskKey = (projectId: string, taskId: string) => JSON.stringify([projectId, taskId]);
  const available = new Map(tasks.filter(task => !task.isArchived && !task.isAbandoned).map(task => [taskKey(task.projectId, task.id), task]));
  const found = new Set<string>();
  return [...changes].sort((a,b) => Date.parse(b.entry.recordedAt ?? b.entry.at!) - Date.parse(a.entry.recordedAt ?? a.entry.at!)).flatMap(change => {
    const key = taskKey(change.projectId, change.taskId), task = available.get(key);
    if (!task || found.has(key)) return [];
    found.add(key); return [{ task, entry: change.entry, action: change.action, parentTitle: task.parentTaskId ? available.get(taskKey(task.projectId, task.parentTaskId))?.title : undefined }];
  });
}
export function useRecentTaskChanges(projectIds: string[], userId: string | null, pageSize: number) {
  const scope = JSON.stringify([userId, [...projectIds].sort(), pageSize]);
  const [snapshot, setSnapshot] = useState<{ scope: string; byProject: Map<string, { changes: SavedChange[]; more: boolean; error: boolean }> } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const [, ids, size] = JSON.parse(scope) as [string, string[], number];
    const receive = (projectId: string, rows: { id: string; data: Record<string, unknown> }[], error = false) => {
      if (!active) return;
      const changes = rows.flatMap(row => { const change = recordedTaskChange(projectId, row.id, row.data); return change ? [change] : []; });
      setSnapshot(previous => ({ scope, byProject: new Map(previous?.scope === scope ? previous.byProject : []).set(projectId, { changes, more: rows.length >= size, error }) }));
    };
    if (isE2EMockAuthEnabled()) {
      const refresh = () => { void import('@/lib/task/organizationMock').then(({ readOrganizationMock }) => ids.forEach(id => receive(id, readOrganizationMock(id).activityLogs.map(row => ({ id: String(row.id), data: row }))))); };
      refresh(); window.addEventListener('taskflow-work-updated', refresh);
      return () => { active = false; window.removeEventListener('taskflow-work-updated', refresh); };
    }
    const stops = ids.map(id => onSnapshot(query(collection(getFirebaseDb(), 'projects', id, 'activityLogs'), orderBy('createdAt', 'desc'), limit(size)), value => receive(id, value.docs.map(row => ({ id: row.id, data: row.data() }))), () => receive(id, [], true)));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [scope, userId]);
  const current = snapshot?.scope === scope && userId ? snapshot.byProject : new Map();
  const results = [...current.values()] as { changes: SavedChange[]; more: boolean; error: boolean }[];
  return { changes: results.flatMap(result => result.changes), isLoading: !!userId && current.size < projectIds.length, error: results.some(result => result.error), more: results.some(result => result.more) };
}
