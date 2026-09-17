import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskDetails } from './useTaskDetails';
import { subscribeToTaskComments } from '@/lib/firebase/firestore';
import type { ChecklistItem, Comment } from '@/types';

const mocks = vi.hoisted(() => ({ move:vi.fn(), mutate:vi.fn(), updateList:vi.fn(), getLists:vi.fn(), uid: null as string | null, commentSnapshot: vi.fn(), commentFailure: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: mocks.uid ? { id: mocks.uid } : null }) }));
vi.mock('@/lib/comments/taskPresence', () => ({ publishTaskCommentPresence: vi.fn(), publishTaskCommentSnapshot: mocks.commentSnapshot, failTaskCommentPresence: mocks.commentFailure }));
vi.mock('@/lib/firebase/checklist-order', () => ({ reorderChecklistItem:mocks.move }));
vi.mock('@/lib/firebase/checklist-item', () => ({ mutateChecklistItem:mocks.mutate }));
vi.mock('@/lib/firebase/firestore', () => ({
  getTask:vi.fn().mockResolvedValue(null), getTaskChecklists:mocks.getLists, updateChecklist:mocks.updateList,
  getTaskAttachments:vi.fn().mockResolvedValue([]),
  subscribeToTaskChecklists:vi.fn(() => vi.fn()),
  subscribeToTaskComments:vi.fn(() => vi.fn()), subscribeToTaskAttachments:vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/firebase/storage', () => ({}));
const items: ChecklistItem[] = [{id:'a',text:'シール',isChecked:false,order:0}, {id:'b',text:'箱',isChecked:true,order:1}];
const list = { id:'c',taskId:'task',title:'準備',order:0,createdAt:new Date(),items };

describe('useTaskDetails checklist order', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.uid = null; mocks.getLists.mockResolvedValue([structuredClone(list)]); });
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
  it('distinguishes a failed comment stream and ignores callbacks after switching tasks', async () => {
    const { result, rerender } = renderHook(({ task }) => useTaskDetails('project', task), { initialProps: { task: 'task' } });
    await waitFor(() => expect(vi.mocked(subscribeToTaskComments)).toHaveBeenCalled());
    const old = vi.mocked(subscribeToTaskComments).mock.calls.at(-1)!;
    expect(result.current.commentStatus).toBe('loading');
    act(() => old[3]?.(new Error('permission denied')));
    expect(result.current.commentStatus).toBe('error');
    rerender({ task: 'next' });
    const current = vi.mocked(subscribeToTaskComments).mock.calls.at(-1)!;
    act(() => { current[2]([]); old[3]?.(new Error('late error')); });
    expect(result.current.commentStatus).toBe('ready');
  });

});

it('reuses the existing comment stream for card presence and ignores old-account callbacks', async () => {
  vi.clearAllMocks(); mocks.getLists.mockResolvedValue([structuredClone(list)]);
  mocks.uid = 'alice';
  const { rerender } = renderHook(() => useTaskDetails('project', 'task'));
  await waitFor(() => expect(subscribeToTaskComments).toHaveBeenCalledTimes(1));
  const previous = vi.mocked(subscribeToTaskComments).mock.calls[0];
  act(() => previous[2]([{ id: 'comment' } as Comment], { fromCache: false }));
  expect(mocks.commentSnapshot).toHaveBeenCalledWith({ userId: 'alice', projectId: 'project', taskId: 'task' }, 1, false);
  act(() => previous[3]?.(new Error('permission')));
  expect(mocks.commentFailure).toHaveBeenCalledWith({ userId: 'alice', projectId: 'project', taskId: 'task' });
  mocks.uid = 'bob'; rerender();
  expect(subscribeToTaskComments).toHaveBeenCalledTimes(2);
  mocks.commentSnapshot.mockClear();
  act(() => previous[2]([], { fromCache: false }));
  expect(mocks.commentSnapshot).not.toHaveBeenCalled();
  const current = vi.mocked(subscribeToTaskComments).mock.calls[1];
  act(() => current[2]([], { fromCache: true }));
  expect(mocks.commentSnapshot).toHaveBeenCalledWith({ userId: 'bob', projectId: 'project', taskId: 'task' }, 0, true);
});

