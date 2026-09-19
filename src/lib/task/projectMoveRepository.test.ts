// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/projects/[projectId]/tasks/[taskId]/move/route';
import { locateMovedTask, moveProjectTask, projectMoveContext } from './projectMoveRepository';
import { prepareRecurrence } from './recurrenceRepository';
import type { ProjectMoveInput, ProjectMovePreview } from './projectMove';
import type { Task } from '@/types';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
const fake = vi.hoisted(() => ({ db: null as unknown, failCommit: false }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, verifyAuthToken: async () => ({ uid: 'worker', email: 'worker@1000ri.jp' }) }));
type Row = Record<string, unknown>;
let docs: Map<string, Row>;
class Ref {
  constructor(public path: string) {} get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async get() { const data = docs.get(this.path); return { ref: this, id: this.id, exists: !!data, data: () => data ? structuredClone(data) : undefined }; }
}
class Query {
  maximum = Infinity; filter?: [string, string, unknown];
  constructor(public path: string) {} doc(id: string) { return new Ref(`${this.path}/${id}`); }
  where(key: string, op: string, value: unknown) { this.filter = [key, op, value]; return this; }
  limit(n: number) { this.maximum = n; return this; }
  async get() {
    const rows = await Promise.all([...docs.keys()].filter(path => {
      if (!path.startsWith(`${this.path}/`) || path.split('/').length !== this.path.split('/').length + 1) return false;
      if (!this.filter) return true;
      const [key, op, value] = this.filter, field = docs.get(path)?.[key];
      return op === 'array-contains' ? Array.isArray(field) && field.includes(value) : field === value;
    }).slice(0, this.maximum).map(path => new Ref(path).get()));
    return { docs: rows, size: rows.length };
  }
}
async function transaction<T>(fn: (tx: Transaction) => Promise<T>) {
  const writes: (() => void)[] = [];
  const result = await fn({
    get: (ref: Ref | Query) => { if (writes.length) throw new Error('read after write'); return ref.get(); },
    set: (ref: Ref, data: Row) => writes.push(() => docs.set(ref.path, structuredClone(data))),
    delete: (ref: Ref) => writes.push(() => docs.delete(ref.path)),
  } as unknown as Transaction);
  if (fake.failCommit) throw new Error('disconnected');
  writes.forEach(write => write()); return result;
}
const date = new Date('2026-09-14');
const input: ProjectMoveInput = { id: 'one', targetProjectId: 'q', listId: 'inbox' };
async function ready(extra: Partial<ProjectMoveInput> = {}) {
  const request = { ...input, ...extra };
  const preview = await moveProjectTask('worker', 'p', 'root', request, false) as ProjectMovePreview;
  return { ...request, version: preview.version };
}
beforeEach(() => {
  docs = new Map(); fake.failCommit = false;
  fake.db = { doc: (path: string) => new Ref(path), collection: (path: string) => new Query(path), runTransaction: transaction };
  for (const id of ['p', 'q']) {
    docs.set(`projects/${id}`, { name: id, memberIds: ['worker', 'peer'], isArchived: false });
    for (const uid of ['worker', 'peer']) docs.set(`projects/${id}/members/${uid}`, { userId: uid, role: 'editor' });
    docs.set(`projects/${id}/lists/inbox`, { name: '会計', order: 0, autoCompleteOnEnter: false });
  }
  const base = { projectId: 'p', listId: 'old', title: '出納帳レシート入力', description: '原文', assigneeIds: ['worker'], labelIds: [], tagIds: [], dependsOnTaskIds: [], isCompleted: false, isArchived: false, updatedAt: date, createdAt: date, dueDate: date };
  docs.set('projects/p/tasks/root', { ...base, labelIds: ['red'], tagIds: ['shop'], reviewRequests: { approval: { commentId: 'c1', assigneeIds: ['peer'], cycle: { nextTaskId: 'child' } } } });
  docs.set('projects/p/tasks/child', { ...base, title: 'レシートを集める', parentTaskId: 'root', assigneeIds: ['peer'], isCompleted: true });
  docs.set('projects/p/labels/red', { name: '経理', color: 'red', createdAt: date });
  docs.set('projects/p/tags/shop', { name: '印刷店', color: 'blue', createdAt: date });
  docs.set('projects/q/labels/red', { name: '別のラベル', color: 'pink' });
  docs.set('projects/q/tags/same', { name: '印刷店', color: 'blue' });
  docs.set('projects/p/tasks/root/comments/c1', { taskId: 'root', authorId: 'worker', content: '購入の報告', createdAt: date, attachments: [{ url: 'https://example.test/original.png' }] });
  docs.set('projects/p/tasks/root/checklists/list', { taskId: 'root', items: [{ id: 'line', text: '確認', isChecked: true }] });
  docs.set('projects/p/tasks/child/attachments/file', { taskId: 'child', url: 'https://example.test/receipt.pdf' });
  docs.set('projects/p/activityLogs/original', { projectId: 'p', targetId: 'root', action: 'update', changes: [{ field: 'description', oldValue: '', newValue: '原文' }], createdAt: date });
});
describe('project transfer transaction', () => {
  it('previews without writing and offers only editable destinations', async () => {
    const before = structuredClone([...docs]);
    expect(await projectMoveContext('worker', 'p', 'root')).toMatchObject({ currentName: 'p', projects: [{ id: 'q', lists: [{ id: 'inbox', name: '会計' }] }] });
    expect(await moveProjectTask('worker', 'p', 'root', input, false)).toMatchObject({ taskCount: 2, commentCount: 1, attachmentCount: 1, checklistCount: 1 });
    expect([...docs]).toEqual(before);
    docs.get('projects/q/members/worker')!.role = 'viewer';
    expect(await projectMoveContext('worker', 'p', 'root')).toMatchObject({ projects: [] });
  });
  it('moves the complete group with original text, attachments, reviews, dates, progress, labels and history', async () => {
    const request = await ready();
    const comment = structuredClone(docs.get('projects/p/tasks/root/comments/c1'));
    expect(await moveProjectTask('worker', 'p', 'root', request, true)).toEqual({ projectId: 'q', taskId: 'root' });
    expect(docs.has('projects/p/tasks/root')).toBe(false);
    expect(docs.has('projects/p/tasks/child/attachments/file')).toBe(false);
    expect(docs.get('projects/q/tasks/root/comments/c1')).toEqual(comment);
    expect(docs.get('projects/q/tasks/root')).toMatchObject({ projectId: 'q', listId: 'inbox', description: '原文', dueDate: date, labelIds: ['move-one-0'], tagIds: ['same'], reviewRequests: { approval: { commentId: 'c1' } } });
    expect(docs.get('projects/q/tasks/child')).toMatchObject({ parentTaskId: 'root', isCompleted: true, assigneeIds: ['peer'] });
    expect(docs.get('projects/q/labels/red')).toEqual({ name: '別のラベル', color: 'pink' });
    expect(docs.get('projects/q/labels/move-one-0')).toMatchObject({ name: '経理', color: 'red' });
    expect([...docs].some(([path, row]) => path.startsWith('projects/q/activityLogs/moved-') && row.action === 'update')).toBe(true);
    expect([...docs.keys()].some(path => path.startsWith('notifications/'))).toBe(false);
  });
  it('replays the committed result once after a lost response and never overwrites later edits', async () => {
    const request = await ready(); await moveProjectTask('worker', 'p', 'root', request, true);
    docs.get('projects/q/tasks/root')!.description = '他の人が編集';
    const before = structuredClone([...docs]);
    await moveProjectTask('worker', 'p', 'root', request, true);
    expect([...docs]).toEqual(before);
    await expect(moveProjectTask('worker', 'p', 'root', { ...request, listId: 'other' }, true)).rejects.toThrow('一致');
  });
  it.each(['p', 'q'])('checks current editing permission on %s even after preview', async project => {
    const request = await ready(); docs.get(`projects/${project}/members/worker`)!.role = 'viewer';
    const before = structuredClone([...docs]);
    await expect(moveProjectTask('worker', 'p', 'root', request, true)).rejects.toThrow('権限');
    expect([...docs]).toEqual(before);
  });
  it('rejects new comments or changed members since preview without moving anything', async () => {
    const request = await ready(); docs.set('projects/p/tasks/root/comments/new', { content: '後から投稿' });
    const before = structuredClone([...docs]);
    await expect(moveProjectTask('worker', 'p', 'root', request, true)).rejects.toThrow('確認後'); expect([...docs]).toEqual(before);
    const second = await ready(); docs.get('projects/q')!.memberIds = ['worker'];
    await expect(moveProjectTask('worker', 'p', 'root', second, true)).rejects.toThrow('参加していません');
  });
  it('keeps both projects unchanged when commit fails', async () => {
    const request = await ready(), before = structuredClone([...docs]); fake.failCommit = true;
    await expect(moveProjectTask('worker', 'p', 'root', request, true)).rejects.toThrow('disconnected'); expect([...docs]).toEqual(before);
    fake.failCommit = false; await moveProjectTask('worker', 'p', 'root', request, true);
    expect(docs.has('projects/q/tasks/root')).toBe(true);
  });
  it.each(['dependsOnTaskIds', 'relatedTaskIds'])('protects inbound %s from tasks staying behind', async field => {
    docs.set('projects/p/tasks/other', { title: '公開', [field]: ['child'] });
    await expect(ready()).rejects.toThrow('移動対象外');
  });
  it('protects milestones, active automation, and destination task/child collisions', async () => {
    docs.set('projects/p/milestones/event', { requiredTaskIds: ['root'] }); await expect(ready()).rejects.toThrow('節目'); docs.delete('projects/p/milestones/event');
    docs.get('projects/p/tasks/root')!.automation = { ownerId: 'worker', check: 'confirmed' }; await expect(ready()).rejects.toThrow('自動確認'); delete docs.get('projects/p/tasks/root')!.automation;
    docs.set('projects/q/tasks/root', { title: '既存' }); await expect(ready()).rejects.toThrow('同じ識別'); docs.delete('projects/q/tasks/root');
    docs.set('projects/q/tasks/root/comments/orphan', { content: '保持する' }); await expect(ready()).rejects.toThrow('以前の関連記録');
  });
  it('does not let a move trigger list completion automation', async () => {
    docs.get('projects/q/lists/inbox')!.autoCompleteOnEnter = true;
    await moveProjectTask('worker', 'p', 'root', await ready(), true);
    expect(docs.get('projects/q/tasks/root')!.isCompleted).toBe(false);
  });
  it('preserves recurrence receipts so reopen/recomplete cannot create another occurrence', async () => {
    const recurrence = { seriesId: 'monthly', occurrence: 0, unit: 'month', interval: 1, anchorDate: '2026-09-14', endDate: null, listId: 'old' };
    docs.get('projects/p/tasks/root')!.recurrence = recurrence;
    docs.set('projects/p/recurrenceReceipts/monthly-0', { sourceTaskId: 'root', nextTaskId: 'repeat-monthly-1', createdAt: date });
    await moveProjectTask('worker', 'p', 'root', await ready(), true);
    expect(docs.get('projects/q/tasks/root')!.recurrence).toMatchObject({ listId: 'inbox' });
    await transaction(async tx => { const task = { ...docs.get('projects/q/tasks/root'), id: 'root' } as Task; const write = await prepareRecurrence(tx, new Ref('projects/q/tasks/root') as unknown as DocumentReference, task, date); write(); });
    expect(docs.has('projects/q/tasks/repeat-monthly-1')).toBe(false);
  });
  it('follows root, subtask and review links and supports moving back without pointer cycles', async () => {
    await moveProjectTask('worker', 'p', 'root', await ready(), true);
    expect(await locateMovedTask('worker', 'p', 'child')).toEqual({ projectId: 'q', taskId: 'child' });
    expect(await locateMovedTask('worker', 'p', 'approval')).toEqual({ projectId: 'q', taskId: 'root', commentId: 'c1' });
    const back = { id: 'back', targetProjectId: 'p', listId: 'inbox' };
    const preview = await moveProjectTask('worker', 'q', 'root', back, false) as ProjectMovePreview;
    await moveProjectTask('worker', 'q', 'root', { ...back, version: preview.version }, true);
    expect(await locateMovedTask('worker', 'q', 'root')).toEqual({ projectId: 'p', taskId: 'root' });
    expect(await locateMovedTask('worker', 'p', 'root')).toBeNull();
  });
  it('does not reveal moved content to someone who cannot read the destination', async () => {
    await moveProjectTask('worker', 'p', 'root', await ready(), true);
    docs.get('projects/q/members/worker')!.role = 'viewer';
    expect(await locateMovedTask('worker', 'p', 'root')).toEqual({ projectId: 'q', taskId: 'root' });
    docs.get('projects/q')!.memberIds = ['peer'];
    expect(await locateMovedTask('worker', 'p', 'root')).toBeNull();
  });
  it('rejects forged or oversized request shapes through the authenticated route', async () => {
    const context = { params: Promise.resolve({ projectId: 'p', taskId: 'root' }) };
    for (const body of [{ ...input, action: 'move', uid: 'peer' }, { ...input, action: 'move', version: 'forged' }, { action: 'unexpected' }]) {
      const response = await POST(new NextRequest('https://example.test/api', { method: 'POST', body: JSON.stringify(body) }), context);
      expect(response.status).toBe(400); expect((await response.json()).rejected).toBe(true);
    }
    expect(docs.has('projects/p/tasks/root')).toBe(true);
  });
});
