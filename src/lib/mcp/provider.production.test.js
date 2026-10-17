// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import { makeProvider, mountedCallback, CLAUDE_CODE_CLIENT, CLAUDE_CLIENT } from '../../../scripts/mcp-events/oidc-provider.mjs';

let server, port, provider, active = true;
const origin = 'https://slowth.example.test', clientId = 'https://chatgpt.com/oauth/client.json';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect', resource = origin + '/api/mcp';
const records = new Map();
class Adapter {
  constructor(name) { this.name = name; }
  ref(id) { return this.name + ':' + id; }
  async upsert(id, payload, seconds) { records.set(this.ref(id), { ...payload, fixtureExpiry: Date.now() + seconds * 1000 }); }
  async find(id) { const record = records.get(this.ref(id)); return record?.fixtureExpiry > Date.now() ? { ...record } : undefined; }
  async findByUid(uid) { return [...records].find(([key, value]) => key.startsWith(this.name + ':') && value.uid === uid)?.[1]; }
  async consume(id) { records.get(this.ref(id)).consumed = Math.floor(Date.now() / 1000); }
  async destroy(id) { records.delete(this.ref(id)); }
  async revokeByGrantId(id) { for (const [key, value] of records) if (value.grantId === id) records.delete(key); }
}
beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  provider = makeProvider({ issuer: origin + '/api/oidc', resource, clientId, redirectUri, productionEnabled: true, taskAccessEnabled: true, claudeCodeEnabled: true, claudeEnabled: true,
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
    if (req.url.startsWith('/api/oidc/')) return callback(req, res);
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
function authorizeUrl(scope, client = clientId, redirect = redirectUri, verifier = 'fixture-verifier') {
  return new URL('/api/oidc/auth?' + new URLSearchParams({ client_id: client, redirect_uri: redirect, resource, scope,
    response_type: 'code', state: 'fixture-state', code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url') }), origin);
}
async function issue(scope, client = clientId, redirect = redirectUri) {
  const jar = new CookieJar();
  const verifier = randomBytes(32).toString('base64url');
  let next = authorizeUrl(scope, client, redirect, verifier);
  for (let n = 0; n < 10 && next.origin === origin; n++) {
    const response = await fetch(`http://127.0.0.1:${port}${next.pathname}${next.search}`, {
      redirect: 'manual', headers: { Cookie: await jar.getCookieString(next.href) } });
    for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, next.href);
    if (![302, 303].includes(response.status)) throw new Error(await response.text());
    next = new URL(response.headers.get('location'), next);
  }
  expect(next.origin).toBe(new URL(redirect).origin);
  expect(next.searchParams.get('error')).toBeNull();
  const response = await token({ grant_type: 'authorization_code', code: next.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect }, client);
  expect(response.status).toBe(200);
  return response.body;
}
async function token(values, client = clientId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/oidc/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, resource, ...values }) });
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

// Exactly what Claude Code 2.1 sent: every advertised scope, no openid, a random loopback port.
const claudeScope = 'events:test events:read tasks:read tasks:write offline_access';
it('connects Claude Code through any loopback port and refreshes its task scopes', async () => {
  const first = await issue(claudeScope, CLAUDE_CODE_CLIENT.client_id, 'http://localhost:55050/callback');
  expect(first.scope.split(' ').sort()).toEqual(['events:read', 'tasks:read', 'tasks:write']);
  expect(first.refresh_token).toBeTypeOf('string'); expect(first.id_token).toBeUndefined();
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, CLAUDE_CODE_CLIENT.client_id);
  expect(refreshed.status).toBe(200); expect(refreshed.body.scope).toBe(first.scope);
  expect((await issue(claudeScope, CLAUDE_CODE_CLIENT.client_id, 'http://127.0.0.1:61234/callback')).refresh_token).toBeTypeOf('string');
});
it.each([
  [CLAUDE_CODE_CLIENT.client_id, 'https://evil.example/callback', claudeScope],
  [CLAUDE_CODE_CLIENT.client_id, 'http://localhost:55050/other', claudeScope],
  [CLAUDE_CODE_CLIENT.client_id, 'http://localhost/callback', claudeScope],
  [CLAUDE_CODE_CLIENT.client_id, 'http://localhost:65536/callback', claudeScope],
  [CLAUDE_CODE_CLIENT.client_id, 'https://claude.ai/api/mcp/auth_callback', claudeScope],
  [CLAUDE_CODE_CLIENT.client_id, 'http://localhost:55050/callback', 'events:test openid'],
  [clientId, 'http://localhost:55050/callback', 'events:read openid offline_access'],
  [clientId, redirectUri, 'events:read offline_access'],
])('rejects %s with callback %s and scope %s before any redirect', async (client, redirect, scope) => {
  const url = authorizeUrl(scope, client, redirect);
  const response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { redirect: 'manual' });
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'invalid_request' });
});
it('keeps Claude Code unknown unless enabled', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const disabled = makeProvider({ issuer: origin + '/api/oidc', resource, clientId, redirectUri, productionEnabled: true, taskAccessEnabled: true,
    jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' }] },
    cookieKeys: [randomBytes(32).toString('hex')], adapter: Adapter, findAccount: async () => undefined });
  await expect(disabled.Client.find(CLAUDE_CODE_CLIENT.client_id)).rejects.toThrow('invalid_client');
  await expect(disabled.Client.find(CLAUDE_CLIENT.client_id)).rejects.toThrow('invalid_client');
});

