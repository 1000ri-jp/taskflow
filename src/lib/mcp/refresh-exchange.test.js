// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { makeProvider, mountedCallback, MUSE_CLIENT } from '../../../scripts/mcp-events/oidc-provider.mjs';
import { firestoreAdapter } from '../../../scripts/mcp-events/oidc-store.mjs';
import { coalesceMuseRefresh } from '../../../scripts/mcp-events/refresh-exchange.mjs';

const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function database() {
  const rows = new Map(); let serial = Promise.resolve();
  const joined = deferred();
  const snap = ref => ({ ref, data: () => {
    const row = rows.get(ref.id);
    if (row && !('uidHash' in row)) joined.resolve();
    return row ? { ...row, expiresAt: { toMillis: () => row.expiresAt.getTime() } } : undefined;
  } });
  const collection = {
    doc: id => ({ id, get: async function () { return snap(this); }, delete: async () => rows.delete(id) }),
    where: (field, _op, value) => ({ limit: limit => ({ get: async () => {
      const docs = [...rows].filter(([, row]) => row[field] === value).slice(0, limit).map(([id]) => snap(collection.doc(id)));
      return { docs, empty: !docs.length };
    } }) }),
  };
  const db = {
    rows, joined, collection: () => collection,
    runTransaction: work => {
      const current = serial.then(() => work({ get: async ref => snap(ref),
        set: (ref, row) => rows.set(ref.id, row), update: (ref, value) => rows.set(ref.id, { ...rows.get(ref.id), ...value }) }));
      serial = current.catch(() => {}); return current;
    },
    batch: () => { const ids = []; return { delete: ref => ids.push(ref.id), commit: async () => ids.forEach(id => rows.delete(id)) }; },
  };
  return db;
}

async function fixture() {
  const db = database(), key = randomBytes(32), { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const origin = 'https://slowth.example.test', resource = origin + '/api/mcp';
  const entered = deferred(), release = deferred(); let block = false, accountChecks = 0;
  const config = { issuer: origin + '/api/oidc', resource, clientId: 'https://chatgpt.com/oauth/client.json',
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect', productionEnabled: true, taskAccessEnabled: true, museEnabled: true,
    jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' }] },
    cookieKeys: [randomBytes(32).toString('hex')],
    findAccount: async () => { accountChecks++; if (block) { entered.resolve(); await release.promise; }
      return { accountId: 'fixture-user', claims: async () => ({ sub: 'fixture-user' }) }; },
  };
  // Separate adapters/providers exercise coordination across Cloud Run instances.
  const providers = [0, 1].map(() => makeProvider({ ...config, adapter: firestoreAdapter(db, key) }));
  const client = await providers[0].Client.find(MUSE_CLIENT.client_id);
  const grant = new providers[0].Grant({ accountId: 'fixture-user', clientId: client.clientId });
  grant.addOIDCScope('events:read tasks:read offline_access'); grant.addResourceScope(resource, 'events:read tasks:read');
  const grantId = await grant.save();
  const original = await new providers[0].RefreshToken({ client, accountId: 'fixture-user', grantId, resource,
    scope: 'events:read tasks:read offline_access', gty: 'authorization_code', expiresWithSession: false }).save();
  const callbacks = providers.map(provider => mountedCallback(provider, '/api/oidc')); let requests = 0;
  const server = createServer((req, res) => {
    req.headers.host = new URL(origin).host; req.headers['x-forwarded-host'] = new URL(origin).host; req.headers['x-forwarded-proto'] = 'https';
    return callbacks[requests++ % 2](req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  async function exchange(value, extra = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/oidc/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: client.clientId, resource, grant_type: 'refresh_token', refresh_token: value, ...extra }),
    });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
  }
  return { db, original, providers, exchange, entered, release, block: () => { block = true; }, checks: () => accountChecks };
}

