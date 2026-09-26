import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSecretary } from './useSecretary';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { emptySecretaryState, type SecretaryView } from '@/lib/secretary/types';
import { setSecretaryRefreshMinutes, useSecretaryRefreshSettings } from './useSecretaryRefreshSettings';

vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/stores/aiSettingsStore', () => ({
  useAISettingsStore: (selector: (state: unknown) => unknown) => selector({ provider: 'openai', openaiModel: 'test-model' }),
}));

const fetchMock = vi.fn();
const view: SecretaryView = {
  mode: 'live', needsReview: true, state: emptySecretaryState(),
  snapshot: { userId: 'a', checkedAt: '2026-09-10T03:00:00.000Z', signature: 'source-a', tasks: [],
    coverage: { status: 'empty', projects: 1, excludedProjects: 0, issues: [] } },
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe('useSecretary live reads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAuthHeaders).mockResolvedValue({ Authorization: 'Bearer test-token' });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('loads immediately after Strict Mode cancels its first effect, without a manual refresh or writes', async () => {
    fetchMock.mockImplementation(async (_url, options: RequestInit) => {
      options.signal?.throwIfAborted();
      return response(view);
    });
    const { result } = renderHook(() => useSecretary('a'), { wrapper: strict });
    await waitFor(() => expect(result.current.view).toEqual(view));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    expect(fetchMock.mock.calls.at(-1)?.[1].signal.aborted).toBe(false);
  });

  it('does not let a late cancelled response release or overwrite the replacement request', async () => {
    const pending: ((value: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => pending.push(resolve)));
    const { result, rerender } = renderHook(({ userId }) => useSecretary(userId), { initialProps: { userId: 'a' } });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ userId: 'b' });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    await act(async () => { pending[0](response(view)); });
    expect(result.current.view).toBeNull();
    expect(result.current.busy).toBe(true);
    const nextView = { ...view, snapshot: { ...view.snapshot, userId: 'b', signature: 'source-b' } };
    await act(async () => { pending[1](response(nextView)); });
    expect(result.current.view).toEqual(nextView);
    expect(result.current.busy).toBe(false);
  });

  it('shows a failed live read as unavailable, then recovers with a read only refresh', async () => {
    fetchMock.mockImplementation(async () => response({ error: 'サーバー接続を確認してください。' }, 503));
    const { result } = renderHook(() => useSecretary('a'), { wrapper: strict });
    await waitFor(() => expect(result.current.error).toBe('サーバー接続を確認してください。'));
    expect(result.current.view).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.auto).toBe(false);
    fetchMock.mockImplementation(async () => response(view));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.view).toEqual(view);
    expect(result.current.error).toBeNull();
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });
  it('retains successful review data while showing partial failure and stopping automatic review', async () => {
    fetchMock.mockImplementation(async () => response(view));
    const { result } = renderHook(() => useSecretary('a'));
    await waitFor(() => expect(result.current.view).toEqual(view));
    act(() => result.current.setAuto(true));
    const partial = { ...view, reviewWarnings: ['既存タスクは未確認です。'] };
    fetchMock.mockImplementation(async () => response(partial));
    await act(async () => { await result.current.review(); });
    expect(result.current.view).toEqual(partial);
    expect(result.current.error).toBe('既存タスクは未確認です。');
    expect(result.current.auto).toBe(false);
  });

  it('submits a selected deadline once, reports success, and refreshes task displays without running AI', async () => {
    fetchMock.mockImplementation(async () => response(view));
    const { result } = renderHook(() => useSecretary('a'));
    await waitFor(() => expect(result.current.view).toEqual(view));
    const action = { action: 'reschedule' as const, proposalId: 'p', revision: 0, dueDate: '2026-09-21' };
    const saved: SecretaryView = { ...view, state: { ...view.state, revision: 1, history: [{
      id: 'change-1', key: 'project/task', proposalId: 'p', action: 'reschedule', at: view.snapshot.checkedAt,
      beforeDecision: null, afterNonce: 'change-1', beforeTask: { dueDate: null, durationDays: null, isDueDateFixed: false },
      afterTask: { dueDate: '2026-09-21T00:00:00.000Z', durationDays: null, isDueDateFixed: true }, afterVersion: 'after', undone: false,
    }] } };
    fetchMock.mockImplementation(async () => response(saved));
    const updated = vi.fn(); window.addEventListener('taskflow-work-updated', updated);
    try {
      await act(async () => { expect(await result.current.act(action)).toBe(true); });
      expect(result.current.view).toEqual(saved);
      expect(updated).toHaveBeenCalledOnce();
      const requests = fetchMock.mock.calls.map(([, options]) => options);
      expect(requests.map(options => options.method)).toEqual(['GET', 'PATCH']);
      expect(JSON.parse(requests[1].body)).toEqual(action);
    } finally { window.removeEventListener('taskflow-work-updated', updated); }
  });

  it('returns failure and keeps prior data when a deadline conflicts, allowing the UI to keep its input', async () => {
    fetchMock.mockImplementation(async () => response(view));
    const { result } = renderHook(() => useSecretary('a'));
    await waitFor(() => expect(result.current.view).toEqual(view));
    fetchMock.mockImplementation(async () => response({ error: '根拠に更新があります。' }, 409));
    const updated = vi.fn(); window.addEventListener('taskflow-work-updated', updated);
    try {
      await act(async () => { expect(await result.current.act({ action: 'reschedule', proposalId: 'p', revision: 0, dueDate: '2026-09-21' })).toBe(false); });
      expect(result.current.view).toEqual(view);
      expect(result.current.error).toBe('根拠に更新があります。');
      expect(updated).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'PATCH']);
    } finally { window.removeEventListener('taskflow-work-updated', updated); }
  });

  it('defaults to hourly reads, ignores early focus, and restarts the interval after a manual refresh', async () => {
    vi.useFakeTimers();
    // Keep interval tests away from the independently tested JST midnight refresh.
    vi.setSystemTime(new Date('2026-09-18T09:00:00+09:00'));
    fetchMock.mockImplementation(async () => response(view));
    const { result } = renderHook(() => useSecretary('a'));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(59 * 60_000); window.dispatchEvent(new Event('focus')); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); await result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(59 * 60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it('uses a changed interval immediately, persists manual only mode, and isolates accounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T09:00:00+09:00'));
    fetchMock.mockImplementation(async () => response(view));
    const first = renderHook(() => ({ secretary: useSecretary('a'), settings: useSecretaryRefreshSettings('a') }));
    await act(async () => {});
    await act(async () => { first.result.current.settings.setRefreshMinutes(5); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { setSecretaryRefreshMinutes('a', 0); });
    first.unmount();
    const next = renderHook(() => ({ secretary: useSecretary('a'), settings: useSecretaryRefreshSettings('a'), other: useSecretaryRefreshSettings('b') }));
    await act(async () => {});
    expect(next.result.current.settings.refreshMinutes).toBe(0);
    expect(next.result.current.other.refreshMinutes).toBe(60);
    const count = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60 * 60_000); window.dispatchEvent(new Event('focus')); });
    expect(fetchMock).toHaveBeenCalledTimes(count);
    await act(async () => { await next.result.current.secretary.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(count + 1);
  });

  it('waits while hidden and catches up once when the selected interval has elapsed', async () => {
    vi.useFakeTimers();
    // Keep interval tests away from the independently tested JST midnight refresh.
    vi.setSystemTime(new Date('2026-09-18T09:00:00+09:00'));
    fetchMock.mockImplementation(async () => response(view));
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    try {
      renderHook(() => useSecretary('a'));
      await act(async () => {});
      visibility.mockReturnValue('hidden');
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 60_000); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { visibility.mockRestore(); }
  });
});