const hostedId = CLAUDE_CLIENT.client_id, hostedRedirect = CLAUDE_CLIENT.redirect_uris[0];
it('connects Desktop hosted with its own public client, exact HTTPS callback and rotating refresh', async () => {
  const first = await issue('events:read tasks:read offline_access', hostedId, hostedRedirect);
  expect(first.scope).toBe('events:read tasks:read'); expect(first.id_token).toBeUndefined();
  expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, CLAUDE_CODE_CLIENT.client_id)).status).toBe(400);
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, hostedId);
  expect(refreshed.status).toBe(200); expect(refreshed.body.scope).toBe(first.scope);
  expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
  const replay = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, hostedId);
  expect(replay.body.error).toBe('invalid_grant');
});
it.each([
  'http://localhost:55050/callback', 'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://claude.ai/api/mcp/auth_callback/', 'https://claude.ai/api/mcp/auth_callback?x=1',
  'https://claude.ai.evil.example/api/mcp/auth_callback', 'https://evil.example/callback',
])('rejects a hosted callback outside its exact registration: %s', async redirect => {
  const url = authorizeUrl('events:read tasks:read offline_access', hostedId, redirect);
  const r = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { redirect: 'manual' });
  expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: 'invalid_request' });
});
it('keeps DCR disabled and rejects missing or mismatched resource and PKCE before redirecting hosted clients', async () => {
  const meta = await (await fetch(`http://127.0.0.1:${port}/api/oidc/.well-known/openid-configuration`)).json();
  expect(meta.registration_endpoint).toBeUndefined(); expect(meta.client_id_metadata_document_supported).toBe(true);
  expect(meta.token_endpoint_auth_methods_supported).toContain('none');
  expect(meta.code_challenge_methods_supported).toEqual(['S256']);
  for (const [key, value] of [['resource', 'https://other.example/mcp'], ['resource', ''], ['code_challenge_method', 'plain'], ['client_id', 'https://claude.ai/oauth/unregistered']]) {
    const url = authorizeUrl('events:read tasks:read offline_access', hostedId, hostedRedirect); url.searchParams.set(key, value);
    expect((await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { redirect: 'manual' })).status).toBe(400);
  }
  const first = await issue('events:read tasks:read offline_access', hostedId, hostedRedirect);
  const invalid = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, resource: 'https://other.example/mcp' }, hostedId);
  expect(invalid.status).toBe(400);
});
it('accepts the explicit initial hosted read challenge with OIDC and preserves its exact resource scopes', async () => {
  const first = await issue('events:read tasks:read openid offline_access', hostedId, hostedRedirect);
  expect(first.scope).toBe('events:read tasks:read'); expect(first.id_token).toBeTypeOf('string');
});
