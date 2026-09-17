import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ uid: 'alice' }));
vi.mock('@/lib/firebase/config', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: auth.uid } }) }));
vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }) }));
import { deleteCustomStamp, fetchCommentReactions, fetchStampSettings } from './client';
beforeEach(() => { vi.useFakeTimers(); auth.uid = 'alice'; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('batches visible comments in groups of at most 20, with no polling', async () => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => Object.fromEntries(new URL(url, 'http://localhost').searchParams.getAll('commentId').map(id => [id, { reactions: [], own: null, partial: false }])) }));
  vi.stubGlobal('fetch', fetcher);
  const pending = Array.from({ length: 23 }, (_, i) => fetchCommentReactions('alice', { projectId: 'p', taskId: 't', commentId: `c${i}` }));
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(40); await Promise.all(pending);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(new URL(fetcher.mock.calls[0][0], 'http://localhost').searchParams.getAll('commentId')).toHaveLength(20);
  await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects failed reads rather than resolving an empty list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: '権限がありません' }) })));
  const result = expect(fetchCommentReactions('alice', { projectId: 'p', taskId: 't', commentId: 'c' })).rejects.toThrow('権限');
  await vi.advanceTimersByTimeAsync(40); await result;
});
it('does not load another account and rejects an in-flight account change', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(fetchStampSettings('bob')).rejects.toThrow('ログイン'); expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockImplementation(async () => { auth.uid = 'bob'; return { ok: true, json: async () => ({ seenStampId: 'wave' }) }; });
  await expect(fetchStampSettings('alice')).rejects.toThrow('変更');
});

it('uploads multipart without a JSON content-type and retains the client id for an uncertain retry', async () => {
  const { uploadCustomStamp } = await import('./client');
  const input = { id: 'custom_10000000-0000-0000-0000-000000000001' as const, name: 'うちのこ', file: new File(['png'], 'cat.png', { type: 'image/png' }) };
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => ({ seenStampId: input.id, customStamps: [] }) });
  vi.stubGlobal('fetch', fetcher);
  await expect(uploadCustomStamp('alice', input)).rejects.toThrow('offline');
  await uploadCustomStamp('alice', input);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [path, options] of fetcher.mock.calls) {
    expect(path).toBe('/api/comment-stamp-settings/custom');
    expect(options.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('id')).toBe(input.id);
    expect(options.body.get('file')).toBe(input.file);
  }
});
it('does not upload for another account and rejects an account change during upload', async () => {
  const { uploadCustomStamp } = await import('./client');
  const input = { id: 'custom_10000000-0000-0000-0000-000000000001' as const, name: 'ねこ', file: new File(['png'], 'cat.png', { type: 'image/png' }) };
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(uploadCustomStamp('bob', input)).rejects.toThrow('ログイン'); expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockImplementation(async () => { auth.uid = 'bob'; return { ok: true, json: async () => ({ seenStampId: input.id }) }; });
  await expect(uploadCustomStamp('alice', input)).rejects.toThrow('変更');
});
it('deletes with the existing auth guard and sends only the custom stamp identity', async () => {
  const id = 'custom_10000000-0000-0000-0000-000000000001' as const;
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ seenStampId: 'wave', customStamps: [] }) }));
  vi.stubGlobal('fetch', fetcher);
  await expect(deleteCustomStamp('bob', id)).rejects.toThrow('ログイン');
  expect(fetcher).not.toHaveBeenCalled();
  await deleteCustomStamp('alice', id);
  expect(fetcher).toHaveBeenCalledWith('/api/comment-stamp-settings/custom', expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ id }) }));
});
