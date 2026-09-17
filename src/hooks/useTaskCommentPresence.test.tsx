import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ userId: 'alice', ensure: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (value: { user: { id: string } }) => unknown) => selector({ user: { id: fake.userId } }) }));
vi.mock('@/lib/comments/taskPresence', () => ({
  ensureTaskCommentPresence: fake.ensure,
  taskCommentPresenceKey: (scope: unknown) => JSON.stringify(scope),
  UNKNOWN_COMMENT_PRESENCE: { status: 'unknown', checkedAt: 0 },
  useTaskCommentPresenceStore: (selector: (value: { entries: Record<string, never> }) => unknown) => selector({ entries: {} }),
}));
import { useTaskCommentPresence } from './useTaskCommentPresence';
let intersection!: IntersectionObserverCallback;
const disconnect = vi.fn();
function Card() {
  const { anchor } = useTaskCommentPresence('project', 'task');
  return <div ref={anchor}>card</div>;
}
beforeEach(() => {
  vi.clearAllMocks(); fake.userId = 'alice'; fake.ensure.mockResolvedValue(undefined);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {} disconnect = disconnect;
  });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reads visible cards only, refreshes on tab return, and cleans up without polling', () => {
  const view = render(<Card />);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(fake.ensure).not.toHaveBeenCalled();
  act(() => intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(fake.ensure).toHaveBeenCalledExactlyOnceWith({ userId: 'alice', projectId: 'project', taskId: 'task' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(fake.ensure).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(fake.ensure).toHaveBeenCalledTimes(2);
  fake.userId = 'bob'; view.rerender(<Card />);
  expect(fake.ensure).toHaveBeenLastCalledWith({ userId: 'bob', projectId: 'project', taskId: 'task' });
  const calls = fake.ensure.mock.calls.length;
  view.unmount();
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(fake.ensure).toHaveBeenCalledTimes(calls); expect(disconnect).toHaveBeenCalledOnce();
});
