// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthenticatedRequest } from '@/lib/auth/authenticateRequest';
import { GET } from './route';
import { listProjectTaskChanges } from '@/lib/task/changeRepository';
const state = vi.hoisted(() => ({ member: true, project: true, role: 'viewer', auth: null as AuthenticatedRequest | null }));
vi.mock('@/lib/auth/authenticateRequest', () => ({ authenticateRequest: async () => state.auth }));
vi.mock('@/lib/task/changeRepository', () => ({ listProjectTaskChanges: vi.fn() }));
// Real getProjectAccess implementation; only database reads are replaced.
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: (name: string) => {
  expect(name).toBe('projects');
  return { doc: (id: string) => {
    expect(id).toBe('p');
    const members = { where: () => members, limit: () => members, get: async () => ({ empty: !state.member, docs: state.member ? [{ data: () => ({ role: state.role }) }] : [] }) };
    return { get: async () => ({ exists: state.project, data: () => ({ memberIds: state.member ? ['u'] : [] }) }), collection: () => members };
  } };
} }) }));
const run = () => GET(new NextRequest('http://localhost/api/projects/p/tasks/changes?cursor=position'), { params: Promise.resolve({ projectId: 'p' }) });
beforeEach(() => {
  vi.clearAllMocks(); state.member = true; state.project = true; state.role = 'viewer';
  state.auth = { userId: 'u', authType: 'api-token', permissions: ['tasks:read'], projectIds: ['p'], tokenId: 'test', tokenName: 'test', actorDisplayName: null, actorIcon: null };
  vi.mocked(listProjectTaskChanges).mockResolvedValue({ tasks: [], nextCursor: null, checkpoint: 'checkpoint', snapshotAt: 'time' });
});
describe('task delta uses actual project authorization', () => {
  it('permits scoped viewer read access', async () => { expect((await run()).status).toBe(200); expect(listProjectTaskChanges).toHaveBeenCalledOnce(); });
  it('does not treat tasks:write as tasks:read', async () => { state.auth!.permissions = ['tasks:write']; expect((await run()).status).toBe(403); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
  it('rejects a token scoped to another project before task retrieval', async () => { state.auth!.projectIds = ['q']; expect((await run()).status).toBe(403); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
  it('rechecks membership on a continued round', async () => { expect((await run()).status).toBe(200); vi.mocked(listProjectTaskChanges).mockClear(); state.member = false; expect((await run()).status).toBe(403); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
  it('rejects an invalid membership role', async () => { state.role = 'removed'; expect((await run()).status).toBe(403); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
  it('returns missing project without querying task state', async () => { state.project = false; expect((await run()).status).toBe(404); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
  it('keeps Firebase-session membership checks', async () => { state.auth!.authType = 'firebase'; state.auth!.permissions = null; state.auth!.projectIds = null; state.member = false; expect((await run()).status).toBe(403); expect(listProjectTaskChanges).not.toHaveBeenCalled(); });
});