it('shares a concurrent Muse refresh across instances, keeps rotation, and never stores plaintext tokens', async () => {
  const f = await fixture(); f.block();
  const first = f.exchange(f.original); await f.entered.promise;
  const second = f.exchange(f.original); await f.db.joined.promise; f.release.resolve();
  const [a, b] = await Promise.all([first, second]);
  expect(a.status).toBe(200); expect(b).toEqual(a); expect(a.cacheControl).toBe('no-store'); expect(f.checks()).toBe(1);
  expect(a.body.refresh_token).not.toBe(f.original); expect(a.body.expires_in).toBe(3600);
  expect(await f.providers[1].AccessToken.find(a.body.access_token)).toBeDefined();
  const stored = JSON.stringify([...f.db.rows]);
  for (const token of [f.original, a.body.access_token, a.body.refresh_token]) expect(stored).not.toContain(token);
  expect((await f.exchange(a.body.refresh_token)).status).toBe(200);
});

it('still revokes the whole grant when an old token is reused after the exchange has finished', async () => {
  const f = await fixture(), first = await f.exchange(f.original);
  expect(first.status).toBe(200);
  const replay = await f.exchange(f.original);
  expect(replay.status).toBe(400); expect(replay.body.error).toBe('invalid_grant');
  expect(await f.providers[0].AccessToken.find(first.body.access_token)).toBeUndefined();
  expect((await f.exchange(first.body.refresh_token)).status).toBe(400);
});

it('keeps the required resource check instead of sharing a response with a different target', async () => {
  const f = await fixture();
  const invalid = await f.exchange(f.original, { resource: 'https://other.example/mcp' });
  expect(invalid.status).toBe(400); expect(invalid.body.error).toBe('invalid_target');
});

it.each(['authorization', 'dpop', 'cookie'])('does not coalesce a request carrying %s', async header => {
  let nextCalls = 0, coalesced = false;
  const middleware = coalesceMuseRefresh({ clientId: 'slowth-muse', resource: 'https://slowth.example.test/api/mcp',
    coalesce: () => { coalesced = true; } });
  await middleware({ path: '/token', method: 'POST', is: () => true, get: name => name === header ? 'fixture' : '',
    charset: 'utf-8' }, async () => { nextCalls++; });
  expect(nextCalls).toBe(1); expect(coalesced).toBe(false);
});

it('returns an OAuth error rather than 500 when another transaction has consumed an artifact', async () => {
  const adapter = new (firestoreAdapter(database(), randomBytes(32)))('RefreshToken');
  await adapter.upsert('fixture', { grantId: 'fictional-grant' }, 60);
  await adapter.consume('fixture');
  await expect(adapter.consume('fixture')).rejects.toMatchObject({ statusCode: 400, error: 'invalid_grant' });
});

it('fails closed without consuming a refresh token when coordination storage is unavailable', async () => {
  let exchanged = false;
  const resource = 'https://slowth.example.test/api/mcp';
  const middleware = coalesceMuseRefresh({ clientId: 'slowth-muse', resource,
    findRefresh: async () => ({ clientId: 'slowth-muse' }), coalesce: async () => { throw new Error('private storage failure'); } });
  const ctx = { path: '/token', method: 'POST', is: () => true, get: () => '', request: {}, set: () => {},
    req: Readable.from([Buffer.from(new URLSearchParams({ client_id: 'slowth-muse', resource,
      grant_type: 'refresh_token', refresh_token: 'fixture-token' }).toString())]) };
  await middleware(ctx, async () => { exchanged = true; });
  expect(exchanged).toBe(false); expect(ctx.status).toBe(503);
  expect(ctx.body).toEqual({ error: 'temporarily_unavailable' });
});

it('does not create coordination records for an unknown refresh token', async () => {
  const f = await fixture(), count = f.db.rows.size;
  expect((await f.exchange('not-a-real-token')).status).toBe(400);
  expect(f.db.rows.size).toBe(count);
});
