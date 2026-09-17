import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { automationRequest } from './automationClient';
const state = vi.hoisted(() => ({ appUid: 'u' as string | null, firebaseUid: 'u' as string | null, token: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: state.appUid ? { id: state.appUid } : null, firebaseUser: state.firebaseUid ? { uid: state.firebaseUid, getIdToken: state.token } : null }) } }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
beforeEach(() => { vi.resetAllMocks(); state.appUid = 'u'; state.firebaseUid = 'u'; state.token.mockResolvedValue('token-u'); });
afterEach(() => vi.unstubAllGlobals());
describe('automation response owner boundary', () => {
  it('sends only after the token still belongs to the signed-in app user', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    state.token.mockImplementation(async () => { state.appUid = 'v'; state.firebaseUid = 'v'; return 'token-u'; });
    await expect(automationRequest({ action: 'run' })).rejects.toThrow('ログインが変更');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('discards another account’s private response before parsing it', async () => {
    const json = vi.fn().mockResolvedValue({ grants: ['old private grants'] });
    vi.stubGlobal('fetch', vi.fn(async () => { state.appUid = 'v'; state.firebaseUid = 'v'; return { ok: true, json }; }));
    await expect(automationRequest()).rejects.toThrow('ログインが変更'); expect(json).not.toHaveBeenCalled();
  });
  it('discards private data when logout occurs during JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { state.appUid = null; state.firebaseUid = null; return { grants: ['private'] }; } }));
    await expect(automationRequest()).rejects.toThrow('ログインが変更');
  });
  it('returns the same owner’s view and forwards the exact optimistic-concurrency token', async () => {
    const view = { revision: 2, grants: [], reminders: [], backgroundConfigured: false };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => view }); vi.stubGlobal('fetch', fetch);
    const body = { action: 'policy', projectId: 'p', taskId: 't', expectedUpdatedAt: '2026-09-12T00:00:00.000Z', policy: null };
    expect(await automationRequest(body)).toEqual(view);
    expect(fetch).toHaveBeenCalledWith('/api/task-automation', expect.objectContaining({ cache: 'no-store', body: JSON.stringify(body), headers: { Authorization: 'Bearer token-u', 'Content-Type': 'application/json' } }));
  });
});
