// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {POST} from './route';
import {verifyAuthToken} from '@/lib/firebase/admin';
import {prepareWorkSupport} from '@/lib/ai/support/work';
vi.mock('@/lib/firebase/admin',()=>({verifyAuthToken:vi.fn()}));
vi.mock('@/lib/ai/support/work',()=>({prepareWorkSupport:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(verifyAuthToken).mockResolvedValue({uid:'owner'});vi.mocked(prepareWorkSupport).mockResolvedValue({text:'確認点',role:'確認担当',intent:'確認',preparedAt:'2026-09-13'});});
const body={projectId:'p',taskId:'r',provider:'gemini',once:'短く'};
const call=(input:unknown=body)=>POST(new NextRequest('http://localhost/api/ai/support/work',{method:'POST',body:JSON.stringify(input)}));
it('takes identity only from auth and returns no-store preparation',async()=>{const response=await call();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(prepareWorkSupport).toHaveBeenCalledWith('owner','p','r','gemini',undefined,'短く');});
it('rejects identity overrides, excessive input and missing auth before preparing',async()=>{
 expect((await call({...body,userId:'other'})).status).toBe(400);expect((await call({...body,once:'x'.repeat(1001)})).status).toBe(400);
 vi.mocked(verifyAuthToken).mockRejectedValue(new Error('bad'));expect((await call()).status).toBe(401);expect(prepareWorkSupport).not.toHaveBeenCalled();
});
