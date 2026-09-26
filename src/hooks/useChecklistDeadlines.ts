'use client';

import { useEffect, useMemo, useState } from 'react';
import { subscribeToTaskChecklists } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { readTaskDetailsMock } from '@/lib/task/detailMock';
import { validateChecklistDeadline } from '@/lib/utils/checklist-item';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { Checklist } from '@/types';
import type { BriefTaskScope } from '@/stores/briefDisplayStore';

export function selectChecklistDeadlines(task: DashboardTask, lists: Checklist[]) {
  return lists.flatMap(list => list.items.flatMap(item => {
    if (item.isChecked || item.deadlinePolicy !== 'strict') return [];
    try { validateChecklistDeadline({ dueDate: item.dueDate ?? null, dueTime: item.dueTime ?? null, deadlinePolicy: 'strict' }); }
    catch { return []; }
    return [{ task, checklistId: list.id, item, at: `${item.dueDate}T${item.dueTime}:00+09:00` }];
  }));
}

function deadlineScopeKey(userId: string | null, targets: readonly DashboardTask[]): string {
  return JSON.stringify([userId, targets.map(task => [task.projectId, task.id]).sort()]);
}

/** Subscribe only to tasks where someone has explicitly scheduled checklist work.
 * The flag is a routing hint, not a cached copy of dates, text or completion. */
export function useChecklistDeadlines(tasks: readonly DashboardTask[], userId: string | null, scope: BriefTaskScope = 'mine', assigneeId?: string | null) {
  const selected = assigneeId === undefined ? scope === 'all' ? null : userId : assigneeId;
  const targets = userId ? tasks.filter(task => task.hasChecklistDeadlines && !task.isArchived && !task.isAbandoned && (selected === null || task.assigneeIds.includes(selected))) : [];
  const scopeKey = deadlineScopeKey(userId, targets);
  const subscription = useMemo(() => Symbol(scopeKey), [scopeKey]);
  const [snapshot, setSnapshot] = useState<{ subscription: typeof subscription; lists: Map<string, Checklist[]>; errors: Set<string> } | null>(null);
  useEffect(() => {
    const [, ids] = JSON.parse(scopeKey) as [string | null, [string, string][]];
    if (!ids.length) return;
    let active = true;
    const receive = (id: string, lists: Checklist[], failed = false) => {
      if (!active) return;
      setSnapshot(previous => {
        const current = previous?.subscription === subscription ? previous : null;
        const errors = new Set(current?.errors);
        if (failed) errors.add(id); else errors.delete(id);
        return { subscription, lists: new Map(current?.lists).set(id, lists), errors };
      });
    };
    const mock = isE2EMockAuthEnabled();
    const unsubscribes = ids.map(([projectId, taskId]) => {
      const id = JSON.stringify([projectId, taskId]);
      if (!mock) return subscribeToTaskChecklists(projectId, taskId, lists => receive(id, lists), () => receive(id, [], true));
      const read = () => { try { receive(id, readTaskDetailsMock(projectId, taskId).checklists); } catch { receive(id, [], true); } };
      read();
      window.addEventListener('taskflow-work-updated', read);
      window.addEventListener('storage', read);
      return () => { window.removeEventListener('taskflow-work-updated', read); window.removeEventListener('storage', read); };
    });
    return () => { active = false; unsubscribes.forEach(unsubscribe => unsubscribe()); };
  }, [subscription, scopeKey]);
  const current = snapshot?.subscription === subscription ? snapshot : null;
  const items = targets.flatMap(task => selectChecklistDeadlines(task, current?.lists.get(JSON.stringify([task.projectId, task.id])) ?? []))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { items, loading: targets.length > (current?.lists.size ?? 0), error: (current?.errors.size ?? 0) > 0 };
}