describe('useTaskDetails shared checklist item edits', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.uid='alice'; mocks.getLists.mockResolvedValue([structuredClone(list), {...list,id:'other'}]); });
  it('passes the edited text and its original value to the existing transaction', async () => {
    const latest = [{ ...items[0], text: '宛名シール', isChecked: true, dueDate: '2026-10-01' }, items[1]];
    mocks.mutate.mockResolvedValue(latest);
    const { result } = renderHook(() => useTaskDetails('project', 'task'));
    await waitFor(() => expect(result.current.checklists).toHaveLength(2));
    await act(async () => result.current.editChecklistItemText('c', 'a', '宛名シール', 'シール'));
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith('project', 'task', 'c', { kind: 'text', itemId: 'a', text: '宛名シール', expectedText: 'シール' });
    expect(result.current.checklists[0].items).toEqual(latest);
    expect(result.current.checklists[1].items).toEqual(items);
    expect(mocks.updateList).not.toHaveBeenCalled();
  });
  it('saves and clears one deadline with the latest persisted sibling state and no old-array write', async () => {
    const latest=[{...items[1],order:0,dueDate:'2026-09-30'}, {...items[0],text:'共有で更新したシール',order:1,dueDate:'2026-09-14'}];
    mocks.mutate.mockResolvedValueOnce(latest).mockResolvedValueOnce(latest.map(item=>item.id==='a'?{...item,dueDate:null}:item));
    const {result}=renderHook(()=>useTaskDetails('project','task'));
    await waitFor(()=>expect(result.current.checklists).toHaveLength(2));
    await act(async()=>result.current.setChecklistItemDueDate('c','a','2026-09-14'));
    expect(mocks.mutate).toHaveBeenLastCalledWith('project','task','c',{kind:'dueDate',itemId:'a',dueDate:'2026-09-14'});
    expect(result.current.checklists[0].items).toEqual(latest);expect(result.current.checklists[1].items).toEqual(items);
    await act(async()=>result.current.setChecklistItemDueDate('c','a',null));
    expect(result.current.checklists[0].items.find(item=>item.id==='a')?.dueDate).toBeNull();
    expect(mocks.getLists).toHaveBeenCalledTimes(1);
  });
  it('uses item mutations for add/check/delete instead of copying a stale checklist array', async () => {
    const preserved=[{...items[0],dueDate:'2026-10-01'}, {...items[1],dueDate:'2026-10-02'}];
    mocks.mutate.mockResolvedValue(preserved);
    const {result}=renderHook(()=>useTaskDetails('project','task'));
    await waitFor(()=>expect(result.current.checklists).toHaveLength(2));
    await act(async()=>result.current.addChecklistItem('c','新しい手順'));
    expect(mocks.mutate).toHaveBeenLastCalledWith('project','task','c',{kind:'add',item:{id:expect.any(String),text:'新しい手順'}});
    await act(async()=>result.current.toggleChecklistItem('c','a'));
    expect(mocks.mutate).toHaveBeenLastCalledWith('project','task','c',{kind:'toggle',itemId:'a',isChecked:true});
    await act(async()=>result.current.removeChecklistItem('c','b'));
    expect(mocks.mutate).toHaveBeenLastCalledWith('project','task','c',{kind:'remove',itemId:'b'});
    expect(result.current.checklists[0].items[0].dueDate).toBe('2026-10-01');
  });
  it('propagates deadline failures while retaining displayed items and rejects missing task scope', async () => {
    mocks.mutate.mockRejectedValue(new Error('permission-denied'));
    const {result,rerender}=renderHook(({task})=>useTaskDetails('project',task),{initialProps:{task:'task' as string|null}});
    await waitFor(()=>expect(result.current.checklists).toHaveLength(2));
    await act(async()=>{await expect(result.current.setChecklistItemDueDate('c','a','2026-09-14')).rejects.toThrow('permission-denied');});
    expect(result.current.checklists[0].items).toEqual(items);
    rerender({task:null});mocks.mutate.mockClear();
    await expect(result.current.setChecklistItemDueDate('c','a',null)).rejects.toThrow('開き直');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('keeps a late checklist rename refresh out of the next task', async () => {
    let finish!:()=>void;mocks.updateList.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({task})=>useTaskDetails('project',task),{initialProps:{task:'task'}});
    await waitFor(()=>expect(result.current.checklists).toHaveLength(2));
    let pending!:Promise<void>;act(()=>{pending=result.current.editChecklist('c',{title:'新しい名前'});});
    const next={...list,id:'next',title:'次の手順'};mocks.getLists.mockResolvedValue([next]);rerender({task:'next'});
    await waitFor(()=>expect(result.current.checklists[0].title).toBe('次の手順'));
    mocks.getLists.mockResolvedValue([{...list,title:'新しい名前'}]);
    await act(async()=>{finish();await pending;});
    expect(result.current.checklists).toEqual([next]);
  });
  it.each(['task','project','user'] as const)('ignores an old deadline response after %s changes', async change => {
    let resolve!: (items:ChecklistItem[])=>void;
    mocks.mutate.mockReturnValue(new Promise<ChecklistItem[]>(done=>{resolve=done;}));
    const {result,rerender}=renderHook(({project,task})=>useTaskDetails(project,task),{initialProps:{project:'project',task:'task'}});
    await waitFor(()=>expect(result.current.checklists).toHaveLength(2));
    let pending!:Promise<void>;act(()=>{pending=result.current.setChecklistItemDueDate('c','a','2026-09-14');});
    const current=[{...items[0],text:'切替先の手順'}];mocks.getLists.mockResolvedValue([{...list,items:current}]);
    if(change==='user')mocks.uid='bob';
    rerender({project:change==='project'?'next':'project',task:change==='task'?'next':'task'});
    await waitFor(()=>expect(result.current.checklists[0].items).toEqual(current));
    await act(async()=>{resolve([{...items[0],dueDate:'2026-09-14'}]);await pending;});
    expect(result.current.checklists[0].items).toEqual(current);
  });
});

it('takes live checklist updates over a late initial read and ignores the old task subscription',async()=>{
 const {subscribeToTaskChecklists}=await import('@/lib/firebase/firestore');
 vi.clearAllMocks();mocks.uid='alice';let finish!: (value:typeof list[])=>void;
 mocks.getLists.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue([]);
 const {result,rerender,unmount}=renderHook(({task})=>useTaskDetails('project',task),{initialProps:{task:'task'}});
 const old=vi.mocked(subscribeToTaskChecklists).mock.calls.at(-1)!;
 const fresh={...list,items:items.map(i=>({...i,isChecked:true}))};
 act(()=>old[2]([fresh]));await act(async()=>finish([list]));expect(result.current.checklists).toEqual([fresh]);
 act(()=>old[3]?.());expect(result.current.detailsError).toContain('最新情報');
 act(()=>old[2]([fresh]));expect(result.current.detailsError).toBeNull();
 rerender({task:'next'});await waitFor(()=>expect(result.current.checklists).toEqual([]));
 act(()=>old[2]([fresh]));expect(result.current.checklists).toEqual([]);unmount();
});
