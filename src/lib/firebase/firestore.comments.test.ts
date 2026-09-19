import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addDocMock,
  collectionMock,
  serverTimestampMock,
  getFirebaseDbMock,
  getDocsMock,
  getDocsFromServerMock,
  orderByMock,
  limitMock,
  parentGetMock,
} = vi.hoisted(() => ({
  addDocMock: vi.fn(),
  collectionMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'SERVER_TIMESTAMP'),
  getFirebaseDbMock: vi.fn(() => 'DB'),
  getDocsMock: vi.fn(),
  getDocsFromServerMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
  parentGetMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: vi.fn((...args) => args.length === 1 ? { id: 'comment-1' } : 'PARENT'),
  runTransaction: vi.fn(async (_db, fn) => fn({ get: parentGetMock, set: (_ref: unknown, data: unknown) => addDocMock('COMMENTS_COLLECTION', data) })),
  addDoc: addDocMock,
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: getDocsMock,
  getDocsFromServer: getDocsFromServerMock,
  setDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: orderByMock,
  onSnapshot: vi.fn(),
  serverTimestamp: serverTimestampMock,
  writeBatch: vi.fn(),
  Timestamp: class Timestamp {},
  documentId: vi.fn(),
  limit: limitMock,
}));

vi.mock('./config', () => ({
  getFirebaseDb: getFirebaseDbMock,
}));

import { createAttachment, createChecklist, createComment, getRecentTaskComments, taskHasComments } from './firestore';

describe('createComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionMock.mockReturnValue('COMMENTS_COLLECTION');
    parentGetMock.mockResolvedValue({ exists: () => true, data: () => ({projectId:'project-1'}) });
    addDocMock.mockResolvedValue({ id: 'comment-1' });
  });

  it('rejects all new child records when a stale tab refers to a moved task', async () => {
    parentGetMock.mockResolvedValue({ exists: () => false });
    await expect(createComment('project-1','task-1',{content:'保存前の内容',authorId:'user-1',mentions:[]})).rejects.toThrow('移動・削除');
    await expect(createChecklist('project-1','task-1',{title:'手順',order:0,items:[]})).rejects.toThrow('移動・削除');
    await expect(createAttachment('project-1','task-1',{name:'原本',url:'https://example.test/file',type:'text/plain',size:1,uploadedBy:'user-1'})).rejects.toThrow('移動・削除');
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('omits undefined optional fields from the Firestore payload', async () => {
    await expect(
      createComment('project-1', 'task-1', {
        content: 'Comment with image',
        authorId: 'user-1',
        mentions: [],
        attachments: [],
      })
    ).resolves.toBe('comment-1');

    expect(collectionMock).toHaveBeenCalledWith(
      'DB',
      'projects',
      'project-1',
      'tasks',
      'task-1',
      'comments'
    );
    expect(addDocMock).toHaveBeenCalledWith('COMMENTS_COLLECTION', {
      content: 'Comment with image',
      authorId: 'user-1',
      authorIcon: null,
      mentions: [],
      attachments: [],
      taskId: 'task-1',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('preserves authorLabel when it is provided', async () => {
    await createComment('project-1', 'task-1', {
      content: 'Named comment',
      authorId: 'user-1',
      authorLabel: 'Naofumi',
      mentions: [],
      attachments: [],
    });

    expect(addDocMock).toHaveBeenCalledWith('COMMENTS_COLLECTION', {
      content: 'Named comment',
      authorId: 'user-1',
      authorLabel: 'Naofumi',
      authorIcon: null,
      mentions: [],
      attachments: [],
      taskId: 'task-1',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('reads the newest bounded comment preview without creating a comment', async () => {
    getDocsMock.mockResolvedValue({ docs: [{ id: 'comment-1', data: () => ({ content: '実コメント', createdAt: { toDate: () => new Date(2026, 8, 3) } }) }] });
    const comments = await getRecentTaskComments('project-1', 'task-1', 10);
    expect(collectionMock).toHaveBeenCalledWith('DB', 'projects', 'project-1', 'tasks', 'task-1', 'comments');
    expect(orderByMock).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(comments[0]).toMatchObject({ id: 'comment-1', content: '実コメント', createdAt: new Date(2026, 8, 3) });
    expect(addDocMock).not.toHaveBeenCalled();
  });
});

it('checks only one server comment without a timestamp filter and distinguishes offline from zero', async () => {
  vi.clearAllMocks();
  getDocsFromServerMock.mockResolvedValueOnce({ empty: false }).mockResolvedValueOnce({ empty: true }).mockRejectedValueOnce(new Error('offline'));
  await expect(taskHasComments('project', 'task')).resolves.toBe(true);
  expect(limitMock).toHaveBeenCalledWith(1);
  expect(orderByMock).not.toHaveBeenCalled();
  expect(getDocsMock).not.toHaveBeenCalled();
  await expect(taskHasComments('project', 'task')).resolves.toBe(false);
  await expect(taskHasComments('project', 'task')).rejects.toThrow('offline');
  expect(addDocMock).not.toHaveBeenCalled();
});
