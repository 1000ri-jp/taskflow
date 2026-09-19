import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOrganizationRecords } from './useOrganizationRecords';
import { requestOrganization } from '@/lib/task/organizationClient';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';
vi.mock('@/lib/task/organizationClient',()=>({requestOrganization:vi.fn()}));
const row=(projectId:string,id=projectId)=>({id,projectId,status:'held'} as OrganizationPreview);
beforeEach(()=>vi.clearAllMocks());afterEach(cleanup);
it('isolates scopes across accounts and ignores a previous account response arriving late',async()=>{
 let resolve!:(items:OrganizationPreview[])=>void;
 vi.mocked(requestOrganization).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}) as never).mockResolvedValue([row('q')]);
 const {result,rerender}=renderHook(({userId,ids})=>useOrganizationRecords(userId,ids),{initialProps:{userId:'first',ids:['p']}});
 rerender({userId:'second',ids:['q']});expect(result.current.records).toEqual([]);
 await waitFor(()=>expect(result.current.records).toEqual([row('q')]));
 await act(async()=>resolve([row('p')]));expect(result.current.records).toEqual([row('q')]);
 rerender({userId:'second',ids:[]});expect(result.current.records).toEqual([]);
});
it('refreshes after work and decision updates, distinguishes partial failures and drops foreign-project rows',async()=>{
 vi.mocked(requestOrganization).mockImplementation(async body=>{if(body.projectId==='q')throw new Error('offline');return [row('p'),row('foreign')];});
 const {result}=renderHook(()=>useOrganizationRecords('u',['p','q']));
 await waitFor(()=>expect(result.current.failed).toBe(true));expect(result.current.records).toEqual([row('p')]);
 vi.mocked(requestOrganization).mockImplementation(async body=>[row(body.projectId as string,'fresh')]);
 act(()=>window.dispatchEvent(new Event('taskflow-organization-updated')));
 await waitFor(()=>expect(result.current.records.map(r=>r.id)).toEqual(['fresh','fresh']));expect(result.current.failed).toBe(false);
 const count=vi.mocked(requestOrganization).mock.calls.length;
 act(()=>window.dispatchEvent(new Event('taskflow-work-updated')));
 await waitFor(()=>expect(vi.mocked(requestOrganization).mock.calls.length).toBe(count+2));
});
