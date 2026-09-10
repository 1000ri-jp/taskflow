import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKLIST_ASSIGNEE_STORAGE_KEY as KEY, checklistAssigneeKey, useChecklistAssigneeStore as store, type ChecklistAssigneeScope } from './checklistAssigneeStore';
const scope: ChecklistAssigneeScope = ['viewer','project','task','checklist','item'];
describe('local checklist assignees', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.removeItem(KEY); store.setState({byItem:{},hydrated:false,persistenceFailed:false}); });
  it('stores only IDs in a viewer/project/task/checklist/item scope and restores them', () => {
    const write = vi.spyOn(Storage.prototype,'setItem');
    store.getState().setAssignees(scope,['a','b','a']);
    store.getState().setAssignees(['other',...scope.slice(1)] as ChecklistAssigneeScope,['c']);
    store.setState({byItem:{}});
    store.getState().hydrate();
    expect(store.getState().byItem[checklistAssigneeKey(scope)]).toEqual(['a','b']);
    expect(Object.keys(store.getState().byItem)).toHaveLength(2);
    expect(write.mock.calls.every(([key]) => key === KEY)).toBe(true);
    store.getState().setAssignees(scope,[]);
    expect(Object.keys(store.getState().byItem)).toHaveLength(1);
  });
  it('rejects malformed scopes and IDs', () => {
    localStorage.setItem(KEY,JSON.stringify({[JSON.stringify(['p','t'])]:['x'], [checklistAssigneeKey(scope)]:[123]}));
    store.getState().hydrate();
    expect(store.getState().byItem).toEqual({});
    store.getState().setAssignees(['','p','t','c','i'],['a']);
    store.getState().setAssignees(scope,['bad/id']);
    expect(store.getState().byItem).toEqual({});
  });
  it('preserves session choices and surfaces storage failure', () => {
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('quota');});
    store.getState().setAssignees(scope,['a']);
    expect(store.getState().persistenceFailed).toBe(true);
    expect(store.getState().byItem[checklistAssigneeKey(scope)]).toEqual(['a']);
  });
});
