import { beforeEach, expect, it, vi } from 'vitest';
import { GET, PUT } from './route';
import { PUT as PUT_SETTINGS } from '../comment-stamp-settings/route';
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: vi.fn() }));
vi.mock('@/lib/comments/repository', () => ({ readReactions: vi.fn(), setReaction: vi.fn(), saveStampSettings: vi.fn() }));
import { verifyAuthToken } from '@/lib/firebase/admin';
import { readReactions, saveStampSettings, setReaction } from '@/lib/comments/repository';
beforeEach(() => { vi.resetAllMocks(); vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'alice', email: 'alice@1000ri.jp' }); vi.mocked(readReactions).mockResolvedValue({}); vi.mocked(setReaction).mockResolvedValue(null); vi.mocked(saveStampSettings).mockResolvedValue({ seenStampId: 'cat' }); });
it('authenticates reads and writes and passes only verified identity to storage', async () => {
  const result = await GET(new Request('http://localhost/api/comment-reactions?projectId=p&taskId=t&commentId=c'));
  expect(readReactions).toHaveBeenCalledWith('alice', { projectId: 'p', taskId: 't' }, ['c']);
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  await PUT(new Request('http://localhost/api/comment-reactions', { method: 'PUT', body: JSON.stringify({ kind: 'seen' }) }));
  expect(setReaction).toHaveBeenCalledWith('alice', { kind: 'seen' });
  await PUT_SETTINGS(new Request('http://localhost/api/comment-stamp-settings', { method: 'PUT', body: JSON.stringify({ seenStampId: 'cat' }) }));
  expect(saveStampSettings).toHaveBeenCalledWith('alice', { seenStampId: 'cat' });
});
it('rejects unauthenticated and disallowed accounts before reads or writes', async () => {
  vi.mocked(verifyAuthToken).mockRejectedValue(new Error('invalid'));
  expect((await GET(new Request('http://localhost/api/comment-reactions'))).status).toBe(401);
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'alice', email: 'alice@example.com' });
  expect((await PUT(new Request('http://localhost/api/comment-reactions', { method: 'PUT', body: '{}' }))).status).toBe(403);
  expect(readReactions).not.toHaveBeenCalled(); expect(setReaction).not.toHaveBeenCalled();
});
it('rejects malformed payloads and reports storage failure instead of empty reactions', async () => {
  expect((await PUT(new Request('http://localhost/api/comment-reactions', { method: 'PUT', body: 'bad' }))).status).toBe(422);
  vi.mocked(readReactions).mockRejectedValue(new Error('offline'));
  expect((await GET(new Request('http://localhost/api/comment-reactions'))).status).toBe(503);
});
