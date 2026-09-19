import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  where: vi.fn(),
  getFirebaseDb: vi.fn(() => 'DB'),
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: vi.fn(() => 'NOTIFICATIONS'),
  query: vi.fn(() => 'QUERY'),
  where: mocks.where,
  orderBy: vi.fn(),
  onSnapshot: mocks.onSnapshot,
}));
vi.mock('./config', () => ({ getFirebaseDb: mocks.getFirebaseDb }));

import { subscribeToUserNotifications } from './firestore';

describe('subscribeToUserNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the user filter, date conversion, and unsubscribe handle', () => {
    const stop = vi.fn();
    mocks.onSnapshot.mockReturnValue(stop);
    const success = vi.fn();
    expect(subscribeToUserNotifications('user-a', success, vi.fn())).toBe(stop);
    expect(mocks.where).toHaveBeenCalledWith('userId', '==', 'user-a');
    const createdAt = new Date('2026-09-12T00:00:00Z');
    mocks.onSnapshot.mock.calls[0][1]({ docs: [{ id: 'notice-a', data: () => ({ userId: 'user-a', createdAt: { toDate: () => createdAt } }) }] });
    expect(success).toHaveBeenCalledExactlyOnceWith([{ id: 'notice-a', userId: 'user-a', createdAt }]);
  });

  it('reports failure separately without emitting a successful empty list', () => {
    const success = vi.fn();
    const failure = vi.fn();
    const error = new Error('permission denied');
    subscribeToUserNotifications('user-a', success, failure);
    mocks.onSnapshot.mock.calls[0][2](error);
    expect(failure).toHaveBeenCalledExactlyOnceWith(error);
    expect(success).not.toHaveBeenCalled();
  });

  it('preserves the empty-list fallback for existing callers without an error handler', () => {
    const success = vi.fn();
    subscribeToUserNotifications('user-a', success);
    mocks.onSnapshot.mock.calls[0][2](new Error('permission denied'));
    expect(success).toHaveBeenCalledExactlyOnceWith([]);
  });
});
