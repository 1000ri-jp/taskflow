'use client';

import { useEffect, useState } from 'react';
import { subscribeToArchivedTasks } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Task } from '@/types';

// A failed subscription is not an empty archive. Retrying must not revive old callbacks.
export function useArchivedTasks(projectId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ projectId: string; tasks: Task[]; isLoading: boolean; error: Error | null }>({
    projectId, tasks: [], isLoading: true, error: null,
  });
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    Promise.resolve().then(() => {
      if (!active) return;
      const initial = { projectId, tasks: [] as Task[], isLoading: false, error: null };
      if (!projectId || isE2EMockAuthEnabled()) { setState(initial); return; }
      setState({ ...initial, isLoading: true });
      const failed = (error: Error) => {
        if (active) setState({ ...initial, error });
      };
      try {
        unsubscribe = subscribeToArchivedTasks(projectId, tasks => {
          if (active) setState({ ...initial, tasks });
        }, failed);
      } catch (error) { failed(error instanceof Error ? error : new Error('取得できませんでした')); }
    });
    return () => { active = false; unsubscribe?.(); };
  }, [projectId, attempt]);
  const current = state.projectId === projectId;
  return {
    tasks: current ? state.tasks : [],
    isLoading: !current || state.isLoading,
    error: current ? state.error : null,
    retry: () => setAttempt(value => value + 1),
  };
}
