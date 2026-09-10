import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentSubmission } from '@/lib/task/commentSubmission';

const fake = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), writes: [] as { path: string; data: Record<string, unknown> }[], uid: 'author', loseAck: false, failCommit: false, commits: 0 }));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db', getFirebaseAuth: () => ({ currentUser: fake.uid ? { uid: fake.uid } : null }) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  serverTimestamp: () => 'SERVER_TIME', Timestamp: { fromDate: (date: Date) => date },
  runTransaction: async (_db: unknown, fn: (tx: unknown) => unknown) => {
    const writes: typeof fake.writes = [];
    const result = await fn({ get: async (path: string) => ({ exists: () => fake.data.has(path), data: () => fake.data.get(path) }), set: (path: string, data: Record<string, unknown>) => writes.push({ path, data }) });
    if (fake.failCommit) throw new Error('offline');
    writes.forEach(write => fake.data.set(write.path, write.data));
    fake.writes.push(...writes); if (writes.length) fake.commits++;
    if (fake.loseAck) { fake.loseAck = false; throw new Error('ack lost'); }
    return result;
  },
}));
import { submitTaskComment } from './commentSubmission';
const input = (changes: Partial<CommentSubmission> = {}): CommentSubmission => ({ id: 'intent', projectId: 'p', taskId: 'parent', authorId: 'author', authorName: 'Kozue', content: '見てください', notifyIds: [], review: null, attachments: [], ...changes });
beforeEach(() => {
  fake.data.clear(); fake.writes = []; fake.uid = 'author'; fake.loseAck = false; fake.failCommit = false; fake.commits = 0;
  fake.data.set('projects/p', { name: '展示会', memberIds: ['author','reviewer-a','reviewer-b','watcher'], isArchived: false });
  fake.data.set('projects/p/tasks/parent', { title: '梱包準備', listId: 'list', isArchived: false });
});
describe('shared comment submission transaction', () => {
  it('posts ordinary comments without notifying anyone unless selected', async () => {
    await submitTaskComment(input());
    expect(fake.writes.map(w => w.path)).toEqual(['projects/p/tasks/parent/comments/intent','projects/p/activityLogs/comment-intent']);
    expect(fake.data.get('projects/p/tasks/parent')).toEqual({ title: '梱包準備', listId: 'list', isArchived: false });
  });
  it('atomically creates one child for all assignees plus one notification per selected member', async () => {
    const request = input({ notifyIds: ['watcher','reviewer-a','watcher'], review: { content: '緩衝材の強度を確認\n箱に入れてみる', assigneeIds: ['reviewer-a','reviewer-b','reviewer-a'], dueDate: '2026-09-13' } });
    const result = await submitTaskComment(request);
    expect(result.reviewTaskId).toBe('review-intent');
    expect(fake.commits).toBe(1);
    expect(fake.data.get('projects/p/tasks/review-intent')).toMatchObject({ parentTaskId: 'parent', sourceCommentId: 'intent', taskKind: 'review_request', assigneeIds: ['reviewer-a','reviewer-b'], isCompleted: false, isArchived: false, dueDate: new Date(2026,8,13), listId:'list', description: request.review!.content });
    expect(fake.data.get('projects/p/tasks/parent/comments/intent')).toMatchObject({ reviewTaskId: 'review-intent', mentions: ['watcher','reviewer-a','reviewer-b'] });
    const notifications = fake.writes.filter(w => w.path.startsWith('notifications/'));
    expect(notifications).toHaveLength(3);
    expect(notifications.map(w => [w.data.userId,w.data.type,w.data.taskId])).toEqual([['watcher','comment_added','parent'],['reviewer-a','review_requested','review-intent'],['reviewer-b','review_requested','review-intent']]);
    expect(notifications.some(w => w.data.userId === 'author')).toBe(false);
  });
  it('creates no partial comment, request, or notifications on commit failure', async () => {
    fake.failCommit = true;
    await expect(submitTaskComment(input({ review: {content:'確認',assigneeIds:['reviewer-a'],dueDate:null} }))).rejects.toThrow('offline');
    expect(fake.writes).toEqual([]); expect(fake.data.size).toBe(2);
  });
  it('retries an uncertain result without overwriting completion/read states, even after comment deletion', async () => {
    const request = input({ review: { content: '確認', assigneeIds: ['reviewer-a'], dueDate: null } });
    fake.loseAck = true;
    await expect(submitTaskComment(request)).rejects.toThrow('ack lost');
    fake.data.get('projects/p/tasks/review-intent')!.isCompleted = true;
    fake.data.get('notifications/intent:reviewer-a')!.isRead = true;
    fake.data.delete('projects/p/tasks/parent/comments/intent');
    const originalWrites = fake.writes.length;
    expect(await submitTaskComment(request)).toMatchObject({ alreadySubmitted:true });
    expect(fake.writes).toHaveLength(originalWrites);
    expect(fake.data.get('projects/p/tasks/review-intent')!.isCompleted).toBe(true);
    expect(fake.data.get('notifications/intent:reviewer-a')!.isRead).toBe(true);
    expect(fake.data.has('projects/p/tasks/parent/comments/intent')).toBe(false);
  });
  it('rejects non-members, archived parents, spoofed senders, missing requests and invalid dates', async () => {
    await expect(submitTaskComment(input({ notifyIds:['outsider'] }))).rejects.toThrow('参加していない');
    await expect(submitTaskComment(input({ review: { content:'確認',assigneeIds:[],dueDate:null } }))).rejects.toThrow('担当者');
    await expect(submitTaskComment(input({ review: { content:'確認',assigneeIds:['reviewer-a'],dueDate:'2026-02-30' } }))).rejects.toThrow('日付');
    fake.uid = 'other'; await expect(submitTaskComment(input())).rejects.toThrow('ログイン');
    fake.uid = 'author'; fake.data.get('projects/p/tasks/parent')!.isArchived = true;
    await expect(submitTaskComment(input())).rejects.toThrow('アーカイブ');
    expect(fake.writes).toEqual([]);
  });
});
