'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { projectViewHref, resolveProjectView, type ProjectView } from '@/lib/board/projectNavigation';
import {
  PROJECT_TASK_VIEW_KEY,
  taskViewScope,
  useProjectTaskViewStore,
} from '@/stores/projectTaskViewStore';
import { useAuthStore } from '@/stores/authStore';

export function useProjectTaskViewNavigation(projectId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { firebaseUser } = useAuthStore();
  const viewerId = firebaseUser?.uid ?? null;
  const { byScope, hydrated, hydrate, setDefault, persistenceFailed } = useProjectTaskViewStore();
  const scope = taskViewScope(viewerId ?? '', projectId);
  const primaryView = byScope[scope] ?? 'board';
  const view = pathname === `/projects/${projectId}/gantt` ? 'gantt' : resolveProjectView(searchParams.get('view'), primaryView);

  useEffect(() => {
    hydrate();
    const sync = (event: StorageEvent) => {
      if (event.key === PROJECT_TASK_VIEW_KEY || event.key === null) hydrate();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [hydrate]);

  const changeView = useCallback((nextView: ProjectView) => {
    router.replace(projectViewHref(projectId, nextView, new URLSearchParams(searchParams.toString()), primaryView), { scroll: false });
  }, [projectId, primaryView, router, searchParams]);

  const setCurrentViewAsDefault = useCallback(() => {
    if (hydrated && viewerId) setDefault(scope, view);
  }, [hydrated, viewerId, scope, setDefault, view]);

  return {
    view,
    primaryView,
    changeView,
    setCurrentViewAsDefault,
    canSave: hydrated && !!viewerId,
    persistenceFailed,
  };
}
