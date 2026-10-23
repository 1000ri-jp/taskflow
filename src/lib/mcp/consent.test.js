// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import handler from '@/pages/api/mcp-consent';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
import { CLAUDE_CODE_CLIENT, CLAUDE_CLIENT, MUSE_CLIENT } from '../../../scripts/mcp-events/oidc-provider.mjs';
const f = vi.hoisted(() => ({ production: false, taskAccess: false, multiple: false, claudeCode: false, claude: false, muse: false, selectors: vi.fn(), details: vi.fn(), finish: vi.fn(), user: vi.fn(), access: vi.fn(), create: vi.fn(), save: vi.fn(), write: vi.fn(), projects: vi.fn(), oidcScope: vi.fn(), resourceScope: vi.fn() }));
vi.mock('@/lib/mcp/oidc', async () => ({
  allowedClient: (await vi.importActual('@/lib/mcp/oidc')).allowedClient,
  oidcConfig: () => ({ origin: 'https://slowth.example.test', clientId: 'fixture-client', redirectUri: 'https://chatgpt.com/fixture-callback', resource: 'https://slowth.example.test/api/mcp', productionEnabled: f.production, taskAccessEnabled: f.taskAccess, multiProjectReadEnabled: f.multiple, claudeCodeEnabled: f.production && f.claudeCode, claudeEnabled: f.production && f.claude, museEnabled: f.production && f.muse }),
  oidcProvider: () => ({ interactionDetails: f.details, interactionResult: f.finish,
    Grant: class { addOIDCScope(scope) { f.oidcScope(scope); } addResourceScope(resource, scope) { f.resourceScope(resource, scope); } save() { return f.save(); } } }),
  firebaseConsentUser: f.user, assertProject: f.access, digest: value => value,
}));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: () => ({ doc: () => ({ create: f.create, set: f.write }) }) }) }));
vi.mock('@/lib/firebase/admin-projects', () => ({ listUserProjects: f.projects }));
vi.mock('@/lib/mcp/projectConsent', () => ({ listConsentProjects: f.selectors }));
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
  f.production = false; f.taskAccess = false; f.multiple = false; f.claudeCode = false; f.claude = false; f.muse = false;
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

