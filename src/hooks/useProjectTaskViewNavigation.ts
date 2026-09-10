'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { resolveTaskView, type TaskView } from '@/lib/board/taskViews';
import {
  PROJECT_TASK_VIEW_KEY,
  taskViewScope,
  useProjectTaskViewStore,
} from '@/stores/projectTaskViewStore';
import { useAuthStore } from '@/stores/authStore';

export function useProjectTaskViewNavigation(projectId: string) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { byScope, hydrated, hydrate, setDefault, persistenceFailed } = useProjectTaskViewStore();
  const scope = taskViewScope(user?.id ?? '', projectId);
  const primaryView = byScope[scope] ?? 'board';
  const view = resolveTaskView(searchParams.get('view'), primaryView);

  useEffect(() => {
    hydrate();
    const sync = (event: StorageEvent) => {
      if (event.key === PROJECT_TASK_VIEW_KEY || event.key === null) hydrate();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [hydrate]);

  const changeView = useCallback((nextView: TaskView) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', nextView);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const setCurrentViewAsDefault = useCallback(() => {
    setDefault(scope, view);
  }, [scope, setDefault, view]);

  return {
    view,
    primaryView,
    changeView,
    setCurrentViewAsDefault,
    canSave: hydrated && !!user?.id,
    persistenceFailed,
  };
}
