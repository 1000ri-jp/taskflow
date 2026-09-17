'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  createActivityLog,
  subscribeToActivityLogs,
} from '@/lib/firebase/firestore';
import type {
  ActivityLog,
  ActivityTargetType,
  ActivityAction,
  ActivityChange,
} from '@/types';

interface UseActivityLogReturn {
  logs: ActivityLog[];
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
  logActivity: (params: {
    targetType: ActivityTargetType;
    targetId: string;
    targetName: string;
    action: ActivityAction;
    changes?: ActivityChange[];
  }) => Promise<void>;
}

export function useActivityLog(projectId: string | null): UseActivityLogReturn {
  const { firebaseUser, user } = useAuthStore();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setLogs([]); setError(null); setIsLoading(!!projectId); } });
    if (!projectId) return () => { active = false; };
    const unsubscribe = subscribeToActivityLogs(projectId, activityLogs => {
      if (active) { setLogs(activityLogs); setError(null); setIsLoading(false); }
    }, 50, failure => {
      if (active) { setError(failure); setIsLoading(false); }
    });
    return () => { active = false; unsubscribe(); };
  }, [projectId, attempt]);

  const logActivity = useCallback(
    async (params: {
      targetType: ActivityTargetType;
      targetId: string;
      targetName: string;
      action: ActivityAction;
      changes?: ActivityChange[];
    }) => {
      if (!projectId || !firebaseUser) return;

      await createActivityLog(projectId, {
        projectId,
        targetType: params.targetType,
        targetId: params.targetId,
        targetName: params.targetName,
        action: params.action,
        userId: firebaseUser.uid,
        userName: user?.displayName || 'Unknown',
        changes: params.changes,
      });
    },
    [projectId, firebaseUser, user]
  );

  return { logs, isLoading, error, retry: () => setAttempt(value => value + 1), logActivity };
}
