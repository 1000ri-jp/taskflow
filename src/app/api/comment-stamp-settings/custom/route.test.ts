// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: vi.fn(), getAdminStorage: vi.fn() }));
vi.mock('@/lib/comments/customStamps', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/comments/customStamps')>(), uploadCustomStamp: vi.fn() }));
vi.mock('@/lib/comments/repository', () => ({ removeCustomStamp: vi.fn() }));
import { verifyAuthToken } from '@/lib/firebase/admin';
import { uploadCustomStamp } from '@/lib/comments/customStamps';
import { ReactionError } from '@/lib/comments/reactions';
import { removeCustomStamp } from '@/lib/comments/repository';
import { DELETE, POST } from './route';

const request = () => {
  const form = new FormData(); form.set('id', 'custom_00000000-0000-0000-0000-000000000001'); form.set('name', 'お気に入り'); form.set('file', new Blob(['png bytes'], { type: 'image/png' }), 'a.png');
  return new Request('http://localhost/api/comment-stamp-settings/custom', { method: 'POST', body: form, headers: { Authorization: 'Bearer verified' } });
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'alice', email: 'alice@1000ri.jp' }); vi.mocked(uploadCustomStamp).mockResolvedValue({ seenStampId: 'wave' }); });
it('uses verified identity and returns private uncached settings', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(verifyAuthToken).toHaveBeenCalledWith('Bearer verified');
  expect(uploadCustomStamp).toHaveBeenCalledWith('alice', expect.objectContaining({ name: 'お気に入り', mimeType: 'image/png' }));
});
it('authenticates before consuming the upload and rejects other domains', async () => {
  vi.mocked(verifyAuthToken).mockRejectedValueOnce(new Error('invalid'));
  const body = request();
  expect((await POST(body)).status).toBe(401); expect(body.bodyUsed).toBe(false);
  vi.mocked(verifyAuthToken).mockResolvedValueOnce({ uid: 'bob', email: 'bob@example.com' });
  expect((await POST(request())).status).toBe(403);
  expect(uploadCustomStamp).not.toHaveBeenCalled();
});
it('rejects malformed forms before upload and reports conflict/storage failure distinctly', async () => {
  expect((await POST(new Request('http://localhost', { method: 'POST', body: '{}' }))).status).toBe(422);
  expect(uploadCustomStamp).not.toHaveBeenCalled();
  vi.mocked(uploadCustomStamp).mockRejectedValueOnce(new ReactionError('別の画像', 409));
  expect((await POST(request())).status).toBe(409);
  vi.mocked(uploadCustomStamp).mockRejectedValueOnce(new Error('offline'));
  const failed = await POST(request());
  expect(failed.status).toBe(503); expect(await failed.json()).toHaveProperty('error');
});
it('deletes through the authenticated owner and rejects unauthenticated calls before reading the body', async () => {
  const body = { id: 'custom_00000000-0000-0000-0000-000000000001' };
  const removal = () => new Request('http://localhost/api/comment-stamp-settings/custom?userId=bob', { method: 'DELETE', headers: { Authorization: 'Bearer verified' }, body: JSON.stringify(body) });
  vi.mocked(removeCustomStamp).mockResolvedValue({ seenStampId: 'wave', customStamps: [] });
  const response = await DELETE(removal());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(removeCustomStamp).toHaveBeenCalledWith('alice', body);
  vi.mocked(removeCustomStamp).mockClear(); vi.mocked(verifyAuthToken).mockRejectedValueOnce(new Error('invalid'));
  const request = removal();
  expect((await DELETE(request)).status).toBe(401); expect(request.bodyUsed).toBe(false);
  expect(removeCustomStamp).not.toHaveBeenCalled();
});
