import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminDb } from './admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { COUNTDOWN_DOCUMENT, readSharedCountdown, saveSharedCountdown } from './admin-countdown';

vi.mock('./admin', () => ({ getAdminDb: vi.fn() }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: vi.fn() }));
const records = new Map<string, Record<string, unknown>>();
const reads = vi.fn();
const writes = vi.fn();
function snapshot(path: string) { reads(path); return { exists: records.has(path), data: () => records.get(path) }; }
function reference(path: string) {
  return { path, get: async () => snapshot(path), collection: (name: string) => ({ doc: (id: string) => reference(`${path}/${name}/${id}`) }) };
}
const transaction = {
  get: async (ref: { path: string }) => snapshot(ref.path),
  set: (ref: { path: string }, value: Record<string, unknown>) => { writes(ref.path, value); records.set(ref.path, value); },
};
const target = { projectId: 'p1', taskId: 't1' };
describe('shared countdown storage', () => {
  beforeEach(() => {
    vi.resetAllMocks(); records.clear();
    records.set('projects/p1', { name: '展示会', isArchived: false });
    records.set('projects/p1/tasks/t1', { title: '出展', dueDate: new Date('2026-09-23T00:00:00+09:00') });
    vi.mocked(getProjectAccess).mockResolvedValue({ role: 'editor' });
    vi.mocked(getAdminDb).mockReturnValue({ doc: reference, collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }), runTransaction: async (fn: (tx: typeof transaction) => Promise<void>) => fn(transaction) } as unknown as ReturnType<typeof getAdminDb>);
  });
  it('uses a single shared document, leaves task content untouched, and reads live dates', async () => {
    expect((await readSharedCountdown('a')).status).toBe('unset');
    await saveSharedCountdown('a', target, 0);
    expect(writes).toHaveBeenCalledExactlyOnceWith(COUNTDOWN_DOCUMENT, { target, revision: 1 });
    expect(getProjectAccess).toHaveBeenCalledWith('a', 'p1', null, null, 'tasks:write');
    const first = await readSharedCountdown('b');
    expect(first.target).toEqual(target);
    expect(first.task?.title).toBe('出展');
    records.get('projects/p1/tasks/t1')!.dueDate = { toDate: () => new Date('2026-09-24T00:00:00+09:00') };
    expect((await readSharedCountdown('b')).task?.dueDate).toBe('2026-09-23T15:00:00.000Z');
    await saveSharedCountdown('a', null, 1);
    expect(writes).toHaveBeenLastCalledWith(COUNTDOWN_DOCUMENT, { target: null, revision: 2 });
    expect(records.get('projects/p1/tasks/t1')!.title).toBe('出展');
  });
  it('rejects conflicts without overwriting another user’s choice', async () => {
    records.set(COUNTDOWN_DOCUMENT, { target, revision: 3 });
    await expect(saveSharedCountdown('a', null, 2)).rejects.toThrow('CONFLICT');
    expect(writes).not.toHaveBeenCalled();
  });
  it('hides even target IDs for users without membership and rejects their edits', async () => {
    records.set(COUNTDOWN_DOCUMENT, { target, revision: 1 });
    vi.mocked(getProjectAccess).mockRejectedValue(new Error('FORBIDDEN'));
    expect(await readSharedCountdown('outsider')).toEqual({ status: 'restricted', target: null, task: null, revision: 1 });
    expect(reads).not.toHaveBeenCalledWith('projects/p1/tasks/t1');
    await expect(saveSharedCountdown('outsider', target, 1)).rejects.toThrow('FORBIDDEN');
    await expect(saveSharedCountdown('outsider', null, 1)).rejects.toThrow('FORBIDDEN');
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([{ isArchived: true }, { isCompleted: true }, { isAbandoned: true }, { dueDate: null }, { dueDate: 'bad' }])('rejects ineligible targets: %j', async (changes) => {
    Object.assign(records.get('projects/p1/tasks/t1')!, changes);
    await expect(saveSharedCountdown('a', target, 0)).rejects.toThrow('INVALID_COUNTDOWN_TASK');
    expect(writes).not.toHaveBeenCalled();
  });
  it('handles removed and archived targets and returns later completion instead of counting down', async () => {
    records.set(COUNTDOWN_DOCUMENT, { target, revision: 1 });
    records.get('projects/p1/tasks/t1')!.isCompleted = true;
    expect((await readSharedCountdown('b')).task?.isCompleted).toBe(true);
    records.get('projects/p1')!.isArchived = true;
    expect((await readSharedCountdown('b')).status).toBe('unavailable');
    records.delete('projects/p1/tasks/t1');
    expect((await readSharedCountdown('b')).task).toBeNull();
  });
});
