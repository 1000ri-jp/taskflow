import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHistory } from './useTaskHistory';
import type { TaskHistoryPage } from '@/lib/task/history/types';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), mock: false }));
vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: mocks.auth }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => mocks.mock }));
const page = (text: string, nextCursor: string | null = null): TaskHistoryPage => ({ entries: [], nextCursor, activityStatus: 'ready', issues: [], checkedAt: '2026-09-12T00:00:00Z', privateSources: { status: 'ready', unavailableLinks: 0, issues: [], entries: [{ id: text, text, title: text, actor: 'owner', at: null, kind: 'gmail', private: true }] } });
const response = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response;
beforeEach(() => { vi.resetAllMocks(); mocks.mock = false; mocks.auth.mockResolvedValue({ Authorization: 'Bearer test' }); });
afterEach(() => vi.unstubAllGlobals());
describe('task history scope and privacy lifecycle', () => {
  it('never requests a closed task or absent owner', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { rerender } = renderHook(({ enabled, owner }) => useTaskHistory('p', 't', owner, enabled), { initialProps: { enabled: false, owner: 'u' as string | undefined } });
    rerender({ enabled: true, owner: undefined });
    await act(async () => {}); expect(fetch).not.toHaveBeenCalled();
  });
  it('removes old owner excerpts on task switch and ignores late responses', async () => {
    let finishOld!: (r: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(response(page('new owner evidence')));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ task }) => useTaskHistory('p', task, 'u', true), { initialProps: { task: 'old' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ task: 'new' });
    await waitFor(() => expect(result.current.page?.privateSources?.entries[0].text).toBe('new owner evidence'));
    await act(async () => { finishOld(response(page('old secret'))); });
    expect(JSON.stringify(result.current.page)).not.toContain('old secret');
  });
  it('reauthorizes personal sources on pagination and clears them if permission is denied', async () => {
    let finishPage!: (r: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(page('private', 'cursor'))).mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useTaskHistory('p', 't', 'u', true));
    await waitFor(() => expect(result.current.page?.privateSources).toBeDefined());
    let pending!: Promise<void>; act(() => { pending = result.current.more(); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.page?.privateSources).toBeUndefined();
    await act(async () => { finishPage(response({ error: '権限を確認できません' }, false)); await pending; });
    expect(result.current.page).toBeNull(); expect(result.current.error).toContain('権限');
  });
});
