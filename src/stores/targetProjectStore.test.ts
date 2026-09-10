import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TARGET_PROJECT_STORAGE_KEY, useTargetProjectStore } from './targetProjectStore';

describe('targetProjectStore', () => {
  beforeEach(() => {
    localStorage.removeItem(TARGET_PROJECT_STORAGE_KEY);
    useTargetProjectStore.setState({ selectedProjectIds: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('distinguishes the initial sample preview from explicitly selecting nothing', () => {
    useTargetProjectStore.getState().hydrate();
    expect(useTargetProjectStore.getState().selectedProjectIds).toBeNull();
    useTargetProjectStore.getState().select([]);
    useTargetProjectStore.getState().hydrate();
    expect(useTargetProjectStore.getState().selectedProjectIds).toEqual([]);
  });
  it('stores selection by project ID and restores it without duplicates', () => {
    useTargetProjectStore.getState().toggle('project-1', true);
    useTargetProjectStore.getState().toggle('project-1', true);
    useTargetProjectStore.getState().toggle('project-2', true);
    useTargetProjectStore.setState({ selectedProjectIds: null });
    useTargetProjectStore.getState().hydrate();
    expect(useTargetProjectStore.getState().selectedProjectIds).toEqual(['project-1', 'project-2']);
    useTargetProjectStore.getState().toggle('project-1', false);
    expect(JSON.parse(localStorage.getItem(TARGET_PROJECT_STORAGE_KEY)!)).toEqual(['project-2']);
  });
  it.each(['invalid', '{}', 'false', '[1]', '[""]', '["project-1",null]'])('ignores invalid storage: %s', (value) => {
    localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, value);
    useTargetProjectStore.getState().hydrate();
    expect(useTargetProjectStore.getState().selectedProjectIds).toBeNull();
  });
  it('keeps selection usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => useTargetProjectStore.getState().hydrate()).not.toThrow();
    expect(() => useTargetProjectStore.getState().toggle('project-1', true)).not.toThrow();
    expect(useTargetProjectStore.getState().selectedProjectIds).toEqual(['project-1']);
  });
  it('allows returning to the sample preview', () => {
    useTargetProjectStore.getState().select(['project-1']);
    useTargetProjectStore.getState().select(null);
    useTargetProjectStore.getState().hydrate();
    expect(useTargetProjectStore.getState().selectedProjectIds).toBeNull();
  });
});
