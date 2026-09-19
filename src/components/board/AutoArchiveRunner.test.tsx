import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoArchiveRunner } from './AutoArchiveRunner';
const fake = vi.hoisted(() => ({ uid: 'u', sessionUid: 'u', mock: false, run: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign(
  (select: (state: { user: { id: string } | null; firebaseUser: { uid: string } | null }) => unknown) => select({ user: fake.uid ? { id: fake.uid } : null, firebaseUser: fake.sessionUid ? { uid: fake.sessionUid } : null }),
  { getState: () => ({ user: fake.uid ? { id: fake.uid } : null, firebaseUser: fake.sessionUid ? { uid: fake.sessionUid } : null }) },
) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => fake.mock }));
vi.mock('@/lib/board/autoArchiveClient', () => ({ runAutoArchive: fake.run }));
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const visibility = (value: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
};
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.setSystemTime(new Date('2026-09-13T12:00:00+09:00'));
  fake.uid = 'u'; fake.sessionUid = 'u'; fake.mock = false; fake.run.mockResolvedValue(undefined);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('auto archive runner', () => {
  it('checks on opening and saving, then at JST midnight rather than every 15 minutes', async () => {
    render(<AutoArchiveRunner />); await flush(); expect(fake.run).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('taskflow-auto-archive-request')); await flush(); expect(fake.run).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); }); expect(fake.run).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync((12 * 60 - 15) * 60_000); }); expect(fake.run).toHaveBeenCalledTimes(3);
    visibility('hidden'); visibility('visible'); await flush(); expect(fake.run).toHaveBeenCalledTimes(3);
  });
  it('queues a settings save during an in-flight check without overlapping or losing it', async () => {
    let resolve!: () => void;
    fake.run.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    const page = render(<AutoArchiveRunner />); const current = fake.run.mock.calls[0][0] as () => boolean;
    window.dispatchEvent(new Event('taskflow-auto-archive-request'));
    window.dispatchEvent(new Event('taskflow-auto-archive-request'));
    expect(fake.run).toHaveBeenCalledOnce(); expect(current()).toBe(true);
    await act(async () => { resolve(); }); expect(fake.run).toHaveBeenCalledTimes(2);
    page.unmount(); expect(current()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('runs only one missed check after being hidden across several midnights', async () => {
    render(<AutoArchiveRunner />); await flush(); visibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60_000); });
    expect(fake.run).toHaveBeenCalledOnce(); visibility('visible'); await flush();
    expect(fake.run).toHaveBeenCalledTimes(2);
    visibility('hidden'); visibility('visible'); await flush(); expect(fake.run).toHaveBeenCalledTimes(2);
  });
  it('keeps a save pending while hidden even after today was checked', async () => {
    render(<AutoArchiveRunner />); await flush(); visibility('hidden');
    window.dispatchEvent(new Event('taskflow-auto-archive-request')); await flush(); expect(fake.run).toHaveBeenCalledOnce();
    visibility('visible'); await flush(); expect(fake.run).toHaveBeenCalledTimes(2);
  });
  it('retries an interrupted check on return without a recurring short interval', async () => {
    fake.run.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<AutoArchiveRunner />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); }); expect(fake.run).toHaveBeenCalledOnce();
    visibility('hidden'); visibility('visible'); await flush(); expect(fake.run).toHaveBeenCalledTimes(2);
  });
  it('waits for the Firebase session and invalidates continuation when either identity changes', async () => {
    fake.sessionUid = '';
    const page = render(<AutoArchiveRunner />); await flush(); expect(fake.run).not.toHaveBeenCalled();
    fake.sessionUid = 'u'; page.rerender(<AutoArchiveRunner />); await flush(); expect(fake.run).toHaveBeenCalledOnce();
    const current = fake.run.mock.calls[0][0] as () => boolean;
    fake.sessionUid = 'other'; expect(current()).toBe(false);
    fake.uid = 'other'; page.rerender(<AutoArchiveRunner />); await flush(); expect(fake.run).toHaveBeenCalledTimes(2);
  });
  it.each(['signed-out', 'isolated-mock'])('does not execute for %s', async mode => {
    if (mode === 'signed-out') fake.uid = ''; else fake.mock = true;
    render(<AutoArchiveRunner />); await flush(); expect(fake.run).not.toHaveBeenCalled();
  });
});
