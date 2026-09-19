// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { applyWorkflow } from '@/lib/task/workflowRepository';
import { OrganizationError } from '@/lib/task/organizationEngine';
vi.mock('@/lib/firebase/admin',()=>({verifyAuthToken:vi.fn()}));
vi.mock('@/lib/task/workflowRepository',()=>({applyWorkflow:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(verifyAuthToken).mockResolvedValue({uid:'u',email:'u@1000ri.jp'});vi.mocked(applyWorkflow).mockResolvedValue({alreadyApplied:false,receipt:null});});
const context={params:Promise.resolve({projectId:'p',taskId:'t'})};
const body={id:'event',action:'approve',expectedVersion:'2026-09-13T00:00:00.000Z'};
const call=(value:unknown=body)=>POST(new NextRequest('http://localhost/api/projects/p/tasks/t/workflow',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(value)}),context);
it('passes the verified identity and awaited path params, using no-store',async()=>{const response=await call();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(applyWorkflow).toHaveBeenCalledExactlyOnceWith('u','p','t',body);});
it('rejects unverified identity and unknown action payload fields before writing',async()=>{vi.mocked(verifyAuthToken).mockRejectedValueOnce(new Error('bad'));expect((await call()).status).toBe(401);expect((await call({...body,userId:'other'})).status).toBe(400);expect(applyWorkflow).not.toHaveBeenCalled();});
it('distinguishes a definitive rejection from an uncertain server failure for safe retry',async()=>{vi.mocked(applyWorkflow).mockRejectedValueOnce(new OrganizationError('最新の状態を確認',409));let response=await call();expect(response.status).toBe(409);expect(await response.json()).toMatchObject({rejected:true});vi.mocked(applyWorkflow).mockRejectedValueOnce(new Error('secret internal detail'));response=await call();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({rejected:false,error:expect.not.stringContaining('secret')});});

it('accepts resubmission attachments while retaining the actor and operation payload', async () => {
 const payload = { ...body, action: 'resubmit', note: '会場名を修正', attachments: [{ id: 'pdf', url: 'https://example.test/v2.pdf', name: 'v2.pdf', type: 'application/pdf', size: 2 }] };
 expect((await call(payload)).status).toBe(200);
 expect(applyWorkflow).toHaveBeenCalledWith('u', 'p', 't', payload);
});


it.each([
 { dueDate: '2026-09-17' },
 { dueDate: null },
 { title: '新しいサブタスク名' },
 { assigneeIds: ['u', 'colleague'] },
])('accepts inline subtask edits through the HTTP boundary: %j', async (subtaskPatch) => {
 const payload = { ...body, action: 'edit_subtask', subtaskPatch };
 const response = await call(payload);
 expect(response.status).toBe(200);
 expect(applyWorkflow).toHaveBeenCalledExactlyOnceWith('u', 'p', 't', payload);
});

it.each(['parent', null])('passes the requested parent to the existing hierarchy validation: %s', async (parentTaskId) => {
 const payload = { ...body, action: 'reparent', parentTaskId };
 expect((await call(payload)).status).toBe(200);
 expect(applyWorkflow).toHaveBeenCalledExactlyOnceWith('u', 'p', 't', payload);
});

it.each([
 JSON.stringify({ ...body, subtaskPatch: { dueDate: '2026-09-17' }, userId: 'other' }),
 JSON.stringify({ ...body, note: 'x'.repeat(12001) }),
 'not json',
 'null',
 '[]',
])('reports invalid input as definitively rejected before any write', async (text) => {
 const response = await POST(new NextRequest('http://localhost/api/projects/p/tasks/t/workflow', {
  method: 'POST', headers: { Authorization: 'Bearer test' }, body: text,
 }), context);
 expect(response.status).toBe(400);
 expect(await response.json()).toMatchObject({ rejected: true });
 expect(applyWorkflow).not.toHaveBeenCalled();
});
