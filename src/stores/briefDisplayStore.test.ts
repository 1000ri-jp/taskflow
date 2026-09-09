import { beforeEach, describe, expect, it } from 'vitest';
import { BRIEF_DISPLAY_STORAGE_KEY, useBriefDisplayStore } from './briefDisplayStore';

describe('briefDisplayStore', () => {
  beforeEach(() => {
    localStorage.removeItem(BRIEF_DISPLAY_STORAGE_KEY);
    useBriefDisplayStore.setState({ taskScope: 'mine' });
  });

  it('defaults to mine and restores the saved scope', () => {
    expect(useBriefDisplayStore.getState().taskScope).toBe('mine');
    localStorage.setItem(BRIEF_DISPLAY_STORAGE_KEY, JSON.stringify('all'));
    useBriefDisplayStore.getState().hydrate();
    expect(useBriefDisplayStore.getState().taskScope).toBe('all');
  });

  it('persists scope changes locally', () => {
    useBriefDisplayStore.getState().setTaskScope('all');
    expect(JSON.parse(localStorage.getItem(BRIEF_DISPLAY_STORAGE_KEY)!)).toBe('all');
  });
});
