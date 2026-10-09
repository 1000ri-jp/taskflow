// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import handler from '@/pages/api/mcp-consent';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
const f = vi.hoisted(() => ({ production: false, taskAccess: false, details: vi.fn(), finish: vi.fn(), user: vi.fn(), access: vi.fn(), create: vi.fn(), save: vi.fn(), write: vi.fn(), projects: vi.fn(), oidcScope: vi.fn(), resourceScope: vi.fn() }));
vi.mock('@/lib/mcp/oidc', () => ({
  oidcConfig: () => ({ origin: 'https://slowth.example.test', clientId: 'fixture-client', redirectUri: 'https://chatgpt.com/fixture-callback', resource: 'https://slowth.example.test/api/mcp', productionEnabled: f.production, taskAccessEnabled: f.taskAccess }),
  oidcProvider: () => ({ interactionDetails: f.details, interactionResult: f.finish,
    Grant: class { addOIDCScope(scope) { f.oidcScope(scope); } addResourceScope(resource, scope) { f.resourceScope(resource, scope); } save() { return f.save(); } } }),
  firebaseConsentUser: f.user, assertProject: f.access, digest: value => value,
}));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: () => ({ doc: () => ({ create: f.create, set: f.write }) }) }) }));
vi.mock('@/lib/firebase/admin-projects', () => ({ listUserProjects: f.projects }));
function request(patch = {}) {
  return { method: 'POST', headers: { origin: 'https://slowth.example.test', 'content-type': 'application/json', authorization: 'Bearer fixture-only' },
    body: { interaction: 'fixture-interaction', approve: true, projectId: 'fixture-project' }, ...patch };
}
function response() {
  const r = { code: 200, body: null, headersSent: false, setHeader: vi.fn() };
  r.status = code => { r.code = code; return r; }; r.end = () => r; r.json = body => { r.body = body; return r; }; return r;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.production = false; f.taskAccess = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.details.mockResolvedValue({ uid: 'fixture-interaction', params: { client_id: 'fixture-client', redirect_uri: 'https://chatgpt.com/fixture-callback', resource: 'https://slowth.example.test/api/mcp', scope: 'events:test' } });
  f.user.mockResolvedValue({ uid: 'fixture-user', auth_time: 123 });
  f.access.mockResolvedValue(undefined); f.create.mockResolvedValue(undefined);
  f.save.mockResolvedValue('fixture-grant'); f.write.mockResolvedValue(undefined);
  f.finish.mockResolvedValue('https://slowth.example.test/api/oidc/auth/fixture');
  f.projects.mockResolvedValue([{ id: 'fixture-project', name: '架空プロジェクト', description: 'not returned' }]);
});

