import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { SecretaryError } from '@/lib/secretary/engine';
const fake = vi.hoisted(() => ({ update: vi.fn(), operation: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/auth/authenticateRequest', () => ({ authenticateRequest: async () => ({ userId: 'u', permissions: ['tasks:write'], projectIds: ['p'] }) }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('@/lib/firebase/admin-projects', () => ({ updateProjectTask: fake.update, archiveProjectTask: vi.fn() }));
vi.mock('@/lib/ai/descriptionOperations', () => ({ actOnDescription: fake.operation }));
const patch = (body: unknown) => PATCH(new NextRequest('http://localhost/api/projects/p/tasks/t', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ projectId: 'p', taskId: 't' }) });
beforeEach(() => { vi.clearAllMocks(); fake.operation.mockResolvedValue({ id: 'op', state: 'applied' }); fake.update.mockResolvedValue({ ok: true }); });
describe('description-only PATCH route', () => {
  it('routes the receipt operation to the server and retains existing updates', async () => {
    expect((await patch({ aiDescriptionOperation: { operationId: 'op', action: 'confirm' } })).status).toBe(200);
    expect(fake.operation).toHaveBeenCalledWith('u', 'p', 't', 'op', 'confirm'); expect(fake.update).not.toHaveBeenCalled();
    expect((await patch({ description: '手入力' })).status).toBe(200);
    expect(fake.update).toHaveBeenCalledWith('p', 't', { description: '手入力' });
  });
  it.each([{ aiDescriptionOperation: { operationId: 'op', action: 'confirm' }, isCompleted: true }, { aiDescriptionOperation: [{ operationId: 'op', action: 'confirm' }] }, { aiDescriptionOperation: { operationId: 'op', action: 'confirm', taskId: 'other' } }])('rejects mixed or multiple writes without falling back', async body => {
    expect((await patch(body)).status).toBe(422); expect(fake.operation).not.toHaveBeenCalled(); expect(fake.update).not.toHaveBeenCalled();
  });
  it('does not fall back after permission or version rejection', async () => {
    fake.operation.mockRejectedValueOnce(new SecretaryError('FORBIDDEN', '権限がありません'));
    expect((await patch({ aiDescriptionOperation: { operationId: 'op', action: 'confirm' } })).status).toBe(403);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

it('returns a date validation error as a correctable input error', async () => {
  const {TaskDateValidationError} = await import('@/lib/task/dateValidation');
  fake.update.mockRejectedValueOnce(new TaskDateValidationError('開始日は期限以前の日付にしてください。'));
  const response=await patch({startDate:'2026-09-20'});
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({error:'開始日は期限以前の日付にしてください。'});
});
