import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_TASK_VIEW_KEY, taskViewScope, useProjectTaskViewStore as store } from './projectTaskViewStore';

beforeEach(() => { localStorage.clear(); store.setState({ byScope: {}, hydrated: false, persistenceFailed: false }); });
afterEach(() => vi.restoreAllMocks());
describe('project task view preferences (browser only)', () => {
  it('isolates users and projects, persists across hydration, and touches no other settings', () => {
    localStorage.setItem('unrelated', 'keep');
    store.getState().setDefault(taskViewScope('user-a', 'project-a'), 'outline');
    store.getState().setDefault(taskViewScope('user-a', 'project-b'), 'calendar');
    store.getState().setDefault(taskViewScope('user-b', 'project-a'), 'table');
    store.setState({ byScope: {}, hydrated: false });
    store.getState().hydrate();
    expect(store.getState().byScope).toEqual({ '["user-a","project-a"]': 'outline', '["user-a","project-b"]': 'calendar', '["user-b","project-a"]': 'table' });
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
  it('ignores malformed settings and unsupported views', () => {
    localStorage.setItem(PROJECT_TASK_VIEW_KEY, '{bad json');
    store.getState().hydrate();
    expect(store.getState().byScope).toEqual({});
    localStorage.setItem(PROJECT_TASK_VIEW_KEY, JSON.stringify({ bad: 'table', '["u","p"]': 'bad', '["u","valid"]': 'outline' }));
    store.getState().hydrate();
    expect(store.getState().byScope).toEqual({ '["u","valid"]': 'outline' });
    store.getState().setDefault(taskViewScope('', 'p'), 'table');
    expect(Object.keys(store.getState().byScope)).toHaveLength(1);
  });
  it('merges another tab\'s preferences when saving', () => {
    store.getState().hydrate();
    localStorage.setItem(PROJECT_TASK_VIEW_KEY, JSON.stringify({ '["other","p"]': 'outline' }));
    store.getState().setDefault(taskViewScope('me', 'p'), 'table');
    expect(store.getState().byScope).toEqual({ '["other","p"]': 'outline', '["me","p"]': 'table' });
  });
  it('keeps a usable session view and reports a storage failure', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    store.getState().setDefault(taskViewScope('u', 'p'), 'calendar');
    expect(store.getState().byScope[taskViewScope('u', 'p')]).toBe('calendar');
    expect(store.getState().persistenceFailed).toBe(true);
    expect(store.getState().hydrated).toBe(true);
  });
});
