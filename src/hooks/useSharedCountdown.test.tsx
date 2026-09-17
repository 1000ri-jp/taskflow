import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedCountdown } from './useSharedCountdown';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { setSecretaryRefreshMinutes } from './useSecretaryRefreshSettings';

vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: vi.fn() }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const initial = { status: 'unset', target: null, task: null, revision: 0 };
const fetchMock = vi.fn();
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
describe('useSharedCountdown', () => {
  beforeEach(() => {
    localStorage.clear(); focusManager.setFocused(true);
    vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    vi.mocked(getAuthHeaders).mockResolvedValue({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' });
    fetchMock.mockImplementation(async () => response(initial));
  });
  afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('fetches once per hour by default and allows manual refresh', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSharedCountdown('a'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000 - 30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('honors manual-only mode and interval changes without polling hidden pages', async () => {
    vi.useFakeTimers();
    setSecretaryRefreshMinutes('a', 0);
    const { result } = renderHook(() => useSharedCountdown('a'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => setSecretaryRefreshMinutes('a', 5));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    act(() => focusManager.setFocused(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('reads without writes, then saves just IDs and reloads shared state', async () => {
    const { result } = renderHook(() => useSharedCountdown('a'), { wrapper });
    await waitFor(() => expect(result.current.data?.revision).toBe(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    await act(async () => { await result.current.save({ target: { projectId: 'p', taskId: 't' }, revision: 0 }); });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ target: { projectId: 'p', taskId: 't' }, revision: 0 }) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reports unavailable authentication and does not expose the prior account’s cache', async () => {
    const { result, rerender } = renderHook(({ userId }) => useSharedCountdown(userId), { initialProps: { userId: 'a' }, wrapper });
    await waitFor(() => expect(result.current.data).toEqual(initial));
    fetchMock.mockImplementation(async () => response({ error: '認証待ち' }, 503));
    rerender({ userId: 'b' });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.error?.message).toBe('認証待ち'));
    expect(result.current.data).toBeUndefined();
  });
  it('reloads after conflict without pretending to save', async () => {
    const { result } = renderHook(() => useSharedCountdown('a'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(initial));
    fetchMock.mockImplementation(async (_url, options) => options.method === 'PATCH' ? response({ error: '競合' }, 409) : response({ ...initial, revision: 2 }));
    await act(async () => { await expect(result.current.save({ target: null, revision: 0 })).rejects.toThrow('競合'); });
    await waitFor(() => expect(result.current.data?.revision).toBe(2));
  });
});
