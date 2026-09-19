import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeetingMembers } from './useMeetingMembers';
const getUsers = vi.hoisted(()=>vi.fn());
const mode = vi.hoisted(()=>({mock:false}));
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>mode.mock}));
vi.mock('@/lib/firebase/firestore',()=>({getUsersByIds:getUsers}));
describe('read-only meeting member lookup',()=>{
  beforeEach(()=>{getUsers.mockReset();mode.mock=false;});
  afterEach(cleanup);
  it('reads only fixture names in the isolated workbench and never contacts Firebase',async()=>{
    mode.mock=true;
    const {result}=renderHook(()=>useMeetingMembers([{memberIds:['e2e-mock-user','demo-colleague']}],true));
    await waitFor(()=>expect(result.current.isLoading).toBe(false),{timeout:5000});
    expect(result.current.users).toEqual([{id:'demo-colleague',displayName:'同僚'},{id:'e2e-mock-user',displayName:'本人'}]);
    expect(getUsers).not.toHaveBeenCalled();
  });
  it('requests unique active member IDs and discards unrelated returned users',async()=>{
    getUsers.mockResolvedValue([{id:'a',displayName:'Kozue'},{id:'foreign',displayName:'Other'}]);
    const {result}=renderHook(()=>useMeetingMembers([{memberIds:['a','a']},{isArchived:true,memberIds:['b']}],true));
    expect(result.current.isLoading).toBe(true);
    await waitFor(()=>expect(result.current.isLoading).toBe(false),{timeout:5000});
    expect(getUsers).toHaveBeenCalledWith(['a']);
    expect(result.current.users).toEqual([{id:'a',displayName:'Kozue'}]);
  });
  it('does not query before project data is ready',async()=>{
    const {result}=renderHook(()=>useMeetingMembers([{memberIds:['a']}],false));
    await act(async()=>{});
    expect(getUsers).not.toHaveBeenCalled();
    expect(result.current.users).toEqual([]);
  });
  it('reports an error and retries without mutating data',async()=>{
    getUsers.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{id:'a',displayName:'Kozue'}]);
    const {result}=renderHook(()=>useMeetingMembers([{memberIds:['a']}],true));
    await waitFor(()=>expect(result.current.hasError).toBe(true));
    act(()=>result.current.refresh());
    await waitFor(()=>expect(result.current.users).toHaveLength(1));
    expect(result.current.hasError).toBe(false);
  });
  it('ignores a stale response after membership changes',async()=>{
    let finishOld!: (users:unknown[])=>void;
    getUsers.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce([{id:'b',displayName:'New'}]);
    const {result,rerender}=renderHook(({id})=>useMeetingMembers([{memberIds:[id]}],true),{initialProps:{id:'a'}});
    await waitFor(()=>expect(getUsers).toHaveBeenCalledTimes(1));
    rerender({id:'b'});
    await waitFor(()=>expect(result.current.users[0]?.id).toBe('b'));
    await act(async()=>finishOld([{id:'a',displayName:'Old'}]));
    expect(result.current.users[0]?.id).toBe('b');
  });
});
