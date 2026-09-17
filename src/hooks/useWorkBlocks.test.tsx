import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkBlocks } from './useWorkBlocks';
import { workBlockKey, type WorkBlock } from '@/lib/dashboard/work-blocks';

const block: WorkBlock = { id: 'a', projectId: 'p', taskId: 't', start: '2026-09-15T01:00:00Z', end: '2026-09-15T02:00:00Z' };
beforeEach(() => localStorage.clear());
describe('personal work time storage', () => {
  it('persists, shares updates between consumers, isolates accounts, and removes only the chosen reservation', () => {
    const a = renderHook(({ userId }) => useWorkBlocks(userId), { initialProps: { userId: 'me' } });
    const b = renderHook(() => useWorkBlocks('me'));
    act(() => a.result.current.save(block));
    expect(b.result.current.blocks).toEqual([block]);
    a.rerender({ userId: 'other' });
    expect(a.result.current.blocks).toEqual([]);
    act(() => a.result.current.save({ ...block, id: 'other' }));
    expect(b.result.current.blocks).toEqual([block]);
    b.unmount();
    const resumed = renderHook(() => useWorkBlocks('me'));
    expect(resumed.result.current.blocks).toEqual([block]);
    act(() => resumed.result.current.save({ ...block, id: 'second' }));
    act(() => resumed.result.current.remove('a'));
    expect(resumed.result.current.blocks.map(item => item.id)).toEqual(['second']);
    expect(a.result.current.blocks.map(item => item.id)).toEqual(['other']);
  });
  it('rejects reversed times and never overwrites unreadable stored data or reports a failed save as success', () => {
    const hook = renderHook(() => useWorkBlocks('me'));
    expect(() => hook.result.current.save({ ...block, end: block.start })).toThrow('終了は開始より後');
    localStorage.setItem(workBlockKey('me'), 'broken');
    expect(() => hook.result.current.save(block)).toThrow('変更していません');
    expect(localStorage.getItem(workBlockKey('me'))).toBe('broken');
    localStorage.removeItem(workBlockKey('me'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    expect(() => hook.result.current.save(block)).toThrow('保存できませんでした');
    expect(hook.result.current.blocks).toEqual([]);
  });
  it('reads the latest stored blocks before saving from another consumer', () => {
    const hook = renderHook(() => useWorkBlocks('me'));
    localStorage.setItem(workBlockKey('me'), JSON.stringify([block]));
    act(() => hook.result.current.save({ ...block, id: 'new' }));
    expect(hook.result.current.blocks.map(item => item.id)).toEqual(['a', 'new']);
  });
});
