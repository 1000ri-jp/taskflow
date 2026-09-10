import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectLists, getRecentTaskComments, getUsersByIds } from '@/lib/firebase/firestore';
import { commentPreview, loadDashboardComments } from './comments';
import type { Comment, List, User } from '@/types';

vi.mock('@/lib/firebase/firestore', () => ({ getProjectLists: vi.fn(), getRecentTaskComments: vi.fn(), getUsersByIds: vi.fn() }));
const task = { id: 'task-1', projectId: 'p1', listId: 'l1' };
const comment = (id: string, day: number, authorLabel?: string): Comment => ({ id, taskId: task.id, content: id, authorId: 'author', authorLabel, mentions: [], createdAt: new Date(2026, 8, day), updatedAt: new Date(2026, 8, day) });
describe('loadDashboardComments', () => {
  it('previews long text and attachment-only comments without changing the source', () => {
    const source = { content: 'あ'.repeat(110) };
    expect(commentPreview(source)).toBe(`${'あ'.repeat(100)}…`);
    expect(source.content).toHaveLength(110);
    expect(commentPreview({ content: '   ', attachments: [{ id: 'file' } as NonNullable<Comment['attachments']>[number]] })).toBe('添付ファイル 1件');
    expect(commentPreview({ content: '改行\nあり' })).toBe('改行 あり');
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getProjectLists).mockResolvedValue([{ id: 'l1', name: '上位の列' } as List]);
    vi.mocked(getUsersByIds).mockResolvedValue([{ id: 'author', displayName: '投稿した人' } as User]);
    vi.mocked(getRecentTaskComments).mockResolvedValue([]);
  });
  it('merges newest comments across projects, caps the feed, and retains source context', async () => {
    vi.mocked(getRecentTaskComments).mockImplementation(async (projectId) => projectId === 'p1'
      ? Array.from({ length: 10 }, (_, index) => comment(`a-${index}`, index + 1))
      : [comment('b-latest', 12, '投稿名'), comment('b-older', 2)]);
    const result = await loadDashboardComments([task, { ...task, projectId: 'p2' }]);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toMatchObject({ projectId: 'p2', taskId: 'task-1', authorName: '投稿名', listName: '上位の列', comment: { id: 'b-latest' } });
    expect(result.items[1].authorName).toBe('投稿した人');
    expect(getRecentTaskComments).toHaveBeenCalledWith('p1', 'task-1', 10);
    expect(getUsersByIds).toHaveBeenCalledWith(['author']);
    expect(new Set(result.items.map((item) => item.key)).size).toBe(10);
  });
  it('reports partial and total failures separately from zero comments', async () => {
    vi.mocked(getRecentTaskComments).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([comment('visible', 3)]);
    const partial = await loadDashboardComments([task, { ...task, projectId: 'p2' }]);
    expect(partial.failedTasks).toBe(1);
    expect(partial.items).toHaveLength(1);
    vi.mocked(getRecentTaskComments).mockRejectedValue(new Error('offline'));
    expect(await loadDashboardComments([task])).toMatchObject({ failedTasks: 1, items: [] });
    vi.mocked(getRecentTaskComments).mockResolvedValue([]);
    expect(await loadDashboardComments([task])).toMatchObject({ failedTasks: 0, items: [] });
  });
  it('keeps comments when optional names cannot load, without inventing names', async () => {
    vi.mocked(getRecentTaskComments).mockResolvedValue([comment('real', 3)]);
    vi.mocked(getUsersByIds).mockRejectedValue(new Error('offline'));
    vi.mocked(getProjectLists).mockRejectedValue(new Error('offline'));
    expect(await loadDashboardComments([task])).toMatchObject({ metadataIncomplete: true, items: [{ authorName: '投稿者名未取得', listName: '列名未取得' }] });
  });
  it('bounds concurrency and stops queued reads when cancelled', async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(getRecentTaskComments).mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return []; });
    await loadDashboardComments(Array.from({ length: 20 }, (_, index) => ({ ...task, id: String(index) })));
    expect(peak).toBeLessThanOrEqual(6);
    vi.clearAllMocks();
    await loadDashboardComments([task], () => true);
    expect(getRecentTaskComments).not.toHaveBeenCalled();
    expect(getProjectLists).not.toHaveBeenCalled();
  });
});
