// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { authenticateMcp, activeUser, firebaseConsentUser, allowedClient, oidcConfig } from './oidc';
import { CLAUDE_CODE_CLIENT, CLAUDE_CLIENT } from '../../../scripts/mcp-events/oidc-provider.mjs';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
const fake = vi.hoisted(() => ({ find: vi.fn(), grant: vi.fn(), user: vi.fn(), verify: vi.fn(), access: vi.fn(), binding: null, providerConfig: null }));
vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: () => ({ getUser: fake.user, verifyIdToken: fake.verify }),
  getAdminDb: () => ({ collection: name => ({ doc: () => ({ get: async () => name === 'users' ? { exists: true } : { data: () => fake.binding } }) }) }),
}));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('../../../scripts/mcp-events/oidc-provider.mjs', async () => ({ ...(await vi.importActual('../../../scripts/mcp-events/oidc-provider.mjs')), makeProvider: config => { fake.providerConfig = config; return { AccessToken: { find: fake.find }, Grant: { find: fake.grant } }; } }));
vi.mock('../../../scripts/mcp-events/oidc-store.mjs', () => ({ firestoreAdapter: () => class {} }));
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ ENABLED: 'true', ORIGIN: 'https://slowth.example.test', ALLOWED_UID: 'fixture-user',
    CLIENT_ID: 'https://chatgpt.com/oauth/client.json', REDIRECT_URI: 'https://chatgpt.com/connector_platform_oauth_redirect',
    JWKS: '{"keys":[{"d":"fixture"}]}', COOKIE_KEYS: JSON.stringify(['fixture-cookie-key-not-a-secret'.repeat(2)]), STORAGE_KEY: Buffer.alloc(32, 3).toString('base64'),
  })) vi.stubEnv('SLOWTH_MCP_OAUTH_' + key, value);
  const providerExpiry = Math.floor(Date.now() / 1000) + 900;
  fake.find.mockResolvedValue({ accountId: 'fixture-user', grantId: 'fixture-grant', clientId: 'https://chatgpt.com/oauth/client.json', aud: 'https://slowth.example.test/api/mcp', scope: 'events:test', exp: providerExpiry });
  fake.grant.mockResolvedValue({ exp: providerExpiry });
  fake.user.mockResolvedValue({ disabled: false, emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: '2026-01-01T00:00:00Z' });
  fake.access.mockResolvedValue({ role: 'viewer' });
  const bindingExpiry = Date.now() + 60000;
  fake.binding = { userId: 'fixture-user', authTime: Date.parse('2026-10-04T00:00:00Z') / 1000, projectId: 'fixture-project', clientId: 'https://chatgpt.com/oauth/client.json', resource: 'https://slowth.example.test/api/mcp', expiresAt: { toMillis: () => bindingExpiry } };
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it('binds token to one grant/user/project and checks current project access', async () => {
  const auth = await authenticateMcp('Bearer fixture-only');
  expect(auth).toEqual({ userId: 'fixture-user', grantId: 'fixture-grant', expiresAt: fake.binding.expiresAt.toMillis(), permissions: ['tasks:read'], projectIds: ['fixture-project'] });
  expect(fake.access).toHaveBeenCalledWith('fixture-user', 'fixture-project', ['tasks:read'], ['fixture-project'], 'tasks:read');
});
it.each(['token', 'grant', 'binding'])('returns the earliest actual %s expiration', async source => {
  const expiresAt = (Math.floor(Date.now() / 1000) + 30) * 1000;
  if (source === 'token') fake.find.mockResolvedValue({ ...(await fake.find()), exp: expiresAt / 1000 });
  if (source === 'grant') fake.grant.mockResolvedValue({ exp: expiresAt / 1000 });
  if (source === 'binding') fake.binding.expiresAt.toMillis = () => expiresAt;
  expect((await authenticateMcp('Bearer fixture-only')).expiresAt).toBe(expiresAt);
});
it.each(['token', 'grant', 'binding'])('rejects missing, nonfinite and expired %s deadlines', async source => {
  const token = await fake.find();
  for (const expiration of [undefined, NaN, Infinity, 0]) {
    if (source === 'token') fake.find.mockResolvedValue({ ...token, exp: expiration });
    if (source === 'grant') fake.grant.mockResolvedValue({ exp: expiration });
    if (source === 'binding') fake.binding.expiresAt.toMillis = () => expiration;
    await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  }
});
it('rejects a deadline reached while checking project access', async () => {
  vi.useFakeTimers();
  fake.access.mockImplementationOnce(async () => { vi.setSystemTime(fake.binding.expiresAt.toMillis()); return { role: 'viewer' }; });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow('Unauthorized');
});
it.each([{ aud: 'https://other.example' }, { clientId: 'other-client' }, { scope: 'tasks:write' }, { accountId: 'other-user' }])('rejects token binding mismatch %j', async patch => {
  fake.find.mockResolvedValue({ ...(await fake.find()), ...patch });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});
