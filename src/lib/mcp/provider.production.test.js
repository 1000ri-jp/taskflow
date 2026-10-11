// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import { makeProvider, mountedCallback } from '../../../scripts/mcp-events/oidc-provider.mjs';

let server, port, provider, active = true;
const origin = 'https://slowth.example.test', clientId = 'https://chatgpt.com/oauth/client.json';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect', resource = origin + '/api/mcp';
const records = new Map();
class Adapter {
  constructor(name) { this.name = name; }
  ref(id) { return this.name + ':' + id; }
  async upsert(id, payload, seconds = 365 * 86400) { records.set(this.ref(id), { ...payload, fixtureExpiry: Date.now() + seconds * 1000 }); }
  async find(id) { const record = records.get(this.ref(id)); return record?.fixtureExpiry > Date.now() ? { ...record } : undefined; }
  async findByUid(uid) { return [...records].find(([key, value]) => key.startsWith(this.name + ':') && value.uid === uid)?.[1]; }
  async consume(id) { records.get(this.ref(id)).consumed = Math.floor(Date.now() / 1000); }
  async destroy(id) { records.delete(this.ref(id)); }
  async revokeByGrantId(id) { for (const [key, value] of records) if (value.grantId === id) records.delete(key); }
}
beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  provider = makeProvider({ issuer: origin + '/api/oidc', resource, clientId, redirectUri, productionEnabled: true, taskAccessEnabled: true, claudeEnabled: true,
    jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' }] },
    cookieKeys: [randomBytes(32).toString('hex')], adapter: Adapter,
    clients: [{ client_id: clientId, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }],
    findAccount: async () => {
      if (!active) return undefined;
      return { accountId: 'fixture-user', claims: async () => ({ sub: 'fixture-user' }) };
    },
  });
  const callback = mountedCallback(provider, '/api/oidc');
  server = createServer(async (req, res) => {
    req.headers.host = new URL(origin).host; req.headers['x-forwarded-host'] = new URL(origin).host; req.headers['x-forwarded-proto'] = 'https';
    if (req.url.startsWith('/api/oidc/') || req.url.startsWith('/.well-known/')) return callback(req, res);
    try {
      const details = await provider.interactionDetails(req, res);
      const grant = new provider.Grant({ accountId: 'fixture-user', clientId: details.params.client_id });
      grant.addOIDCScope(details.params.scope);
      grant.addResourceScope(resource, details.params.scope.split(' ').filter(s => s.startsWith('events:') || s.startsWith('tasks:')).join(' '));
      const grantId = await grant.save();
      const resume = await provider.interactionResult(req, res, { login: { accountId: 'fixture-user', remember: false, ts: Math.floor(Date.now() / 1000) }, consent: { grantId } }, { mergeWithLastSubmission: false });
      res.writeHead(302, { Location: resume }); res.end();
    } catch (error) { res.writeHead(500); res.end('Fixture consent failed: ' + error.name + ': ' + (error.error_description ?? error.message)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); port = server.address().port;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function authorize(scope, client = { client_id: clientId, redirect_uri: redirectUri }) {
  const jar = new CookieJar();
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uri, resource, ...(scope === undefined ? {} : { scope }),
    response_type: 'code', state: 'fixture-state', code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url') });
  let next = new URL('/api/oidc/auth?' + params, origin);
  for (let n = 0; n < 10 && next.origin === origin; n++) {
    const response = await fetch(`http://127.0.0.1:${port}${next.pathname}${next.search}`, {
      redirect: 'manual', headers: { Cookie: await jar.getCookieString(next.href) } });
    for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, next.href);
    if (![302, 303].includes(response.status)) throw new Error(await response.text());
    next = new URL(response.headers.get('location'), next);
  }
  expect(next.origin).toBe(new URL(client.redirect_uri).origin);
  expect(next.searchParams.get('error')).toBeNull();
  return { grant_type: 'authorization_code', code: next.searchParams.get('code'), code_verifier: verifier, client_id: client.client_id, redirect_uri: client.redirect_uri };
}
async function issue(scope, client) {
  const response = await token(await authorize(scope, client));
  expect(response.status).toBe(200);
  return response.body;
}
async function token(values) {
  const response = await fetch(`http://127.0.0.1:${port}/api/oidc/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, resource, ...values }) });
  return { status: response.status, body: await response.json() };
}
it('issues production access plus rotating refresh, and detects refresh token replay', async () => {
  const first = await issue('events:read openid offline_access');
  expect(first.scope).toBe('events:read'); expect(first.expires_in).toBe(3600); expect(first.refresh_token).toBeTypeOf('string');
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
  expect(refreshed.status).toBe(200); expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
  expect(refreshed.body.scope).toBe('events:read');
  const replay = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
  expect(replay.status).toBe(400); expect(replay.body.error).toBe('invalid_grant');
  expect((await token({ grant_type: 'refresh_token', refresh_token: refreshed.body.refresh_token })).status).toBe(400);
});
it('does not grant refresh tokens to synthetic tests', async () => {
  const first = await issue('events:test openid');
  expect(first.refresh_token).toBeUndefined(); expect(first.scope).toBe('events:test');
});
it('rechecks account availability on token refresh', async () => {
  const first = await issue('events:read openid offline_access');
  active = false;
  try { expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).status).toBe(400); }
  finally { active = true; }
});

it('issues and refreshes the exact newly consented task scopes without widening old grants', async () => {
  const expanded = await issue('events:read tasks:read tasks:write openid offline_access');
  expect(expanded.scope.split(' ').sort()).toEqual(['events:read', 'tasks:read', 'tasks:write']);
  const refresh = await token({ grant_type: 'refresh_token', refresh_token: expanded.refresh_token });
  expect(refresh.status).toBe(200); expect(refresh.body.scope).toBe(expanded.scope);
  const original = await issue('events:read openid offline_access');
  const oldRefresh = await token({ grant_type: 'refresh_token', refresh_token: original.refresh_token });
  expect(oldRefresh.body.scope).toBe('events:read');
});

const claudeRedirect = 'https://claude.ai/api/mcp/auth_callback';
async function register(patch = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/oidc/reg`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      client_name: 'Claude', redirect_uris: [claudeRedirect], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...patch,
    }),
  });
  return { status: response.status, body: await response.json() };
}
it('advertises Claude registration and one consistent production scope set', async () => {
  for (const path of ['/api/oidc/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/api/oidc', '/.well-known/openid-configuration/api/oidc']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const metadata = await response.json();
    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({ authorization_endpoint: origin + '/api/oidc/auth', registration_endpoint: origin + '/api/oidc/reg', code_challenge_methods_supported: ['S256'] });
    expect(metadata.scopes_supported).toEqual(['events:read', 'openid', 'offline_access', 'tasks:read', 'tasks:write']);
  }
});
it.each(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'])('registers Claude and completes authorization and refresh for %s', async redirect_uri => {
  const registered = await register({ redirect_uris: [redirect_uri] });
  expect(registered.status).toBe(201);
  expect(registered.body.client_id).toMatch(/^slowth-claude-/);
  expect(registered.body.client_secret).toBeUndefined();
  expect(registered.body.registration_access_token).toBeUndefined();
  const client = { client_id: registered.body.client_id, redirect_uri };
  const first = await issue('events:read tasks:read tasks:write', client);
  expect(first.scope.split(' ').sort()).toEqual(['events:read', 'tasks:read', 'tasks:write']);
  const refresh = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id });
  expect(refresh.status).toBe(200); expect(refresh.body.scope).toBe(first.scope);
});
it('handles a Claude authorization request without a scope using the consented production defaults', async () => {
  const registered = await register();
  const first = await issue(undefined, { client_id: registered.body.client_id, redirect_uri: claudeRedirect });
  expect(first.scope.split(' ').sort()).toEqual(['events:read', 'tasks:read', 'tasks:write']);
});
it('keeps a Claude read-only request read-only and binds codes and refresh tokens to that client', async () => {
  const a = await register(), b = await register();
  const client = { client_id: a.body.client_id, redirect_uri: claudeRedirect };
  const code = await authorize('events:read tasks:read', client);
  expect((await token({ ...code, client_id: b.body.client_id })).status).toBe(400);
  const first = await issue('events:read tasks:read', client);
  expect(first.scope).not.toContain('tasks:write');
  expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: b.body.client_id })).status).toBe(400);
});
it.each([
  { redirect_uris: ['https://attacker.example/api/mcp/auth_callback'] },
  { redirect_uris: ['https://claude.ai.attacker.example/api/mcp/auth_callback'] },
  { redirect_uris: [claudeRedirect + '?next=https://attacker.example'] },
  { redirect_uris: [claudeRedirect, 'http://localhost:3000/callback'] },
  { token_endpoint_auth_method: 'client_secret_post' },
  { grant_types: ['authorization_code', 'client_credentials'] },
  { sector_identifier_uri: 'https://attacker.example/sector.json' },
  { jwks_uri: 'https://attacker.example/keys.json' },
])('rejects unsupported registration metadata before storing it: %j', async patch => {
  const count = [...records.keys()].filter(key => key.startsWith('Client:')).length;
  expect((await register(patch)).status).toBe(400);
  expect([...records.keys()].filter(key => key.startsWith('Client:'))).toHaveLength(count);
});
it('rejects a changed Claude callback and missing PKCE before redirecting', async () => {
  const registered = await register();
  const params = new URLSearchParams({ client_id: registered.body.client_id, redirect_uri: claudeRedirect, resource,
    scope: 'events:read tasks:read', response_type: 'code', state: 'fixture-state', code_challenge_method: 'S256', code_challenge: 'fixture' });
  for (const patch of [{ redirect_uri: claudeRedirect + '/extra' }, { code_challenge_method: 'plain' }]) {
    const changed = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) changed.set(key, value);
    const response = await fetch(`http://127.0.0.1:${port}/api/oidc/auth?${changed}`, { redirect: 'manual' });
    expect(response.status).toBe(400); expect(response.headers.get('location')).toBeNull();
  }
});
