// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
const fake = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), create: vi.fn(), lists: vi.fn(), project: { name: 'タスク管理ツール', isArchived: false } }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: fake.auth, getAdminDb: () => ({ doc: () => ({ get: async () => ({ data: () => fake.project }) }) }) }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('@/lib/firebase/admin-projects', () => ({ createProjectTask: fake.create, listProjectLists: fake.lists }));
const annotation = { id: '12345678-1234-1234-1234-123456789abc', pageUrl: 'https://taskflow.example/neo', pageTitle: '仕事', target: '通知', comment: '未読が分かりづらい', rect: { x: 0, y: 0, width: 50, height: 50 }, viewport: { width: 100, height: 100 }, capturedAt: '2026-09-13T10:00:00Z' };
const input = { projectId: 'p', requestId: '12345678-1234-1234-1234-123456789abc', title: '通知の未読を表示', description: '未読の件数を表示したい', turns: [{ role: 'user', content: '通知が分かりにくい' }], annotations: [annotation] };
const call = (body: unknown = input) => POST(new NextRequest('http://localhost/api/ai/feature-request/submit', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => { vi.resetAllMocks(); fake.project = { name: 'タスク管理ツール', isArchived: false }; fake.auth.mockResolvedValue({ uid: 'owner' }); fake.lists.mockResolvedValue([{ id: 'requests', name: '要望' }]); fake.create.mockResolvedValue({ task: { id: 'task' } }); });
it('uses existing creation in the request list, retains image references and scopes retry identity to the authenticated user', async () => {
  expect((await call()).status).toBe(201);
  expect(fake.create.mock.calls[0].slice(0, 3)).toEqual(['p', 'owner', { listId: 'requests', title: input.title, description: expect.stringContaining(annotation.pageUrl) }]);
  expect(fake.create.mock.calls[0][2].description).toContain(annotation.comment); expect(fake.create.mock.calls[0][2].description).toContain('画面注釈-'+annotation.id+'.png');
  const receipt = fake.create.mock.calls[0][3];
  await call(); expect(fake.create.mock.calls[1][3]).toEqual(receipt);
  fake.auth.mockResolvedValue({ uid: 'another' }); await call(); expect(fake.create.mock.calls[2][3].taskId).not.toBe(receipt.taskId);
});
it('rejects missing auth, forged destination fields and malformed images before a write', async () => {
  expect((await call({ ...input, uid: 'other' })).status).toBe(400);
  expect((await call({ ...input, annotations: [{ ...annotation, pageUrl: 'javascript:x' }] })).status).toBe(400);
  fake.auth.mockRejectedValue(new Error()); expect((await call()).status).toBe(401); expect(fake.create).not.toHaveBeenCalled();
});
it('fails closed for viewers, unrelated projects or ambiguous lists; reports changed-content retries', async () => {
  fake.access.mockRejectedValueOnce(new Error('FORBIDDEN')); expect((await call()).status).toBe(403);
  fake.project.name = '他のプロジェクト'; expect((await call()).status).toBe(403); fake.project.name = 'タスク管理ツール';
  fake.lists.mockResolvedValueOnce([{ id: 'a', name: '要望' }, { id: 'b', name: '要望' }]); expect((await call()).status).toBe(409); expect(fake.create).not.toHaveBeenCalled();
  fake.create.mockRejectedValue(new Error('REQUEST_CONFLICT')); expect((await call()).status).toBe(409);
});
