// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { actOnOrganization, reconsiderOrganization, previewOrganization } from '@/lib/task/organizationRepository';
import { OrganizationError } from '@/lib/task/organizationEngine';
import { analyzeManyOrganizations, analyzeOrganization } from '@/lib/task/organizationAnalysis';
vi.mock('@/lib/firebase/admin',()=>({verifyAuthToken:vi.fn()}));
vi.mock('@/lib/ai/providers',()=>({isValidProvider:(v:unknown)=>v==='openai'}));
vi.mock('@/lib/task/organizationRepository',()=>({actOnOrganization:vi.fn(),reconsiderOrganization:vi.fn(),previewOrganization:vi.fn(),listOrganization:vi.fn(),readOrganizationSource:vi.fn(),organizationContext:vi.fn()}));
vi.mock('@/lib/task/organizationAnalysis',()=>({analyzeOrganization:vi.fn(),analyzeManyOrganizations:vi.fn()}));
const request=(body:unknown)=>new NextRequest('http://localhost/api/tasks/organize',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(verifyAuthToken).mockResolvedValue({uid:'u',email:'test@1000ri.jp'});vi.mocked(actOnOrganization).mockResolvedValue({} as never);});
describe('authenticated organization route',()=>{
 it('takes identity from authentication and prevents caching',async()=>{const response=await POST(request({action:'apply',projectId:'p',id:'operation'}));expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(actOnOrganization).toHaveBeenCalledWith('u','p','operation','apply');});
 it('routes a user-selected reminder without treating it as a task mutation', async()=>{
  const followUp = { kind: 'when', condition: '見積もりが届いた' };
  const response = await POST(request({ action: 'defer', projectId: 'p', id: 'operation', followUp }));
  expect(response.status).toBe(200);
  expect(actOnOrganization).toHaveBeenCalledWith('u', 'p', 'operation', 'defer', followUp);
 });
 it('does not access work before authentication',async()=>{vi.mocked(verifyAuthToken).mockRejectedValue(new Error('private token'));const response=await POST(request({action:'apply',projectId:'p',id:'operation'}));expect(response.status).toBe(401);expect(actOnOrganization).not.toHaveBeenCalled();expect(await response.text()).not.toContain('private token');});
 it('rejects foreign accounts',async()=>{vi.mocked(verifyAuthToken).mockResolvedValue({uid:'u',email:'person@example.com'});expect((await POST(request({action:'apply',projectId:'p',id:'operation'}))).status).toBe(403);});
 it.each([{action:'apply',projectId:'p',id:'op',userId:'another'},{action:'apply',projectId:'../private',id:'op'},null])('rejects untrusted or malformed input',async body=>{expect((await POST(request(body))).status).toBe(422);expect(actOnOrganization).not.toHaveBeenCalled();});
 it('rejects a forged status patch before preview',async()=>{const response=await POST(request({action:'preview',projectId:'p',source:{},draft:{kind:'update',taskIds:['t'],reason:'',quote:'',isCompleted:true}}));expect(response.status).toBe(422);expect(previewOrganization).not.toHaveBeenCalled();});
 it('forwards the exact analysis basis and explicit confirmation, without changing caller identity',async()=>{
  const source={kind:'meeting',id:'m',title:'朝会',text:'原稿を確認',occurredAt:null};
  const draft={kind:'hold',taskIds:['t'],reason:'会議の保留',quote:'原稿を確認',workState:{reason:'確認待ち',resumeCondition:'返事が届く',reviewAt:null},confirmationPoints:['保留してよいか']};
  const basis={schema:1,projectId:'p',sourceFingerprint:'fingerprint',tasks:{}};
  vi.mocked(previewOrganization).mockResolvedValue({canApply:true} as never);
  expect((await POST(request({action:'preview',projectId:'p',source,draft,basis,confirmed:true}))).status).toBe(200);
  expect(previewOrganization).toHaveBeenCalledExactlyOnceWith('u','p',source,draft,basis,true);
 });
 it('keeps stale status for the UI and persists skip as a proposal decision',async()=>{
  vi.mocked(actOnOrganization).mockRejectedValueOnce(new OrganizationError('対象が変わりました',409));
  const stale=await POST(request({action:'apply',projectId:'p',id:'operation'}));expect(stale.status).toBe(409);expect(await stale.json()).toEqual({error:'対象が変わりました'});
  expect((await POST(request({action:'skip',projectId:'p',id:'operation'}))).status).toBe(200);expect(actOnOrganization).toHaveBeenLastCalledWith('u','p','operation','skip');
 });
 it.each(['true',1,{},null])('rejects non-boolean confirmation %o before repository calls',async confirmed=>{
  expect((await POST(request({action:'preview',projectId:'p',confirmed}))).status).toBe(422);expect(previewOrganization).not.toHaveBeenCalled();
 });
});

