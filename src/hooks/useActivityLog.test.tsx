import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useActivityLog } from './useActivityLog';
const fake = vi.hoisted(()=>({subscribe:vi.fn(),stop:vi.fn()}));
vi.mock('@/stores/authStore',()=>({useAuthStore:()=>({firebaseUser:null,user:null})}));
vi.mock('@/lib/firebase/firestore',()=>({createActivityLog:vi.fn(),subscribeToActivityLogs:fake.subscribe}));
it('distinguishes retrieval failure from no history, retries, and ignores an old subscription',async()=>{
  fake.subscribe.mockReturnValue(fake.stop);
  const view=renderHook(()=>useActivityLog('p'));
  await waitFor(()=>expect(fake.subscribe).toHaveBeenCalledTimes(1));
  act(()=>fake.subscribe.mock.calls[0][3](new Error('offline')));
  expect(view.result.current.error?.message).toBe('offline');expect(view.result.current.isLoading).toBe(false);
  act(()=>view.result.current.retry());
  await waitFor(()=>expect(fake.subscribe).toHaveBeenCalledTimes(2));
  act(()=>fake.subscribe.mock.calls[1][1]([]));
  expect(view.result.current.error).toBeNull();expect(view.result.current.logs).toEqual([]);
  act(()=>fake.subscribe.mock.calls[0][3](new Error('old')));
  expect(view.result.current.error).toBeNull();expect(fake.stop).toHaveBeenCalled();
});