async function multipleConsent() {
  f.production = true; f.taskAccess = true; f.multiple = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, scope: 'events:read tasks:read tasks:write openid offline_access' } });
  f.selectors.mockResolvedValue([
    { id: PILOT_PROJECT, name: '架空pilot', canWrite: true, canWork: true, canNotify: true },
    { id: 'viewer', name: '架空閲覧専用', canWrite: false, canWork: false, canNotify: false },
    { id: 'editable', name: '架空編集可能', canWrite: true, canWork: true, canNotify: false },
  ]);
  return { interaction: 'fixture-interaction', approve: true, consentVersion: 2,
    projectIds: [PILOT_PROJECT, 'viewer', 'editable'], writeProjectIds: [], aiProjectIds: [], eventProjectIds: [], includeFutureProjects: false };
}
it('offers every currently readable project for new consent without changing a grant', async () => {
  await multipleConsent();
  const r = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.body).toMatchObject({ consentVersion: 2, includeFutureProjects: false, maxDays: 30, maxProjects: 500 });
  expect(r.body.projects).toEqual(await f.selectors()); expect(f.write).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it('records an exact read snapshot including viewers and creates no event connection by default', async () => {
  const body = await multipleConsent(); const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledTimes(1);
  expect(f.write.mock.calls[0][0]).toMatchObject({ consentVersion: 2, projectIds: body.projectIds, writeProjectIds: [], aiProjectIds: [], eventProjectIds: [], includeFutureProjects: false });
  expect(f.write.mock.calls[0][0]).not.toHaveProperty('projectId');
});
it('records independent per-project write, AI and pilot event choices on a new grant', async () => {
  const body = { ...await multipleConsent(), writeProjectIds: [PILOT_PROJECT, 'editable'], aiProjectIds: ['editable'], eventProjectIds: [PILOT_PROJECT] };
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(200); expect(f.save).toHaveBeenCalledOnce(); expect(f.write).toHaveBeenCalledTimes(2);
  expect(f.write.mock.calls[0][0]).toMatchObject({ projectIds: body.projectIds, writeProjectIds: body.writeProjectIds, aiProjectIds: ['editable'], eventProjectIds: [PILOT_PROJECT] });
  expect(f.write.mock.calls[1][0]).toMatchObject({ consentVersion: 2, projectId: PILOT_PROJECT, eventProjectIds: [PILOT_PROJECT] });
});
it.each([
  { projectIds: [] }, { projectIds: ['unknown'] }, { projectIds: ['viewer', 'viewer'] }, { projectIds: ['*'] },
  { includeFutureProjects: true }, { includeFutureProjects: null }, { consentVersion: 3 }, { projectId: PILOT_PROJECT },
  { writeProjectIds: ['unknown'] }, { writeProjectIds: ['viewer'] }, { aiProjectIds: ['editable'] },
  { eventProjectIds: ['editable'] }, { eventProjectIds: [PILOT_PROJECT], projectIds: ['viewer'] },
])('refuses invalid or unauthorized consent %j before issuing anything', async patch => {
  const body = { ...await multipleConsent(), ...patch }; const r = response(); await handler(request({ body }), r);
  expect([400, 403]).toContain(r.code); expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it('rechecks current permissions on approval rather than trusting selector metadata', async () => {
  const body = await multipleConsent(); f.selectors.mockResolvedValueOnce([]);
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(403); expect(f.save).not.toHaveBeenCalled();
});
it('does not accept write choices with a read-only scope or arrays in a legacy request', async () => {
  const body = { ...await multipleConsent(), writeProjectIds: ['editable'] };
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, scope: 'events:read tasks:read openid offline_access' } });
  const read = response(); await handler(request({ body }), read); expect(read.code).toBe(403);
  f.multiple = false; const legacy = response(); await handler(request({ body }), legacy); expect(legacy.code).toBe(400);
  expect(f.save).not.toHaveBeenCalled();
});