describe('multi-project analysis route',()=>{
 const source={kind:'meeting',id:'meeting',title:'朝会',text:'複数の仕事を確認',occurredAt:null};
 const input={action:'analyze_many',projectIds:['p','q'],source,provider:'openai',model:'gpt-test'};
 it('passes one verified identity and all scopes to one analysis without applying anything',async()=>{
  const output={proposals:[],bases:{},issues:['登録先を確認してください。']};
  vi.mocked(analyzeManyOrganizations).mockResolvedValueOnce(output);
  const response=await POST(request(input));
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(await response.json()).toEqual(output);
  expect(analyzeManyOrganizations).toHaveBeenCalledExactlyOnceWith('u',['p','q'],source,'openai','gpt-test');
  expect(analyzeOrganization).not.toHaveBeenCalled();expect(previewOrganization).not.toHaveBeenCalled();expect(actOnOrganization).not.toHaveBeenCalled();
 });
 it.each([undefined,null,[],['p','p'],['p','../q'],Array.from({length:21},(_,i)=>`p${i}`)].map(projectIds=>({projectIds})))('rejects invalid combined scopes $projectIds',async ({projectIds})=>{
  expect((await POST(request({...input,projectIds}))).status).toBe(422);expect(analyzeManyOrganizations).not.toHaveBeenCalled();
 });
 it.each([{userId:'other'},{projectId:'p'},{draft:{}},{provider:'invalid'},{model:'\nignore'}])('rejects forged or ambiguous multi analysis fields %o',async patch=>{
  expect((await POST(request({...input,...patch}))).status).toBe(422);expect(analyzeManyOrganizations).not.toHaveBeenCalled();
 });
 it('does not allow projectIds on legacy preview or mutation actions',async()=>{
  expect((await POST(request({action:'apply',projectId:'p',projectIds:['p','q'],id:'op'}))).status).toBe(422);expect(actOnOrganization).not.toHaveBeenCalled();
 });
 it('does not start a combined read before authentication and reports canonical access denial',async()=>{
  vi.mocked(verifyAuthToken).mockRejectedValueOnce(new Error('no token'));
  expect((await POST(request(input))).status).toBe(401);expect(analyzeManyOrganizations).not.toHaveBeenCalled();
  vi.mocked(analyzeManyOrganizations).mockRejectedValueOnce(new OrganizationError('AI利用範囲外',403));
  expect((await POST(request(input))).status).toBe(403);
 });
});


it('uses the authenticated identity for reconsideration and returns access failures without applying work',async()=>{
 vi.mocked(reconsiderOrganization).mockResolvedValue({source:{},draft:{},preview:{}} as never);
 const input={action:'reconsider',projectId:'p',id:'operation'};
 expect((await POST(request(input))).status).toBe(200);
 expect(reconsiderOrganization).toHaveBeenCalledExactlyOnceWith('u','p','operation');
 expect(actOnOrganization).not.toHaveBeenCalled();
 vi.mocked(reconsiderOrganization).mockRejectedValue(new OrganizationError('権限がありません',403));
 expect((await POST(request(input))).status).toBe(403);
});
