import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INBOX_DISPLAY, INBOX_DISPLAY_STORAGE_KEY, useInboxDisplayStore } from './inboxDisplayStore';

describe('inboxDisplayStore', () => {
  beforeEach(() => {
    localStorage.removeItem(INBOX_DISPLAY_STORAGE_KEY);
    useInboxDisplayStore.setState({ settings: { ...DEFAULT_INBOX_DISPLAY } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to Gmail and comments, with unconnected Google Chat optional', () => {
    useInboxDisplayStore.getState().hydrate();
    expect(useInboxDisplayStore.getState().settings).toEqual({ gmail: true, comments: true, googleChat: false });
  });

  it('persists and restores channel selections including all channels off', () => {
    useInboxDisplayStore.getState().setOption('gmail', false);
    useInboxDisplayStore.getState().setOption('comments', false);
    useInboxDisplayStore.getState().setOption('googleChat', true);
    useInboxDisplayStore.setState({ settings: { ...DEFAULT_INBOX_DISPLAY } });
    useInboxDisplayStore.getState().hydrate();
    expect(useInboxDisplayStore.getState().settings).toEqual({ gmail: false, comments: false, googleChat: true });
    useInboxDisplayStore.getState().setOption('googleChat', false);
    useInboxDisplayStore.getState().hydrate();
    expect(Object.values(useInboxDisplayStore.getState().settings)).toEqual([false, false, false]);
  });

  it.each(['invalid', 'null', '[]', '{"gmail":"false","comments":null}'])('ignores malformed preferences: %s', (saved) => {
    localStorage.setItem(INBOX_DISPLAY_STORAGE_KEY, saved);
    useInboxDisplayStore.getState().hydrate();
    expect(useInboxDisplayStore.getState().settings).toEqual(DEFAULT_INBOX_DISPLAY);
  });

  it('uses valid partial preferences without unknown keys', () => {
    localStorage.setItem(INBOX_DISPLAY_STORAGE_KEY, '{"googleChat":true,"extra":true}');
    useInboxDisplayStore.getState().hydrate();
    expect(useInboxDisplayStore.getState().settings).toEqual({ ...DEFAULT_INBOX_DISPLAY, googleChat: true });
  });

  it('remains usable if browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => useInboxDisplayStore.getState().hydrate()).not.toThrow();
    expect(() => useInboxDisplayStore.getState().setOption('gmail', false)).not.toThrow();
    expect(useInboxDisplayStore.getState().settings.gmail).toBe(false);
  });

  it('resets and persists only display preferences', () => {
    useInboxDisplayStore.getState().setOption('gmail', false);
    useInboxDisplayStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(INBOX_DISPLAY_STORAGE_KEY)!)).toEqual(DEFAULT_INBOX_DISPLAY);
  });
});
