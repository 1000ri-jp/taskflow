import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addDocMock,
  collectionMock,
  serverTimestampMock,
  getFirebaseDbMock,
  getDocsMock,
  orderByMock,
  limitMock,
} = vi.hoisted(() => ({
  addDocMock: vi.fn(),
  collectionMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'SERVER_TIMESTAMP'),
  getFirebaseDbMock: vi.fn(() => 'DB'),
  getDocsMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: vi.fn(),
  addDoc: addDocMock,
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: getDocsMock,
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

import { createComment, getRecentTaskComments } from './firestore';

describe('createComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionMock.mockReturnValue('COMMENTS_COLLECTION');
    addDocMock.mockResolvedValue({ id: 'comment-1' });
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
