import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archivePreviewScope as scope, AUTO_ARCHIVE_PREVIEW_KEY as KEY, useAutoArchivePreviewStore as store } from './autoArchivePreviewStore';

describe('local auto-archive preview preferences', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.removeItem(KEY); store.setState({ byScope: {}, hydrated: false, persistenceFailed: false }); });
  it('keeps unconfigured scopes separate from explicit OFF and persists per user/project', () => {
    store.getState().hydrate();
    expect(store.getState().byScope).toEqual({});
    const write = vi.spyOn(Storage.prototype, 'setItem');
    store.getState().save(scope('u', 'p'), 7);
    store.getState().save(scope('u', 'q'), 30);
    store.getState().save(scope('v', 'p'), 90);
    store.setState({ byScope: {} }); store.getState().hydrate();
    expect(store.getState().byScope).toEqual({ [scope('u', 'p')]: 7, [scope('u', 'q')]: 30, [scope('v', 'p')]: 90 });
    store.getState().save(scope('u', 'p'), null);
    store.setState({ byScope: {} }); store.getState().hydrate();
    expect(store.getState().byScope[scope('u', 'p')]).toBeNull();
    expect(store.getState().byScope[scope('u', 'q')]).toBe(30);
    expect(write.mock.calls.every(([key]) => key === KEY)).toBe(true);
  });
  it('validates input and can recover corrupt local preferences', () => {
    localStorage.setItem(KEY, '{broken'); store.getState().hydrate();
    store.getState().save(scope('u', 'p'), 14);
    store.getState().save(scope('u', 'p'), 0);
    store.getState().save('invalid scope', 7);
    store.getState().save(scope('', 'p'), 7);
    expect(store.getState().byScope).toEqual({ [scope('u', 'p')]: 14 });
    expect(store.getState().persistenceFailed).toBe(false);
  });
  it('merges other tab preferences and keeps session state when persistence fails', () => {
    localStorage.setItem(KEY, JSON.stringify({ [scope('u', 'q')]: 30 }));
    store.getState().save(scope('u', 'p'), 7);
    expect(store.getState().byScope[scope('u', 'q')]).toBe(30);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    store.getState().save(scope('u', 'p'), 14);
    expect(store.getState().byScope[scope('u', 'p')]).toBe(14);
    expect(store.getState().persistenceFailed).toBe(true);
  });
});