it('rejects revocation, expiration, disabled users and revoked membership', async () => {
  fake.grant.mockResolvedValueOnce(undefined);
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  fake.binding.expiresAt.toMillis = () => 0;
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  fake.binding.expiresAt.toMillis = () => Date.now() + 60000;
  fake.user.mockResolvedValueOnce({ disabled: true });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  fake.access.mockRejectedValueOnce(new Error('FORBIDDEN'));
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});
it('rejects stale Firebase auth_time and a different allowed UID', async () => {
  await expect(activeUser('other-user')).rejects.toThrow();
  await expect(activeUser('fixture-user', undefined, 1)).rejects.toThrow();
});
it('consent requires a revoked-token check and verified Google login', async () => {
  fake.verify.mockResolvedValue({ uid: 'fixture-user', email_verified: true, firebase: { sign_in_provider: 'password' } });
  await expect(firebaseConsentUser('Bearer fictional-id-token')).rejects.toThrow();
  expect(fake.verify).toHaveBeenCalledWith('fictional-id-token', true);
});

it('separates production grant lifetime from one-hour token lifetime', async () => {
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT);
  const tokenExpiry = (Math.floor(Date.now() / 1000) + 3600) * 1000;
  const grantExpiry = (Math.floor(Date.now() / 1000) + 30 * 86400) * 1000;
  fake.find.mockResolvedValue({ ...(await fake.find()), scope: 'events:read', exp: tokenExpiry / 1000 });
  fake.grant.mockResolvedValue({ exp: grantExpiry / 1000 });
  fake.binding = { ...fake.binding, mode: 'production', projectId: PILOT_PROJECT, expiresAt: { toMillis: () => grantExpiry } };
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ mode: 'production', expiresAt: tokenExpiry,
    authorizationExpiresAt: grantExpiry, projectIds: [PILOT_PROJECT] });
});
it('rejects production tokens when disabled or bound to another project', async () => {
  fake.find.mockResolvedValue({ ...(await fake.find()), scope: 'events:read' });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT);
  fake.binding.mode = 'production';
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});

it('requires fresh task scopes in token and grant; legacy event tokens never acquire writes', async () => {
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT); vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'true');
  fake.binding = { ...fake.binding, mode: 'production', projectId: PILOT_PROJECT };
  const original = await fake.find();
  fake.find.mockResolvedValue({ ...original, scope: 'events:read tasks:read tasks:write' });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  fake.binding.taskScopes = ['tasks:read', 'tasks:write'];
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ taskScopes: ['tasks:read', 'tasks:write'], permissions: ['tasks:read', 'tasks:write'] });
  fake.find.mockResolvedValue({ ...original, scope: 'events:read' });
  expect(await authenticateMcp('Bearer fixture-only')).not.toHaveProperty('taskScopes');
  fake.find.mockResolvedValue({ ...original, scope: 'events:read tasks:write' });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  fake.find.mockResolvedValue({ ...original, scope: 'events:read tasks:read tasks:write' }); vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'false');
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});

async function multipleBinding() {
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT);
  vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'true'); vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'true');
  fake.find.mockResolvedValue({ ...(await fake.find()), scope: 'events:read tasks:read tasks:write' });
  const binding = { ...fake.binding }; delete binding.projectId;
  fake.binding = { ...binding, mode: 'production', consentVersion: 2, includeFutureProjects: false,
    projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [PILOT_PROJECT], aiProjectIds: [], eventProjectIds: [], taskScopes: ['tasks:read', 'tasks:write'] };
}
it('authenticates only the explicitly consented read/write/AI/event snapshot', async () => {
  await multipleBinding();
  const auth = await authenticateMcp('Bearer fixture-only');
  expect(auth).toMatchObject({ consentVersion: 2, projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [PILOT_PROJECT], aiProjectIds: [], eventProjectIds: [], includeFutureProjects: false });
  expect(fake.access).not.toHaveBeenCalled();
});
it('disables multi-project grants unless explicitly configured and never expands an older pilot grant', async () => {
  await multipleBinding(); vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'false');
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'true');
  const binding = { ...fake.binding };
  for (const key of ['consentVersion', 'includeFutureProjects', 'projectIds', 'writeProjectIds', 'aiProjectIds', 'eventProjectIds']) delete binding[key];
  fake.binding = { ...binding, projectId: PILOT_PROJECT };
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ projectIds: [PILOT_PROJECT] });
  expect(await authenticateMcp('Bearer fixture-only')).not.toHaveProperty('consentVersion');
});
it('keeps a fixed consent snapshot and leaves current membership checks to each requested resource', async () => {
  await multipleBinding();
  fake.access.mockImplementation(async (_uid, project) => { if (project === PILOT_PROJECT) throw new Error('FORBIDDEN'); return { role: 'viewer' }; });
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [PILOT_PROJECT], aiProjectIds: [], eventProjectIds: [] });
  expect(fake.binding.projectIds).toEqual([PILOT_PROJECT, 'viewer']);
  expect(fake.access).not.toHaveBeenCalled();
});
it('rejects malformed snapshots and arrays silently added to an existing single-project grant', async () => {
  await multipleBinding(); fake.binding.includeFutureProjects = true;
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  delete fake.binding.consentVersion; fake.binding.projectId = PILOT_PROJECT;
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});

