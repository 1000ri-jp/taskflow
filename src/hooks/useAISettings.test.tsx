import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettings } from './useAISettings';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/lib/firebase/authToken', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer synthetic-token' }),
}));

type Pending = { url: string; options?: RequestInit; resolve: (response: Response) => void };
let pending: Pending[];
const fetcher = vi.fn();
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const answerReads = () => {
  const requests = pending.splice(0);
  for (const request of requests) {
    request.resolve(response(request.url === '/api/ai/keys'
      ? { openai: true, anthropic: false, gemini: false }
      : { allowedProjectIds: ['project-a'] }));
  }
};

beforeEach(() => {
  pending = [];
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ isAuthenticated: true });
  useAISettingsStore.setState({ provider: 'openai', openaiKeyConfigured: false, geminiKeyConfigured: false,
    allowedProjectIds: null, projectAccessLoaded: false });
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    new Promise<Response>(resolve => pending.push({ url, options, resolve })));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AI settings request lifecycle', () => {
  it('finishes loading without fetching again when a response updates the store', async () => {
    const { result, rerender } = renderHook(() => useAISettings());
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { answerReads(); });
    expect(result.current.projectAccessLoaded).toBe(true);
    expect(result.current.allowedProjectIds).toEqual(['project-a']);
    expect(result.current.isConfigured).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    act(() => { result.current.setProvider('gemini'); result.current.setModel('synthetic-model'); });
    rerender();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const refresh = result.current.refreshKeyStatus;
    let refreshing: Promise<void>;
    await act(async () => { refreshing = refresh(); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => { answerReads(); await refreshing; });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not create a feedback loop between settings and companion consumers', async () => {
    renderHook(() => { useAISettings(); useAISettings(); });
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(4);
    await act(async () => { answerReads(); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(pending).toHaveLength(0);
  });

  it('does not continuously retry a failed settings response', async () => {
    const { result } = renderHook(() => useAISettings());
    await act(async () => {});
    await act(async () => {
      for (const request of pending.splice(0)) request.resolve(response({ error: '接続を確認してください' }, 503));
    });
    expect(result.current.projectAccessError).toBe('接続を確認してください');
    expect(result.current.projectAccessLoaded).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
