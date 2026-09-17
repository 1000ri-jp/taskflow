import { beforeEach, expect, it, vi } from 'vitest';
import { reorderUserProjects, subscribeToUserProjects } from './firestore';
import type { Project } from '@/types';

const fake = vi.hoisted(() => ({
  uid: 'alice',
  listeners: new Map<string, { next: (snapshot: unknown) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }>(),
  docs: new Map<string, Record<string, unknown>>(),
  update: vi.fn(),
}));
vi.mock('./config', () => ({ getFirebaseDb: () => ({}), getFirebaseAuth: () => ({ currentUser: { uid: fake.uid } }) }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, path: string) => path,
  where: (...parts: string[]) => parts,
  query: (_collection: string, memberQuery: string[]) => `projects:${memberQuery[2]}`,
  onSnapshot: (path: string, next: (snapshot: unknown) => void, error: (error: Error) => void) => {
    const stop = vi.fn(); fake.listeners.set(path, { next, error, stop }); return stop;
  },
  updateDoc: (...args: unknown[]) => fake.update(...args),
}));
const emitProjects = (uid: string, ids = ['a', 'b']) => fake.listeners.get(`projects:${uid}`)!.next({
  docs: ids.map((id, order) => ({ id, data: () => ({ name: id, order }) })),
});
const emitUser = (uid: string) => fake.listeners.get(`users/${uid}`)!.next({ data: () => fake.docs.get(`users/${uid}`) });
const ids = (callback: ReturnType<typeof vi.fn>) => (callback.mock.lastCall![0] as Project[]).map(project => project.id);
beforeEach(() => {
  vi.clearAllMocks(); fake.uid = 'alice'; fake.listeners.clear(); fake.docs.clear();
  fake.docs.set('users/alice', { displayName: 'Alice', photoURL: 'custom.png' });
  fake.docs.set('users/bob', { displayName: 'Bob', projectOrder: ['a', 'b'] });
  fake.docs.set('projects/a', { order: 0, name: 'a' }); fake.docs.set('projects/b', { order: 1, name: 'b' });
  fake.update.mockImplementation(async (path: string, data: Record<string, unknown>) => {
    fake.docs.set(path, { ...fake.docs.get(path), ...data }); emitUser(path.split('/')[1]);
  });
});
it('saves only the caller order and preserves shared projects, profiles and the other user', async () => {
  const alice = vi.fn(); const bob = vi.fn();
  subscribeToUserProjects('alice', alice); subscribeToUserProjects('bob', bob);
  emitProjects('alice'); emitProjects('bob'); expect(alice).not.toHaveBeenCalled();
  emitUser('alice'); emitUser('bob'); expect(ids(alice)).toEqual(['a', 'b']);
  const shared = structuredClone([...fake.docs]);
  await reorderUserProjects('alice', ['b', 'a']);
  expect(ids(alice)).toEqual(['b', 'a']); expect(ids(bob)).toEqual(['a', 'b']);
  expect(fake.update).toHaveBeenCalledExactlyOnceWith('users/alice', { projectOrder: ['b', 'a'] });
  expect(fake.docs.get('users/alice')).toEqual({ displayName: 'Alice', photoURL: 'custom.png', projectOrder: ['b', 'a'] });
  for (const [path, doc] of shared.filter(([path]) => path !== 'users/alice')) expect(fake.docs.get(path)).toEqual(doc);
  const reloaded = vi.fn(); subscribeToUserProjects('alice', reloaded); emitUser('alice'); emitProjects('alice');
  expect(ids(reloaded)).toEqual(['b', 'a']);
});
it('appends new projects and ignores missing, duplicate or invalid saved entries', () => {
  fake.docs.set('users/alice', { projectOrder: ['gone', 'b', 'b', null] });
  const listener = vi.fn(); subscribeToUserProjects('alice', listener); emitUser('alice'); emitProjects('alice', ['a', 'b', 'c']);
  expect(ids(listener)).toEqual(['b', 'a', 'c']);
  emitProjects('alice', ['a', 'c']); expect(ids(listener)).toEqual(['a', 'c']);
  fake.docs.set('users/alice', { projectOrder: 'bad' }); emitUser('alice'); expect(ids(listener)).toEqual(['a', 'c']);
  expect(fake.update).not.toHaveBeenCalled();
});
it('rejects another account and malformed reorder without writing', async () => {
  await expect(reorderUserProjects('bob', ['b', 'a'])).rejects.toThrow('ログイン');
  await expect(reorderUserProjects('alice', ['a', 'a'])).rejects.toThrow('一覧');
  await expect(reorderUserProjects('alice', [''])).rejects.toThrow('一覧');
  expect(fake.update).not.toHaveBeenCalled();
});
it('exposes read and write failures without overwriting the saved order', async () => {
  const listener = vi.fn(); const error = vi.fn(); subscribeToUserProjects('alice', listener, error); emitProjects('alice');
  const denied = new Error('permission-denied'); fake.listeners.get('users/alice')!.error(denied);
  expect(ids(listener)).toEqual(['a', 'b']); expect(error).toHaveBeenLastCalledWith(denied);
  const before = structuredClone(fake.docs.get('users/alice'));
  fake.update.mockRejectedValue(denied);
  await expect(reorderUserProjects('alice', ['b', 'a'])).rejects.toThrow('permission-denied');
  expect(fake.docs.get('users/alice')).toEqual(before);
});
it('unsubscribes both sources and ignores late callbacks from the previous account', () => {
  const listener = vi.fn(); const errors = vi.fn(); const stop = subscribeToUserProjects('alice', listener, errors);
  emitProjects('alice'); emitUser('alice'); listener.mockClear(); stop();
  emitProjects('alice'); emitUser('alice'); fake.listeners.get('users/alice')!.error(new Error('late'));
  expect(listener).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
  expect(fake.listeners.get('users/alice')!.stop).toHaveBeenCalledOnce();
  expect(fake.listeners.get('projects:alice')!.stop).toHaveBeenCalledOnce();
});