it('coalesces work changes received during a read and fetches the resulting state once',async()=>{
 vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);vi.mocked(getAuthHeaders).mockResolvedValue({Authorization:'test'});
 let finish!: (response:Response)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValue(response({...view,snapshot:{...view.snapshot,signature:'after-check'}}));
 const {result,unmount}=renderHook(()=>useSecretary('a'));
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
 act(()=>{window.dispatchEvent(new Event('taskflow-work-updated'));window.dispatchEvent(new Event('taskflow-work-updated'));});
 await act(async()=>{finish(response(view));});
 await waitFor(()=>expect(result.current.view?.snapshot.signature).toBe('after-check'));
 expect(fetchMock).toHaveBeenCalledTimes(2);unmount();vi.unstubAllGlobals();
});

it('refreshes date-dependent UI at JST midnight even with periodic refresh disabled', async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-15T23:59:59+09:00'));vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);
 vi.mocked(getAuthHeaders).mockResolvedValue({Authorization:'test'});fetchMock.mockResolvedValue(response(view));
 setSecretaryRefreshMinutes('a',0);const {unmount}=renderHook(()=>useSecretary('a'));await act(async()=>{});
 const initial=fetchMock.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(1001);});
 expect(fetchMock).toHaveBeenCalledTimes(initial+1);expect(fetchMock.mock.calls.at(-1)![1].method).toBe('GET');
 unmount();vi.useRealTimers();vi.unstubAllGlobals();
});
