import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationRequestError, requestOrganization } from './organizationClient';
const state=vi.hoisted(()=>({mock:false,run:vi.fn()}));
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>state.mock}));
vi.mock('@/lib/firebase/authToken',()=>({getAuthHeaders:async()=>({Authorization:'Bearer test'})}));
vi.mock('./organizationMock',()=>({requestOrganizationMock:state.run}));
beforeEach(()=>{state.mock=false;vi.clearAllMocks();});
afterEach(()=>vi.unstubAllGlobals());
describe('organization client error contract',()=>{
  it('keeps conflict status and input for a caller to reanalyze',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:'対象が変わりました'})});vi.stubGlobal('fetch',fetch);
    const body={action:'preview',projectId:'p',confirmed:true,basis:{schema:1}};
    await expect(requestOrganization(body)).rejects.toMatchObject({message:'対象が変わりました',status:409});
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it('normalizes isolated conflicts to the same UI error class',async()=>{
    state.mock=true;state.run.mockRejectedValue(Object.assign(new Error('確認し直してください'),{status:409}));
    await expect(requestOrganization({action:'apply'})).rejects.toBeInstanceOf(OrganizationRequestError);
  });
});


it('notifies the review inbox after successful saved-decision updates, but not failures or reads',async()=>{
 state.mock=true;state.run.mockResolvedValue({status:'held'});
 const listener=vi.fn();window.addEventListener('taskflow-organization-updated',listener);
 try {
  await requestOrganization({action:'list'});expect(listener).not.toHaveBeenCalled();
  await requestOrganization({action:'hold'});expect(listener).toHaveBeenCalledTimes(1);
  await requestOrganization({action:'reconsider'});expect(listener).toHaveBeenCalledTimes(2);
  state.run.mockRejectedValue(new Error('offline'));
  await expect(requestOrganization({action:'skip'})).rejects.toThrow();
  expect(listener).toHaveBeenCalledTimes(2);
 } finally {window.removeEventListener('taskflow-organization-updated',listener);}
});
