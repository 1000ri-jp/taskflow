import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  project: { memberIds: ['owner', 'existing'] },
  get: vi.fn(), set: vi.fn(), update: vi.fn(), delete: vi.fn(),
}));
vi.mock('./config', () => ({ getFirebaseDb: () => 'db', getFirebaseAuth: vi.fn() }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  serverTimestamp: () => 'timestamp',
  runTransaction: async (_db: unknown, fn: (tx: typeof state) => Promise<void>) => fn(state),
}));
import { addProjectMember, removeProjectMember } from './firestore';
beforeEach(() => {
  vi.clearAllMocks(); state.project = { memberIds: ['owner', 'existing'] };
  state.get.mockImplementation(async () => ({ exists: () => true, data: () => state.project }));
});
it('adds a UID document and membership array in the same transaction without losing other members', async () => {
  await addProjectMember('p', 'new', 'editor');
  expect(state.set).toHaveBeenCalledWith('projects/p/members/new', expect.objectContaining({ userId: 'new', role: 'editor' }));
  expect(state.update).toHaveBeenCalledWith('projects/p', expect.objectContaining({ memberIds: ['owner', 'existing', 'new'] }));
});
it('removes the UID document and array entry together', async () => {
  await removeProjectMember('p', 'existing', 'existing');
  expect(state.delete).toHaveBeenCalledWith('projects/p/members/existing');
  expect(state.update).toHaveBeenCalledWith('projects/p', expect.objectContaining({ memberIds: ['owner'] }));
});
it('rejects unmigrated IDs before writing anything', async () => {
  await expect(removeProjectMember('p', 'random-id', 'existing')).rejects.toThrow('移行');
  expect(state.delete).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
