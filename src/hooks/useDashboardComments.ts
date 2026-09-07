'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { commentTaskKey, loadDashboardComments, type CommentTaskRef, type InboxComment } from '@/lib/dashboard/comments';
import type { DashboardTask } from '@/lib/dashboard/brief';

export function useDashboardComments(tasks: DashboardTask[], tasksLoading: boolean, tasksError: Error | null, enabled: boolean) {
  const userId = useAuthStore((state) => state.firebaseUser?.uid);
  const taskRefs = tasks.filter((task) => !task.isArchived).map(({ id, projectId, listId }) => ({ id, projectId, listId }))
    .sort((a, b) => commentTaskKey(a).localeCompare(commentTaskKey(b)));
  const taskKey = JSON.stringify(taskRefs);
  const scope = JSON.stringify([userId, taskKey]);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    scope: string; revision: number; items: InboxComment[]; failedTasks: number; errorCodes: string[]; metadataIncomplete: boolean; updatedAt: Date;
  } | null>(null);
  const canLoad = enabled && Boolean(userId) && !tasksLoading;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    void loadDashboardComments(JSON.parse(taskKey) as CommentTaskRef[], () => cancelled).then((result) => {
      if (!cancelled) setSnapshot({ ...result, scope, revision, updatedAt: new Date() });
    });
    return () => { cancelled = true; };
  }, [canLoad, taskKey, scope, revision]);

  const current = canLoad && snapshot?.scope === scope ? snapshot : null;
  const tasksByKey = new Map(tasks.map((task) => [commentTaskKey(task), task]));
  const items = (current?.items ?? []).flatMap((item) => {
    const task = tasksByKey.get(commentTaskKey({ projectId: item.projectId, id: item.taskId }));
    return task && !task.isArchived ? [{ ...item, task }] : [];
  });
  return {
    items,
    isLoading: enabled && Boolean(userId) && (tasksLoading || !current || current.revision !== revision),
    hasError: Boolean(tasksError) || Boolean(current?.failedTasks),
    errorDetail: tasksError ? 'プロジェクトのタスク一覧を取得できません。ページを再読み込みしてください。' : current?.failedTasks ? `コメント取得失敗 ${current.failedTasks}件（${current.errorCodes.join('・')}）` : '',
    metadataIncomplete: current?.metadataIncomplete ?? false,
    updatedAt: current?.updatedAt ?? null,
    refresh,
  };
}