it('production selector only exposes the approved pilot with explicit lifetime', async () => {
  f.production = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, scope: 'events:read openid offline_access' } });
  f.projects.mockResolvedValue([{ id: PILOT_PROJECT, name: 'タスク管理ツール' }, { id: 'other-project', name: '対象外' }]);
  const r = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.body).toMatchObject({ projects: [{ id: PILOT_PROJECT, name: 'タスク管理ツール' }], mode: 'production', scope: 'events:read', maxDays: 30 });
});
it('production approval creates finite grant/producer binding and rejects another project', async () => {
  f.production = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, scope: 'events:read openid offline_access' } });
  const denied = response(); await handler(request(), denied); expect(denied.code).toBe(403); expect(f.save).not.toHaveBeenCalled();
  const r = response(); await handler(request({ body: { interaction: 'fixture-interaction', approve: true, projectId: PILOT_PROJECT } }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledTimes(2);
  expect(f.resourceScope).toHaveBeenCalledWith('https://slowth.example.test/api/mcp', 'events:read');
  expect(f.write.mock.calls[1][0]).toMatchObject({ mode: 'production', projectId: PILOT_PROJECT, bindingId: 'fixture-grant' });
  const remaining = f.write.mock.calls[1][0].expiresAt.getTime() - Date.now();
  expect(remaining).toBeGreaterThan(29 * 86400000); expect(remaining).toBeLessThanOrEqual(30 * 86400000);
});
afterEach(() => vi.restoreAllMocks());
it('requires exact Origin, verified login, interaction cookie and project membership', async () => {
  const r = response(); await handler(request({ headers: { origin: 'https://evil.example' } }), r);
  expect(r.code).toBe(403); expect(f.user).not.toHaveBeenCalled();
  f.details.mockRejectedValueOnce(new Error('missing signed cookie'));
  const missing = response(); await handler(request(), missing); expect(missing.code).toBe(403);
  f.access.mockRejectedValueOnce(new Error('Forbidden'));
  const forbidden = response(); await handler(request(), forbidden); expect(forbidden.code).toBe(403);
  expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it('writes only a scoped consent binding and returns library-generated resume URL', async () => {
  const r = response(); await handler(request(), r);
  expect(r.code).toBe(200); expect(r.body.redirect).toContain('/api/oidc/auth/');
  expect(f.write).toHaveBeenCalledWith(expect.objectContaining({ userId: 'fixture-user', projectId: 'fixture-project', clientId: 'fixture-client', resource: 'https://slowth.example.test/api/mcp' }));
  expect(f.finish).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ consent: { grantId: 'fixture-grant' } }), { mergeWithLastSubmission: false });
});
it('a duplicate consent cannot issue another grant', async () => {
  f.create.mockRejectedValueOnce(new Error('already exists'));
  const r = response(); await handler(request(), r); expect(r.code).toBe(403); expect(f.save).not.toHaveBeenCalled();
});
it.each(['events:test openid', 'openid events:test'])('accepts the advertised identity scope without expanding resource access: %s', async scope => {
  const details = await f.details();
  f.details.mockResolvedValue({ ...details, params: { ...details.params, scope } });
  const r = response(); await handler(request(), r);
  expect(r.code).toBe(200);
  expect(f.oidcScope).toHaveBeenCalledWith(scope);
  expect(f.resourceScope).toHaveBeenCalledWith('https://slowth.example.test/api/mcp', 'events:test');
});
it.each(['openid', 'events:test offline_access', 'events:test openid email', 'events:test events:test', 'events:test openid openid'])('rejects missing, extra or duplicate scopes before creating a grant: %s', async scope => {
  const details = await f.details();
  f.details.mockResolvedValue({ ...details, params: { ...details.params, scope } });
  const r = response(); await handler(request(), r);
  expect(r.code).toBe(403);
  expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it('denial does not create a grant', async () => {
  const r = response(); await handler(request({ body: { interaction: 'fixture-interaction', approve: false } }), r);
  expect(r.code).toBe(200); expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it('GET returns only authorized project selector data', async () => {
  const r = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.body.projects).toEqual([{ id: 'fixture-project', name: '架空プロジェクト' }]); expect(f.create).not.toHaveBeenCalled();
});
it.each(['firebase_authentication', 'interaction_cookie', 'project_selector'])('records only the failed %s stage without credentials', async stage => {
  const failing = stage === 'firebase_authentication' ? f.user : stage === 'interaction_cookie' ? f.details : f.projects;
  failing.mockRejectedValueOnce(new Error('fixture token and cookie must never be logged'));
  const r = response();
  await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.code).toBe(403);
  expect(console.warn.mock.calls).toEqual([['Slowth MCP consent rejected', { stage }]]);
  expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});

it('records exact expanded consent and checks write membership before issuing any grant', async () => {
  f.production = true; f.taskAccess = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, scope: 'events:read tasks:read tasks:write openid offline_access' } });
  const r = response(); await handler(request({ body: { interaction: 'fixture-interaction', approve: true, projectId: PILOT_PROJECT } }), r);
  expect(r.code).toBe(200);
  expect(f.access).toHaveBeenCalledWith('fixture-user', PILOT_PROJECT, true);
  expect(f.resourceScope).toHaveBeenCalledWith('https://slowth.example.test/api/mcp', 'events:read tasks:read tasks:write');
  expect(f.write.mock.calls[0][0]).toMatchObject({ taskScopes: ['tasks:read', 'tasks:write'] });
  f.access.mockRejectedValueOnce(new Error('viewer')); f.create.mockClear();
  const viewer = response(); await handler(request({ body: { interaction: 'fixture-interaction', approve: true, projectId: PILOT_PROJECT } }), viewer);
  expect(viewer.code).toBe(403); expect(f.create).not.toHaveBeenCalled();
});
