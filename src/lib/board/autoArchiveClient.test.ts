import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAutoArchive, runAutoArchive, saveAutoArchive } from './autoArchiveClient';
const state = vi.hoisted(() => ({ uid: 'u', getToken: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: state.uid ? { id: state.uid } : null, firebaseUser: state.uid ? { uid: state.uid, getIdToken: state.getToken } : null }) } }));
const fetcher = vi.fn();
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); state.uid = 'u'; state.getToken.mockResolvedValue('synthetic-token'); vi.stubGlobal('fetch', fetcher); });
afterEach(() => vi.unstubAllGlobals());
describe('auto archive client', () => {
  it('uses the authenticated server route with no browser preview preference', async () => {
    fetcher.mockResolvedValue(response({ configured: false }));
    expect(await readAutoArchive('p')).toEqual({ configured: false });
    expect(fetcher).toHaveBeenCalledWith('/api/auto-archive?projectId=p', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-token' } }));
  });
  it('requests execution only after a successful save', async () => {
    const listener = vi.fn(); window.addEventListener('taskflow-auto-archive-request', listener);
    try {
      const input = { projectId: null, revision: 'r1', mode: 'custom' as const, days: 30 };
      fetcher.mockResolvedValueOnce(response({ error: '保存失敗' }, false));
      await expect(saveAutoArchive(input)).rejects.toThrow('保存失敗'); expect(listener).not.toHaveBeenCalled();
      fetcher.mockResolvedValueOnce(response({ configured: true }));
      await saveAutoArchive(input); expect(listener).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('taskflow-auto-archive-request', listener); }
  });
  it('does not issue a request if the login changes while obtaining the token', async () => {
    state.getToken.mockImplementation(async () => { state.uid = 'other'; return 'synthetic-token'; });
    await expect(readAutoArchive(null)).rejects.toThrow('ログインが変更'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not expose a response for a previous login', async () => {
    fetcher.mockImplementation(async () => { state.uid = 'other'; return response({ configured: true }); });
    await expect(readAutoArchive(null)).rejects.toThrow('ログインが変更');
  });
  it('continues project pages even when an earlier project fails', async () => {
    fetcher.mockResolvedValueOnce(response({ checked: 20, archived: 2, failed: 1, nextCursor: 'projects/p20' }))
      .mockResolvedValueOnce(response({ checked: 1, archived: 1, failed: 0, nextCursor: null }));
    await expect(runAutoArchive()).rejects.toThrow('一部のプロジェクト');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: 'run', cursor: 'projects/p20' });
  });
  it('stops repeated cursors without looping', async () => {
    fetcher.mockResolvedValue(response({ checked: 20, archived: 0, failed: 0, nextCursor: 'projects/p20' }));
    await expect(runAutoArchive()).rejects.toThrow('続きの取得'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('stops subsequent pages when its owning component is disposed', async () => {
    let active = true;
    fetcher.mockImplementation(async () => { active = false; return response({ checked: 20, archived: 0, failed: 0, nextCursor: 'projects/p20' }); });
    await runAutoArchive(() => active); expect(fetcher).toHaveBeenCalledOnce();
  });
});