async function refreshAccount(clientId = fake.binding.clientId) {
  vi.resetModules(); const { oidcProvider } = await import('./oidc'); oidcProvider();
  return fake.providerConfig.findAccount({ oidc: { entities: { RefreshToken: { grantId: 'fixture-grant', clientId } } } }, 'fixture-user');
}
it('refreshes only the stored snapshot, skipping a removed membership without adding newly visible projects', async () => {
  await multipleBinding();
  fake.access.mockImplementation(async (_uid, project) => { if (project === PILOT_PROJECT) throw new Error('FORBIDDEN'); return { role: 'viewer' }; });
  const before = { ...fake.binding, projectIds: [...fake.binding.projectIds] };
  expect((await refreshAccount()).accountId).toBe('fixture-user');
  expect(fake.access.mock.calls.map(call => call[1])).toEqual([PILOT_PROJECT, 'viewer']);
  expect(fake.binding).toEqual(before);
});
it.each(['no-memberships', 'read-feature-disabled', 'expired', 'wrong-client', 'storage-error', 'future-projects'])('rejects refresh after %s', async reason => {
  await multipleBinding();
  if (reason === 'no-memberships') fake.access.mockRejectedValue(new Error('FORBIDDEN'));
  if (reason === 'read-feature-disabled') vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'false');
  if (reason === 'expired') fake.binding.expiresAt = { toMillis: () => 0 };
  if (reason === 'wrong-client') fake.binding.clientId = 'other';
  if (reason === 'storage-error') fake.access.mockRejectedValue(new Error('storage unavailable'));
  if (reason === 'future-projects') fake.binding.includeFutureProjects = true;
  await expect(refreshAccount()).rejects.toThrow();
});

