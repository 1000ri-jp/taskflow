// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { authenticateMcp, activeUser, firebaseConsentUser } from './oidc';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
const fake = vi.hoisted(() => ({ find: vi.fn(), grant: vi.fn(), user: vi.fn(), verify: vi.fn(), access: vi.fn(), binding: null }));
vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: () => ({ getUser: fake.user, verifyIdToken: fake.verify }),
  getAdminDb: () => ({ collection: name => ({ doc: () => ({ get: async () => name === 'users' ? { exists: true } : { data: () => fake.binding } }) }) }),
}));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('../../../scripts/mcp-events/oidc-provider.mjs', () => ({ TEST_SCOPE: 'events:test', makeProvider: () => ({ AccessToken: { find: fake.find }, Grant: { find: fake.grant } }) }));
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
