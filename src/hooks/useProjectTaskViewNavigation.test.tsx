import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { User as FirebaseUser } from 'firebase/auth';
import type { User } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { taskViewScope, useProjectTaskViewStore as store } from '@/stores/projectTaskViewStore';
import { useProjectTaskViewNavigation } from './useProjectTaskViewNavigation';
const nav = vi.hoisted(() => ({ query: '', pathname: '/projects/p/board', replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace }), useSearchParams: () => new URLSearchParams(nav.query) }));
const login = (uid: string) => useAuthStore.setState({ firebaseUser: { uid } as FirebaseUser, user: { id: uid } as User });
beforeEach(() => { localStorage.clear(); store.setState({ byScope: {}, hydrated: false, persistenceFailed: false }); nav.query = ''; nav.pathname = '/projects/p/board'; login('alice'); });
it('keeps primary views separate through account switching, reload and an in-flight profile load', () => {
  store.getState().setDefault(taskViewScope('alice', 'p'), 'calendar'); store.getState().setDefault(taskViewScope('bob', 'p'), 'table');
  const { result, unmount } = renderHook(() => useProjectTaskViewNavigation('p'));
  expect(result.current.view).toBe('calendar');
  // The authenticated account has changed while the previous profile is still displayed.
  act(() => useAuthStore.setState({ firebaseUser: { uid: 'bob' } as FirebaseUser }));
  expect(result.current.view).toBe('table'); act(() => result.current.setCurrentViewAsDefault());
  expect(store.getState().byScope[taskViewScope('alice', 'p')]).toBe('calendar');
  unmount(); store.setState({ byScope: {}, hydrated: false }); login('alice');
  const reopened = renderHook(() => useProjectTaskViewNavigation('p')); expect(reopened.result.current.view).toBe('calendar');
});
it('treats an explicit view link as navigation without overwriting the personal default', () => {
  store.getState().setDefault(taskViewScope('alice', 'p'), 'calendar'); nav.query = 'view=board';
  const { result } = renderHook(() => useProjectTaskViewNavigation('p'));
  expect(result.current.view).toBe('board'); expect(result.current.primaryView).toBe('calendar');
  expect(store.getState().byScope[taskViewScope('alice', 'p')]).toBe('calendar');
});
