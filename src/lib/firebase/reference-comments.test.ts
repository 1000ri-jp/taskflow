import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('./config', () => ({ getFirebaseDb: () => ({}), getFirebaseAuth: () => ({ currentUser: { uid: 'editor' } }) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  serverTimestamp: () => 'SERVER_TIME', runTransaction: (_db: unknown, callback: (t: typeof mocks) => unknown) => callback(mocks),
}));
import { postReferenceComment, changeReferenceComment } from './reference-comments';
import type { ReferenceComment } from '@/types';
const parent = { exists: () => true, data: () => ({ isArchived: false }) };
const missing = { exists: () => false };
const input = { id: 'same-post', content: ' new comment ', authorLabel: 'Editor', attachments: [] };
describe('reference comment persistence', () => {
  beforeEach(() => vi.clearAllMocks());
  it('creates a separate comment document without overwriting reference content', async () => {
    mocks.get.mockResolvedValueOnce(parent).mockResolvedValueOnce(missing);
    await postReferenceComment('p', 'r', input);
    expect(mocks.set).toHaveBeenCalledWith('projects/p/references/r/comments/same-post', expect.objectContaining({ content: 'new comment', authorId: 'editor', createdAt: 'SERVER_TIME' }));
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('retry after an uncertain success leaves the existing post unchanged', async () => {
    mocks.get.mockResolvedValueOnce(parent).mockResolvedValueOnce({ exists: () => true, data: () => ({ authorId: 'editor' }) });
    await postReferenceComment('p', 'r', input);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('does not post to an archived reference', async () => {
    mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ isArchived: true }) });
    await expect(postReferenceComment('p', 'r', input)).rejects.toThrow('保管');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('stale edits and deletes cannot overwrite a newer comment', async () => {
    const comment = { id: 'c', updatedAt: new Date(1) } as ReferenceComment;
    for (const content of ['changed', null]) {
      mocks.get.mockResolvedValueOnce(parent).mockResolvedValueOnce({ exists: () => true, data: () => ({ updatedAt: { toMillis: () => 2 } }) });
      await expect(changeReferenceComment('p', 'r', comment, content)).rejects.toThrow('更新');
    }
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
});
