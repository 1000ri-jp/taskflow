// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';
import { DEFAULT_AI_SUPPORT } from '@/lib/ai/support/profile';
const mock = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mock.auth }));
vi.mock('@/lib/ai/support/repository', () => ({ readAISupportProfile: mock.read, saveAISupportProfile: mock.save }));
const req = (profile?: unknown) => new NextRequest('http://localhost/api/ai/support?userId=other', { method: profile ? 'PUT' : 'GET', ...(profile ? { body: JSON.stringify(profile) } : {}) });
beforeEach(() => { vi.resetAllMocks(); mock.auth.mockResolvedValue({ uid: 'owner' }); mock.read.mockResolvedValue(DEFAULT_AI_SUPPORT); });
describe('support profile API', () => {
  it('uses the authenticated owner for reads and writes, regardless of the URL', async () => {
    expect((await GET(req())).headers.get('Cache-Control')).toBe('no-store');
    expect(mock.read).toHaveBeenCalledWith('owner');
    expect((await PUT(req({ ...DEFAULT_AI_SUPPORT, wishes: '端的に' }))).status).toBe(200);
    expect(mock.save).toHaveBeenCalledWith('owner', { ...DEFAULT_AI_SUPPORT, wishes: '端的に' });
  });
  it('rejects unauthenticated access and attempted owner overrides', async () => {
    expect((await PUT(req({ ...DEFAULT_AI_SUPPORT, userId: 'other' }))).status).toBe(400);
    expect(mock.save).not.toHaveBeenCalled();
    mock.auth.mockRejectedValue(new Error('missing'));
    expect((await GET(req())).status).toBe(401);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('reports a load failure rather than claiming that standard settings are applied', async () => {
    mock.read.mockRejectedValue(new Error('offline'));
    expect((await GET(req())).status).toBe(503);
  });
});

it('saves three typed reference results only for the authenticated owner', async () => {
 const profile = { ...DEFAULT_AI_SUPPORT, references: { natal: '太陽：牡羊座', mbti: 'INTJ', strengths: ['着想', '学習欲'] } };
 const response = await PUT(req(profile));
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual(profile);
 expect(mock.save).toHaveBeenCalledWith('owner', profile);
});
