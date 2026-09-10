import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskDetails } from './useTaskDetails';
import type { ChecklistItem } from '@/types';

const mocks = vi.hoisted(() => ({ move:vi.fn(), getLists:vi.fn() }));
vi.mock('@/lib/firebase/checklist-order', () => ({ reorderChecklistItem:mocks.move }));
vi.mock('@/lib/firebase/firestore', () => ({
  getTask:vi.fn().mockResolvedValue(null), getTaskChecklists:mocks.getLists,
  getTaskAttachments:vi.fn().mockResolvedValue([]),
  subscribeToTaskComments:vi.fn(() => vi.fn()), subscribeToTaskAttachments:vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/firebase/storage', () => ({}));
const items: ChecklistItem[] = [{id:'a',text:'シール',isChecked:false,order:0}, {id:'b',text:'箱',isChecked:true,order:1}];
const list = { id:'c',taskId:'task',title:'準備',order:0,createdAt:new Date(),items };

describe('useTaskDetails checklist order', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getLists.mockResolvedValue([structuredClone(list)]); });
  it('uses the persisted items in the right checklist without reloading or mutating others', async () => {
    mocks.getLists.mockResolvedValue([structuredClone(list), {...list,id:'other'}]);
    const reordered = [{...items[1],order:0}, {...items[0],order:1}];
    mocks.move.mockResolvedValue(reordered);
    const { result } = renderHook(() => useTaskDetails('project','task'));
    await waitFor(() => expect(result.current.checklists).toHaveLength(2));
    await act(async () => result.current.moveChecklistItem('c','b','a'));
    expect(mocks.move).toHaveBeenCalledExactlyOnceWith('project','task','c','b','a');
    expect(result.current.checklists[0].items).toEqual(reordered);
    expect(result.current.checklists[1].items).toEqual(items);
    expect(mocks.getLists).toHaveBeenCalledTimes(1);
  });
  it('retains the old display when persistence fails', async () => {
    mocks.move.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTaskDetails('project','task'));
    await waitFor(() => expect(result.current.checklists).toHaveLength(1));
    await act(async () => { await expect(result.current.moveChecklistItem('c','b','a')).rejects.toThrow('offline'); });
    expect(result.current.checklists[0].items).toEqual(items);
  });
  it('ignores a late save response after switching tasks', async () => {
    let resolveSave!: (value:ChecklistItem[]) => void;
    mocks.move.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    const { result, rerender } = renderHook(({task}) => useTaskDetails('project',task), {initialProps:{task:'task'}});
    await waitFor(() => expect(result.current.checklists).toHaveLength(1));
    let pending!: Promise<void>;
    act(() => { pending = result.current.moveChecklistItem('c','b','a'); });
    const nextItems = [{...items[0],text:'次のタスク'}];
    mocks.getLists.mockResolvedValue([{...list,taskId:'next',items:nextItems}]);
    rerender({task:'next'});
    await waitFor(() => expect(result.current.checklists[0].items).toEqual(nextItems));
    await act(async () => { resolveSave([...items].reverse()); await pending; });
    expect(result.current.checklists[0].items).toEqual(nextItems);
  });
  it('does not write without an active task', async () => {
    const { result } = renderHook(() => useTaskDetails(null,null));
    await expect(result.current.moveChecklistItem('c','b','a')).rejects.toThrow();
    expect(mocks.move).not.toHaveBeenCalled();
  });
});
