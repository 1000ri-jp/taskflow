import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
  collection: vi.fn((_db: unknown, ...path: string[]) => path.join('/')),
  writeBatch: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(() => 'PROJECT_REF'),
  getDoc: vi.fn(),
  getFirebaseDb: vi.fn(() => 'DB'),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  addDoc: mocks.addDoc,
  updateDoc: mocks.updateDoc,
  deleteDoc: mocks.deleteDoc,
  getDoc: mocks.getDoc,
  getDocs: vi.fn(),
  setDoc: mocks.setDoc,
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: mocks.onSnapshot,
  serverTimestamp: mocks.serverTimestamp,
  writeBatch: mocks.writeBatch,
  Timestamp: class Timestamp {},
  documentId: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('./config', () => ({
  getFirebaseDb: mocks.getFirebaseDb,
}));

import { createProject, createReference, deleteProject, subscribeToArchivedTasks, subscribeToProjectTasks, updateList, updateReference } from './firestore';
import type { Project } from '@/types';

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion while the project is active', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ isArchived: false }),
    });

    await expect(deleteProject('project-1')).rejects.toThrow(
      'プロジェクトを削除するには先にアーカイブしてください'
    );
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('deletes an archived project', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ isArchived: true }),
    });

    await deleteProject('project-1');

    expect(mocks.doc).toHaveBeenCalledWith('DB', 'projects', 'project-1');
    expect(mocks.deleteDoc).toHaveBeenCalledWith('PROJECT_REF');
  });
});

it('creates a project without a second priority or progress classification to maintain', async () => {
  vi.clearAllMocks();
  mocks.addDoc.mockResolvedValue({ id: 'new-project' });
  const project = { name: '天然石の制作', description: '', ownerId: 'owner', memberIds: ['owner'], isArchived: false } as Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
  expect(await createProject(project, 'owner')).toBe('new-project');
  expect(mocks.addDoc.mock.calls.map(([path]) => path)).toEqual(['projects']);
  expect(mocks.addDoc).toHaveBeenCalledWith('projects', expect.objectContaining({ name: project.name, ownerId: 'owner', memberIds: ['owner'] }));
  expect(mocks.doc).toHaveBeenCalledWith('DB', 'projects', 'new-project', 'members', 'owner');
  expect(mocks.setDoc).toHaveBeenCalledWith('PROJECT_REF', expect.objectContaining({ userId: 'owner', role: 'admin' }));
  expect(mocks.writeBatch).not.toHaveBeenCalled();
});

it('does not send optional undefined fields when saving list references', async () => {
  vi.clearAllMocks();
  mocks.addDoc.mockResolvedValue({ id: 'reference-1' });
  const input = {
    listId: 'list-1', title: '会場マップ', body: '確認用', links: [], attachments: [], order: 1,
    createdBy: 'owner', updatedBy: 'owner', isArchived: false, sourceTaskId: undefined, conversionId: undefined,
  };
  expect(await createReference('project-1', input)).toBe('reference-1');
  const created = mocks.addDoc.mock.calls[0][1] as Record<string, unknown>;
  expect(created).not.toHaveProperty('sourceTaskId');
  expect(created).not.toHaveProperty('conversionId');
  await updateReference('project-1', 'reference-1', { sourceTaskId: undefined, conversionId: undefined });
  const updated = mocks.updateDoc.mock.calls[0][1] as Record<string, unknown>;
  expect(updated).not.toHaveProperty('sourceTaskId');
  expect(updated).not.toHaveProperty('conversionId');
});

it('returns archived tasks newest first, keeps undated legacy rows, and forwards retrieval failure', () => {
  const receive = vi.fn(); const failed = vi.fn(); const stop = vi.fn();
  mocks.onSnapshot.mockReturnValue(stop);
  const unsubscribe = subscribeToArchivedTasks('project-1', receive, failed);
  const [, next, error] = mocks.onSnapshot.mock.calls.at(-1)!;
  const row = (id: string, date: Date | null) => ({ id, data: () => ({ title: id, archivedAt: date ? { toDate: () => date } : null, isArchived: true }) });
  next({ docs: [row('older', new Date('2026-09-10')), row('unknown', null), row('newer', new Date('2026-09-16'))] });
  expect(receive.mock.calls[0][0].map((task: { id: string }) => task.id)).toEqual(['newer', 'older', 'unknown']);
  const reason = new Error('permission-denied'); error(reason);
  expect(failed).toHaveBeenCalledWith(reason); expect(unsubscribe).toBe(stop);
});

it('uses the containing project for a request task whose stored projectId is absent', () => {
  vi.clearAllMocks();
  const receive = vi.fn();
  subscribeToProjectTasks('project-1', receive);
  const [, next] = mocks.onSnapshot.mock.calls.at(-1)!;
  next({ docs: [{ id: 'request-legacy', data: () => ({ title: '要望のタスク', isArchived: false }) }] });
  expect(receive.mock.calls[0][0][0]).toMatchObject({ id: 'request-legacy', projectId: 'project-1' });
});

it('validates and saves a list primary assignee through the existing list document', async () => {
  vi.clearAllMocks();
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ memberIds: ['main', 'other'] }) });
  await updateList('project-1', 'list-1', { defaultAssigneeId: 'other' });
  expect(mocks.updateDoc).toHaveBeenCalledWith('PROJECT_REF', expect.objectContaining({ defaultAssigneeId: 'other' }));
  vi.clearAllMocks();
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ memberIds: ['main'] }) });
  await expect(updateList('project-1', 'list-1', { defaultAssigneeId: 'outsider' })).rejects.toThrow('主担当はプロジェクトのメンバーから選んでください');
  expect(mocks.updateDoc).not.toHaveBeenCalled();
});