async function claudeConsent(multiple = true) {
  const body = await multipleConsent(); f.multiple = multiple; f.claudeCode = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params,
    client_id: CLAUDE_CODE_CLIENT.client_id, redirect_uri: 'http://localhost:55050/callback', scope: 'events:read tasks:read tasks:write offline_access' } });
  return body;
}
it('returns Claude identity in the v2 selector and disables ChatGPT-only notification choices', async () => {
  await claudeConsent();
  const r = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.body).toMatchObject({ client: 'claude-code', consentVersion: 2, includeFutureProjects: false, maxProjects: 500 });
  expect(r.body.projects).toEqual((await f.selectors()).map(p => ({ ...p, canNotify: false })));
  expect(f.write).not.toHaveBeenCalled();
});
it('binds the v2 snapshot to Claude and keeps independent write and AI choices without event records', async () => {
  const body = { ...await claudeConsent(), writeProjectIds: ['editable'], aiProjectIds: ['editable'] };
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledOnce();
  expect(f.write.mock.calls[0][0]).toMatchObject({ clientId: CLAUDE_CODE_CLIENT.client_id, consentVersion: 2, projectIds: body.projectIds, writeProjectIds: ['editable'], aiProjectIds: ['editable'], eventProjectIds: [] });
  expect(f.write.mock.calls[0][0]).not.toHaveProperty('projectId');
});
it('refuses Claude event consent on the server before storing any grant', async () => {
  const body = { ...await claudeConsent(), eventProjectIds: [PILOT_PROJECT] };
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(403); expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it('keeps legacy Claude consent bound to its client without creating a notification connection', async () => {
  await claudeConsent(false);
  const selector = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), selector);
  expect(selector.body.client).toBe('claude-code');
  const r = response(); await handler(request({ body: { interaction: 'fixture-interaction', approve: true, projectId: PILOT_PROJECT } }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledOnce();
  expect(f.write.mock.calls[0][0]).toMatchObject({ clientId: CLAUDE_CODE_CLIENT.client_id, projectId: PILOT_PROJECT });
});
it.each(['disabled', 'hosted-callback', 'cross-client', 'expired-interaction'])('rejects native consent with %s', async reason => {
  const body = await claudeConsent(); const details = await f.details();
  if (reason === 'disabled') f.claudeCode = false;
  if (reason === 'hosted-callback') details.params.redirect_uri = 'https://claude.ai/api/mcp/auth_callback';
  if (reason === 'cross-client') details.params.client_id = 'fixture-client';
  if (reason === 'expired-interaction') details.uid = 'different-interaction';
  f.details.mockResolvedValue(details);
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(403); expect(f.create).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});

async function hostedConsent() {
  const body = await multipleConsent(); f.claude = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params,
    client_id: CLAUDE_CLIENT.client_id, redirect_uri: CLAUDE_CLIENT.redirect_uris[0], scope: 'events:read tasks:read tasks:write offline_access' } });
  return body;
}
it('returns hosted identity and callback hostname with the v2 project selector', async () => {
  await hostedConsent(); const r = response();
  await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), r);
  expect(r.body).toMatchObject({ client: 'claude', redirectHost: 'claude.ai', consentVersion: 2 });
  expect(r.body.projects.every(p => p.canNotify === false)).toBe(true);
});
it('stores hosted read/write/AI snapshots under the exact client and never creates event connections', async () => {
  const body = { ...await hostedConsent(), writeProjectIds: ['editable'], aiProjectIds: ['editable'] };
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledOnce();
  expect(f.write.mock.calls[0][0]).toMatchObject({ clientId: CLAUDE_CLIENT.client_id, projectIds: body.projectIds, writeProjectIds: ['editable'], aiProjectIds: ['editable'], eventProjectIds: [] });
  f.create.mockClear(); f.save.mockClear(); f.write.mockClear();
  const denied = response(); await handler(request({ body: { ...body, eventProjectIds: [PILOT_PROJECT] } }), denied);
  expect(denied.code).toBe(403); expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});

async function museConsent() {
  const body = await multipleConsent(); f.muse = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params,
    client_id: MUSE_CLIENT.client_id, redirect_uri: MUSE_CLIENT.redirect_uris[0], scope: 'events:read tasks:read tasks:write offline_access' } });
  return body;
}
it('shows Muse identity and saves only its explicit consent without event connections', async () => {
  const body = { ...await museConsent(), writeProjectIds: ['editable'], aiProjectIds: ['editable'] };
  const selector = response(); await handler(request({ method: 'GET', query: { interaction: 'fixture-interaction' } }), selector);
  expect(selector.body).toMatchObject({ client: 'muse', redirectHost: 'agent.meta.ai', consentVersion: 2 });
  expect(selector.body.projects.every(p => p.canNotify === false)).toBe(true);
  const r = response(); await handler(request({ body }), r);
  expect(r.code).toBe(200); expect(f.write).toHaveBeenCalledOnce();
  expect(f.write.mock.calls[0][0]).toMatchObject({ clientId: MUSE_CLIENT.client_id, projectIds: body.projectIds, writeProjectIds: ['editable'], aiProjectIds: ['editable'], eventProjectIds: [] });
  f.write.mockClear(); f.save.mockClear();
  const denied = response(); await handler(request({ body: { ...body, eventProjectIds: [PILOT_PROJECT] } }), denied);
  expect(denied.code).toBe(403); expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it('rejects Muse consent while disabled or with a substituted callback', async () => {
  const body = await museConsent(); f.muse = false;
  const disabled = response(); await handler(request({ body }), disabled); expect(disabled.code).toBe(403);
  f.muse = true;
  f.details.mockResolvedValue({ ...(await f.details()), params: { ...(await f.details()).params, redirect_uri: MUSE_CLIENT.redirect_uris[0] + '/' } });
  const mismatch = response(); await handler(request({ body }), mismatch); expect(mismatch.code).toBe(403);
  expect(f.save).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