const claudeClient = CLAUDE_CODE_CLIENT.client_id;
it('opts in only the pinned native client and preserves the exact ChatGPT callback', () => {
  const callback = 'http://localhost:55050/callback';
  expect(allowedClient(oidcConfig(), claudeClient, callback)).toBeNull();
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT);
  vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE_CODE', 'true');
  expect(allowedClient(oidcConfig(), claudeClient, callback)).toBe('claude-code');
  expect(allowedClient(oidcConfig(), claudeClient, 'http://127.0.0.1:1/callback')).toBe('claude-code');
  for (const uri of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:65536/callback', 'http://localhost:1/other', 'http://localhost:1/callback?x=1']) expect(allowedClient(oidcConfig(), claudeClient, uri)).toBeNull();
  expect(allowedClient(oidcConfig(), oidcConfig().clientId, callback)).toBeNull();
  expect(allowedClient(oidcConfig(), oidcConfig().clientId, oidcConfig().redirectUri)).toBe('chatgpt');
});
async function claudeBinding() {
  await multipleBinding(); vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE_CODE', 'true');
  fake.find.mockResolvedValue({ ...(await fake.find()), clientId: claudeClient });
  fake.binding.clientId = claudeClient;
}
it('authenticates Claude with the exact v2 snapshot and no ChatGPT event access', async () => {
  await claudeBinding();
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ client: 'claude-code', consentVersion: 2, projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [PILOT_PROJECT], aiProjectIds: [], eventProjectIds: [] });
  fake.binding.clientId = oidcConfig().clientId;
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow('Unauthorized');
});
it('keeps native-client tokens disabled unless explicitly enabled and refuses synthetic mode', async () => {
  await claudeBinding(); vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE_CODE', 'false');
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
  vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE_CODE', 'true');
  fake.find.mockResolvedValue({ ...(await fake.find()), scope: 'events:test' });
  await expect(authenticateMcp('Bearer fixture-only')).rejects.toThrow();
});
it('refreshes Claude v2 consent using only its original projects and exact client', async () => {
  await claudeBinding();
  fake.access.mockImplementation(async (_uid, project) => { if (project === PILOT_PROJECT) throw new Error('FORBIDDEN'); return { role: 'viewer' }; });
  const before = { ...fake.binding, projectIds: [...fake.binding.projectIds] };
  expect((await refreshAccount()).accountId).toBe('fixture-user');
  expect(fake.binding).toEqual(before);
  expect(fake.access.mock.calls.map(call => call[1])).toEqual([PILOT_PROJECT, 'viewer']);
  await expect(refreshAccount(oidcConfig().clientId)).rejects.toThrow('Forbidden');
});
it.each(['disabled-client', 'disabled-read', 'expired', 'no-membership', 'firebase-revoked', 'firebase-disabled', 'wrong-resource', 'future-projects'])('rejects Claude refresh after %s without widening consent', async reason => {
  await claudeBinding();
  if (reason === 'disabled-client') vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE_CODE', 'false');
  if (reason === 'disabled-read') vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'false');
  if (reason === 'expired') fake.binding.expiresAt = { toMillis: () => 0 };
  if (reason === 'no-membership') fake.access.mockRejectedValue(new Error('FORBIDDEN'));
  if (reason === 'firebase-revoked') fake.binding.authTime = 1;
  if (reason === 'firebase-disabled') fake.user.mockResolvedValue({ disabled: true });
  if (reason === 'wrong-resource') fake.binding.resource = 'https://other.example.test/mcp';
  if (reason === 'future-projects') fake.binding.includeFutureProjects = true;
  await expect(refreshAccount()).rejects.toThrow();
});

async function hostedBinding() {
  await multipleBinding(); vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE', 'true');
  fake.find.mockResolvedValue({ ...(await fake.find()), clientId: CLAUDE_CLIENT.client_id });
  fake.binding.clientId = CLAUDE_CLIENT.client_id;
}
it('allows the exact Desktop public client only when enabled, separately from Code', () => {
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true'); vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', PILOT_PROJECT);
  expect(allowedClient(oidcConfig(), CLAUDE_CLIENT.client_id, CLAUDE_CLIENT.redirect_uris[0])).toBeNull();
  vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE', 'true');
  expect(allowedClient(oidcConfig(), CLAUDE_CLIENT.client_id, CLAUDE_CLIENT.redirect_uris[0])).toBe('claude');
  expect(allowedClient(oidcConfig(), CLAUDE_CLIENT.client_id, 'http://localhost:55050/callback')).toBeNull();
  expect(allowedClient(oidcConfig(), CLAUDE_CODE_CLIENT.client_id, CLAUDE_CLIENT.redirect_uris[0])).toBeNull();
});
it('preserves the hosted v2 grant client and snapshot during authentication and refresh', async () => {
  await hostedBinding();
  expect(await authenticateMcp('Bearer fixture-only')).toMatchObject({ client: 'claude', consentVersion: 2, projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [PILOT_PROJECT], aiProjectIds: [], eventProjectIds: [] });
  expect((await refreshAccount()).accountId).toBe('fixture-user');
  await expect(refreshAccount(oidcConfig().clientId)).rejects.toThrow('Forbidden');
  await expect(refreshAccount(CLAUDE_CODE_CLIENT.client_id)).rejects.toThrow('Forbidden');
});
it.each(['disabled-client', 'disabled-read', 'expired', 'no-membership', 'firebase-revoked', 'wrong-client', 'wrong-resource'])('rejects hosted refresh after %s', async reason => {
  await hostedBinding();
  if (reason === 'disabled-client') vi.stubEnv('SLOWTH_MCP_OAUTH_CLAUDE', 'false');
  if (reason === 'disabled-read') vi.stubEnv('SLOWTH_MCP_MULTI_PROJECT_READ', 'false');
  if (reason === 'expired') fake.binding.expiresAt = { toMillis: () => 0 };
  if (reason === 'no-membership') fake.access.mockRejectedValue(new Error('FORBIDDEN'));
  if (reason === 'firebase-revoked') fake.binding.authTime = 1;
  if (reason === 'wrong-client') fake.binding.clientId = oidcConfig().clientId;
  if (reason === 'wrong-resource') fake.binding.resource = 'https://other.example/mcp';
  await expect(refreshAccount(CLAUDE_CLIENT.client_id)).rejects.toThrow();
});
