// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import { memoryFirestore } from '../../../lib/mcp/firestore.fixture.mjs';

const fake = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), post: vi.fn(), safePost: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/mcp/oidc', () => ({ authenticateMcp: fake.auth, oidcConfig: () => ({ origin: 'https://slowth.example.test' }) }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: fake.access }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: fake.db }));
vi.mock('../../../../scripts/mcp-events/transport.mjs', () => ({ createSafePost: fake.safePost }));
let documents;
const subscription = {
  name: 'task.updated', arguments: { project_id: 'fictional-project' },
  delivery: { mode: 'webhook', url: 'https://receiver.example.test/callback',
    secret: 'whsec_' + Buffer.alloc(32, 7).toString('base64') },
};
const send = (message, headers = {}) => POST(new Request('http://localhost/api/mcp', {
  method: 'POST', headers, body: JSON.stringify(message),
}));
const call = (method, params, headers) => send({ jsonrpc: '2.0', id: 1, method, params }, headers);
const modernCall = (method, params = {}, overrides = {}) => call(method, {
  ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} },
}, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(params.name ? { 'Mcp-Name': params.name } : {}), ...overrides });
const subscriptionCount = () => [...documents.keys()].filter(key => key.includes('/subscriptions/')).length;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SLOWTH_MCP_EVENTS_ENABLED', 'true');
  vi.stubEnv('SLOWTH_MCP_EVENTS_SYNTHETIC_TEST', 'true');
  vi.stubEnv('SLOWTH_MCP_CALLBACK_HOSTS', 'receiver.example.test');
  vi.stubEnv('SLOWTH_MCP_CALLBACK_HOST_DIAGNOSTICS', undefined);
  documents = new Map();
  function collection(path) {
    return {
      doc: id => ({
        collection: name => collection(`${path}/${id}/${name}`),
        get: async () => ({ data: () => documents.get(`${path}/${id}`) }),
        set: async value => { documents.set(`${path}/${id}`, value); },
        delete: async () => { documents.delete(`${path}/${id}`); },
      }),
      get: async () => ({ docs: [...documents].filter(([key]) => key.startsWith(path + '/')).map(([, value]) => ({ data: () => value })) }),
    };
  }
  fake.db.mockReturnValue({ collection });
  fake.auth.mockResolvedValue({ userId: 'fictional-user', grantId: 'fictional-grant', expiresAt: Date.now() + 900000, permissions: ['tasks:read'], projectIds: ['fictional-project'] });
  fake.access.mockResolvedValue({ role: 'viewer' });
  fake.safePost.mockImplementation(() => fake.post);
  fake.post.mockImplementation(async (_url, options) => {
    const payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ challenge: payload.challenge }));
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('is disabled by default and does not touch auth or storage', async () => {
  vi.stubEnv('SLOWTH_MCP_EVENTS_ENABLED', '');
  expect((await call('server/discover')).status).toBe(404);
  expect(fake.auth).not.toHaveBeenCalled(); expect(fake.db).not.toHaveBeenCalled();
});
it('auth failure and project denial cannot create subscriptions or send callbacks', async () => {
  fake.auth.mockRejectedValueOnce(new Error('not logged in'));
  expect((await call('events/list')).status).toBe(401);
  fake.access.mockRejectedValue(new Error('FORBIDDEN'));
  const denied = await (await call('events/subscribe', subscription)).json();
  expect(denied.error.code).toBe(-32001);
  expect(documents.size).toBe(0); expect(fake.post).not.toHaveBeenCalled();
});
it.each([undefined, NaN, Infinity, 0])('rejects missing, nonfinite or expired authorization deadline %s', async expiresAt => {
  fake.auth.mockResolvedValue({ ...(await fake.auth()), expiresAt });
  const response = await call('events/subscribe', subscription);
  expect(response.status).toBe(401);
  expect(response.headers.get('WWW-Authenticate')).toContain('scope="events:test"');
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});
it('passes the absolute auth deadline to delayed subscription and refresh requests', async () => {
  vi.useFakeTimers();
  const start = Date.now(), expiresAt = (await fake.auth()).expiresAt;
  vi.setSystemTime(start + 300000);
  const first = (await (await call('events/subscribe', subscription)).json()).result;
  expect(Date.parse(first.refreshBefore)).toBe(expiresAt);
  expect([...documents.values()][0].mcpExpiresAt).toBeInstanceOf(Date);
  expect([...documents.values()][0].mcpExpiresAt.getTime()).toBe(expiresAt);
  vi.setSystemTime(start + 600000);
  const refreshed = (await (await call('events/subscribe', subscription)).json()).result;
  expect(refreshed.id).toBe(first.id); expect(Date.parse(refreshed.refreshBefore)).toBe(expiresAt);
  expect([...documents.values()][0].expiresAt).toBe(expiresAt);
  expect([...documents.values()][0].mcpExpiresAt.getTime()).toBe(expiresAt);
  vi.setSystemTime(expiresAt);
  expect((await call('events/subscribe', subscription)).status).toBe(401);
});
it('stores matching numeric and Date deadlines for short-lived creation and refresh', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const first = (await (await call('events/subscribe', { ...subscription, ttlMs: 30000 })).json()).result;
  let saved = [...documents.values()][0];
  expect(typeof saved.expiresAt).toBe('number'); expect(saved.expiresAt).toBe(start + 30000);
  expect(saved.mcpExpiresAt).toBeInstanceOf(Date);
  expect(saved.mcpExpiresAt.getTime()).toBe(Date.parse(first.refreshBefore));
  vi.setSystemTime(start + 10000);
  const refreshed = (await (await call('events/subscribe', { ...subscription, ttlMs: 30000 })).json()).result;
  saved = [...documents.values()][0];
  expect(refreshed.id).toBe(first.id); expect(documents.size).toBe(1);
  expect(saved.expiresAt).toBe(start + 40000);
  expect(saved.mcpExpiresAt).toBeInstanceOf(Date);
  expect(saved.mcpExpiresAt.getTime()).toBe(saved.expiresAt);
  expect(saved.mcpExpiresAt.toISOString()).toBe(refreshed.refreshBefore);
  await call('events/unsubscribe', subscription); expect(documents.size).toBe(0);
});
it('keeps delivery and unsubscribe working for legacy subscriptions without a cleanup timestamp', async () => {
  await call('events/subscribe', subscription);
  const [key, stored] = [...documents.entries()][0];
  const legacy = { ...stored }; delete legacy.mcpExpiresAt;
  documents.set(key, legacy);
  const response = await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json();
  expect(JSON.parse(response.result.content[0].text).deliveries).toHaveLength(1);
  expect(documents.get(key).mcpExpiresAt).toBeUndefined();
  expect((await (await call('events/unsubscribe', subscription)).json()).result).toEqual({});
  expect(subscriptionCount()).toBe(0);
});
it('keeps numeric legacy expiration authoritative and adds a cleanup timestamp on refresh', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const first = (await (await call('events/subscribe', { ...subscription, ttlMs: 30000 })).json()).result;
  const [key, stored] = [...documents.entries()][0];
  const legacy = { ...stored }; delete legacy.mcpExpiresAt;
  documents.set(key, legacy);
  vi.setSystemTime(start + 30000);
  const response = await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json();
  expect(JSON.parse(response.result.content[0].text).deliveries).toEqual([]);
  const refreshed = (await (await call('events/subscribe', { ...subscription, ttlMs: 30000 })).json()).result;
  expect(refreshed.id).toBe(first.id);
  const saved = documents.get(key);
  expect(saved.expiresAt).toBe(start + 60000);
  expect(saved.mcpExpiresAt).toBeInstanceOf(Date);
  expect(saved.mcpExpiresAt.getTime()).toBe(saved.expiresAt);
});
it.each([undefined, 'false', 'TRUE', '1'])('leaves callback-host diagnostics disabled for flag %s', async flag => {
  vi.stubEnv('SLOWTH_MCP_CALLBACK_HOST_DIAGNOSTICS', flag);
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  await call('events/list');
  expect(fake.safePost).toHaveBeenCalledWith(['receiver.example.test'], { onRejectedHost: undefined });
  expect(info).not.toHaveBeenCalled();
});
it('opts in to logging only the hostname supplied by the safe transport rejection hook', async () => {
  vi.stubEnv('SLOWTH_MCP_CALLBACK_HOST_DIAGNOSTICS', 'true');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  await call('events/list');
  const [hosts, options] = fake.safePost.mock.calls[0];
  expect(hosts).toEqual(['receiver.example.test']);
  expect(options.onRejectedHost).toBeTypeOf('function');
  expect(info).not.toHaveBeenCalled();
  options.onRejectedHost('callback.example.test');
  expect(info.mock.calls).toEqual([['Slowth MCP callback host rejected by allowlist:', 'callback.example.test']]);
});
it('does not verify callbacks when authorization expires during the project check', async () => {
  vi.useFakeTimers();
  const expiresAt = (await fake.auth()).expiresAt;
  fake.access.mockImplementationOnce(async () => { vi.setSystemTime(expiresAt); return { role: 'viewer' }; });
  expect((await (await call('events/subscribe', subscription)).json()).error.code).toBe(-32001);
  expect(documents.size).toBe(0); expect(fake.post).not.toHaveBeenCalled();
});
it('does not send a synthetic event after authorization expires during its project check', async () => {
  vi.useFakeTimers();
  await call('events/subscribe', subscription);
  const expiresAt = (await fake.auth()).expiresAt;
  fake.access.mockImplementationOnce(async () => { vi.setSystemTime(expiresAt); return { role: 'viewer' }; });
  const response = await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json();
  expect(JSON.parse(response.result.content[0].text).deliveries).toEqual([]);
  expect(fake.post).toHaveBeenCalledTimes(1);
});
it('supports authenticated discovery, subscription, synthetic delivery, refresh and unsubscribe', async () => {
  expect((await (await call('server/discover')).json()).result.supportedVersions).toEqual(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
  expect((await (await call('tools/list')).json()).result.tools).toHaveLength(2);
  expect((await (await call('events/list')).json()).result.events[0].name).toBe('task.updated');
  const sub = (await (await call('events/subscribe', subscription)).json()).result;
  expect(sub.id).toMatch(/^sub_/); expect(documents.size).toBe(1);
  await call('events/subscribe', subscription);
  expect(fake.post).toHaveBeenCalledTimes(1);
  const sent = (await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json()).result;
  expect(JSON.parse(sent.content[0].text).deliveries[0].status).toBe(200);
  const payload = JSON.parse(fake.post.mock.calls.at(-1)[1].body);
  expect(payload.data.synthetic).toBe(true); expect(payload.data.task_id).toBe('fictional-task');
  // Writes stay in subscription and synthetic-event storage, never real tasks.
  expect([...documents.keys()].every(k => k.startsWith('mcpEventPrincipals/'))).toBe(true);
  await call('events/unsubscribe', subscription); expect(subscriptionCount()).toBe(0);
});
it('isolates subscriptions by OAuth grant and gates the synthetic sending tool separately', async () => {
  await call('events/subscribe', subscription);
  fake.auth.mockResolvedValue({ userId: 'fictional-user', grantId: 'another-grant', expiresAt: Date.now() + 900000, permissions: ['tasks:read'], projectIds: ['fictional-project'] });
  await call('events/unsubscribe', subscription);
  expect(documents.size).toBe(1);
  const response = await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json();
  expect(JSON.parse(response.result.content[0].text).deliveries).toEqual([]);
  vi.stubEnv('SLOWTH_MCP_EVENTS_SYNTHETIC_TEST', 'false');
  expect((await (await call('tools/list')).json()).result.tools).toEqual([]);
  expect((await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json()).error.code).toBe(-32602);
});
it('rejects malformed and oversized messages', async () => {
  expect((await POST(new Request('http://localhost/api/mcp', { method: 'POST', body: '{' }))).status).toBe(400);
  expect((await POST(new Request('http://localhost/api/mcp', { method: 'POST', body: 'x'.repeat(65537) }))).status).toBe(413);
});

it('returns complete private modern discovery and tool-list contracts without DB or transport setup', async () => {
  const discovery = await modernCall('server/discover');
  expect(discovery.status).toBe(200);
  expect(discovery.headers.get('Cache-Control')).toBe('no-store');
  expect((await discovery.json()).result).toEqual({
    resultType: 'complete', ttlMs: 0, cacheScope: 'private',
    supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
    capabilities: { events: {}, tools: {} },
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Slowth Tasks MCP', version: '0.2.0' } },
  });
  const listed = (await (await modernCall('tools/list')).json()).result;
  expect(listed).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'private',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Slowth Tasks MCP', version: '0.2.0' } } });
  expect(listed.tools).toHaveLength(2);
  expect(listed.tools[0]).toMatchObject({ name: 'get_latest_task_update', annotations: { readOnlyHint: true } });
  expect(listed.tools[1]).toMatchObject({ name: 'send_synthetic_task_update',
    securitySchemes: [{ type: 'oauth2', scopes: ['events:test'] }],
    inputSchema: { type: 'object', required: ['project_id'], additionalProperties: false } });
  expect((await (await modernCall('ping')).json()).result).toEqual({ resultType: 'complete',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Slowth Tasks MCP', version: '0.2.0' } } });
  vi.stubEnv('SLOWTH_MCP_EVENTS_SYNTHETIC_TEST', 'false');
  expect((await (await modernCall('tools/list')).json()).result.tools).toEqual([]);
  expect(fake.auth).toHaveBeenCalledTimes(4);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.safePost).not.toHaveBeenCalled();
  expect(fake.post).not.toHaveBeenCalled(); expect(fake.access).not.toHaveBeenCalled();
});

it('returns modern complete results for tool calls and every Events operation using fixture callbacks', async () => {
  const listed = (await (await modernCall('events/list')).json()).result;
  expect(listed.resultType).toBe('complete'); expect(listed.events[0].name).toBe('task.updated');
  const subscribed = (await (await modernCall('events/subscribe', subscription)).json()).result;
  expect(subscribed.resultType).toBe('complete'); expect(subscribed.id).toMatch(/^sub_/);
  const sent = (await (await modernCall('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json()).result;
  expect(sent).toMatchObject({ resultType: 'complete',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Slowth Tasks MCP', version: '0.2.0' } } });
  expect(sent.content[0].type).toBe('text');
  expect(JSON.parse(sent.content[0].text).deliveries).toHaveLength(1);
  expect(fake.post).toHaveBeenCalledTimes(2);
  expect((await (await modernCall('events/unsubscribe', subscription)).json()).result).toEqual({
    resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Slowth Tasks MCP', version: '0.2.0' } },
  });
  expect(subscriptionCount()).toBe(0);
});

it.each(['2025-03-26', '2025-06-18', '2025-11-25'])('supports the %s initialization and plain tools contracts', async protocolVersion => {
  const initialized = await call('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'Fixture Client', version: '1.0' } });
  expect(initialized.status).toBe(200);
  expect((await initialized.json()).result).toEqual({ protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'Slowth Tasks MCP', version: '0.2.0' } });
  const headers = { 'MCP-Protocol-Version': protocolVersion };
  const notification = await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
  expect(notification.status).toBe(202); expect(await notification.text()).toBe('');
  expect(notification.headers.get('Content-Type')).toBeNull();
  expect((await (await call('ping', {}, headers)).json()).result).toEqual({});
  const listed = (await (await call('tools/list', undefined, headers)).json()).result;
  expect(Object.keys(listed)).toEqual(['tools']); expect(listed.tools).toHaveLength(2);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.safePost).not.toHaveBeenCalled();
  const sent = (await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } }, headers)).json()).result;
  expect(Object.keys(sent)).toEqual(['content']);
  expect(JSON.parse(sent.content[0].text).deliveries).toEqual([]);
  expect(fake.post).not.toHaveBeenCalled(); expect(subscriptionCount()).toBe(0);
});

it('negotiates the newest supported legacy version for an unknown initialize revision', async () => {
  const response = await call('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'Fixture', version: '1' } });
  expect((await response.json()).result.protocolVersion).toBe('2025-11-25');
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each([{}, { protocolVersion: '2025-11-25' }, { protocolVersion: '2025-11-25', capabilities: [], clientInfo: { name: 'Fixture', version: '1' } }])('rejects malformed legacy initialize params', async params => {
  const response = await call('initialize', params);
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32602);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each(['initialize', 'server/discover', 'tools/list', 'notifications/initialized'])('authenticates %s before metadata handling and any storage or callback', async method => {
  fake.auth.mockRejectedValueOnce(new Error('fixture unauthenticated'));
  const response = await send({ jsonrpc: '2.0', ...(method !== 'notifications/initialized' ? { id: 1 } : {}), method });
  expect(response.status).toBe(401);
  expect(response.headers.get('WWW-Authenticate')).toContain('scope="events:test"');
  expect(fake.auth).toHaveBeenCalledTimes(1);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.safePost).not.toHaveBeenCalled();
  expect(fake.post).not.toHaveBeenCalled(); expect(documents.size).toBe(0);
});

it.each(['initialize', 'server/discover', 'tools/list', 'notifications/initialized'])('rejects expired authorization for %s without side effects', async method => {
  fake.auth.mockResolvedValue({ ...(await fake.auth()), expiresAt: Date.now() - 1 });
  const response = await send({ jsonrpc: '2.0', ...(method !== 'notifications/initialized' ? { id: 1 } : {}), method });
  expect(response.status).toBe(401);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('preserves metadata-less tools and Events requests as a legacy compatibility extension', async () => {
  expect(Object.keys((await (await call('tools/list')).json()).result)).toEqual(['tools']);
  expect(Object.keys((await (await call('events/list')).json()).result)).toEqual(['events']);
  expect((await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  expect(documents.size).toBe(0); expect(fake.post).not.toHaveBeenCalled();
});

it.each([
  { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }, code: -32602 },
  { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': [] } }, code: -32602 },
])('rejects incomplete modern request metadata before DB or callbacks: $code', async ({ params, code }) => {
  const response = await call('tools/list', params, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(code);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each([null, 'fixture', {}, { name: 7, version: false }, { name: 'Fixture' }])('rejects malformed optional modern clientInfo %j', async clientInfo => {
  const response = await call('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': clientInfo } },
  { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32602);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each([null, '', 'unknown', 1])('rejects unsupported or malformed tools/list cursor %j', async cursor => {
  const response = await modernCall('tools/list', { cursor });
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32602);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each([
  { 'MCP-Protocol-Version': '' }, { 'MCP-Protocol-Version': '2025-11-25' },
  { 'Mcp-Method': '' }, { 'Mcp-Method': 'tools/call' }, { 'Mcp-Method': 'TOOLS/LIST' },
])('rejects missing or mismatched modern headers before DB or callbacks: %j', async headers => {
  const response = await modernCall('tools/list', {}, headers);
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32020);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.safePost).not.toHaveBeenCalled();
  expect(fake.post).not.toHaveBeenCalled();
});

it.each(['', 'another_tool', '=?base64?%%%?='])('rejects missing, mismatched or malformed Mcp-Name %s before callbacks', async name => {
  const response = await modernCall('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } }, { 'Mcp-Name': name });
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32020);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('decodes a valid base64 Mcp-Name before comparison', async () => {
  const name = 'send_synthetic_task_update';
  const response = await modernCall('tools/call', { name, arguments: { project_id: 'fictional-project' } },
    { 'Mcp-Name': '=?base64?' + Buffer.from(name).toString('base64') + '?=' });
  expect(response.status).toBe(200); expect((await response.json()).result.resultType).toBe('complete');
  expect(fake.post).not.toHaveBeenCalled();
});

it('returns the supported versions for unsupported explicit protocol versions', async () => {
  const response = await call('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } },
    { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({ code: -32022, message: 'Unsupported protocol version',
    data: { supported: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'], requested: '2099-01-01' } });
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('returns modern unknown-method HTTP404 and does not initialize the modern per-request era', async () => {
  for (const method of ['fixture/unknown', 'initialize']) {
    const response = await modernCall(method);
    expect(response.status).toBe(404); expect((await response.json()).error.code).toBe(-32601);
  }
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it.each([null, true, 1.5, {}, []])('rejects invalid request ID %j rather than treating it as a notification', async id => {
  const response = await send({ jsonrpc: '2.0', id, method: 'notifications/initialized' });
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe(-32600);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('rejects initialized as a request and unknown notifications without effects', async () => {
  expect((await (await call('notifications/initialized')).json()).error.code).toBe(-32601);
  const response = await send({ jsonrpc: '2.0', method: 'notifications/unknown' });
  expect(response.status).toBe(400); expect((await response.json()).error).toEqual({ code: -32600, message: 'Invalid Request' });
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('omits unreadable IDs in modern parse and envelope errors and preserves valid IDs', async () => {
  const headers = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' };
  const malformed = await POST(new Request('http://localhost/api/mcp', { method: 'POST', headers, body: '{' }));
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
  for (const id of [null, true, 1.5, {}]) {
    const response = await send({ jsonrpc: '2.0', id, method: 'tools/list' }, headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' } });
  }
  const valid = await send({ jsonrpc: '2.0', id: 'fixture-id', method: 7 }, headers);
  expect((await valid.json()).id).toBe('fixture-id');
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('accepts OpenAI-style versioned discovery and reader calls without draft metadata', async () => {
  const headers = { 'MCP-Protocol-Version': '2026-07-28' };
  const discovery = await call('server/discover', {}, headers);
  expect(discovery.status).toBe(200);
  expect((await discovery.json()).result).toMatchObject({ resultType: 'complete', capabilities: { tools: {}, events: {} } });
  expect((await (await call('tools/list', {}, headers)).json()).result.tools.map(tool => tool.name))
    .toEqual(['get_latest_task_update', 'send_synthetic_task_update']);
  const reader = await call('tools/call', { name: 'get_latest_task_update', arguments: {} }, headers);
  expect((await reader.json()).result.structuredContent).toEqual({ project_id: 'fictional-project', event: null });
  expect(documents.size).toBe(0); expect(fake.post).not.toHaveBeenCalled();
});

it.each([{ 'Mcp-Method': 'events/list' }, { 'Mcp-Name': 'other_tool' }])('checks routing headers on OpenAI-style calls: %j', async extra => {
  const reader = await call('tools/call', { name: 'get_latest_task_update' }, { 'MCP-Protocol-Version': '2026-07-28', ...extra });
  expect(reader.status).toBe(400); expect((await reader.json()).error.code).toBe(-32020);
  expect(fake.db).not.toHaveBeenCalled(); expect(fake.post).not.toHaveBeenCalled();
});

it('stores a synthetic event before its webhook and lets the event wake read it', async () => {
  await call('events/subscribe', subscription);
  let received;
  fake.post.mockImplementationOnce(async (_url, options) => {
    const payload = JSON.parse(options.body);
    const result = (await (await modernCall('tools/call', { name: 'get_latest_task_update' })).json()).result;
    received = result.structuredContent;
    expect(received.event).toEqual(payload);
    return new Response('{}');
  });
  const sent = JSON.parse((await (await modernCall('tools/call', {
    name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' },
  })).json()).result.content[0].text);
  expect(received.project_id).toBe('fictional-project');
  expect(received.event.eventId).toBe(sent.eventId);
  expect(received.event.data.synthetic).toBe(true);
  const stored = [...documents.values()].find(value => value.event);
  expect(stored.mcpExpiresAt.getTime()).toBe(stored.expiresAt);
  expect(fake.post).toHaveBeenCalledTimes(2);
});

it('isolates saved events by grant, rechecks membership and hides expired events', async () => {
  await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } });
  const read = () => call('tools/call', { name: 'get_latest_task_update', arguments: { project_id: 'fictional-project' } });
  const original = await fake.auth();
  fake.auth.mockResolvedValue({ ...original, grantId: 'other-grant' });
  expect((await (await read()).json()).result.structuredContent.event).toBeNull();
  fake.auth.mockResolvedValue(original);
  fake.access.mockRejectedValueOnce(new Error('FORBIDDEN'));
  expect((await (await read()).json()).result).toBeUndefined();
  const stored = [...documents.values()].find(value => value.event);
  stored.expiresAt = Date.now() - 1;
  expect((await (await read()).json()).result.structuredContent.event).toBeNull();
  expect(fake.post).not.toHaveBeenCalled();
});

it.each([null, [], 'fictional-project', { project_id: null }, { project_id: 1 }, { unexpected: true }])('rejects invalid reader arguments %j', async args => {
  const response = await call('tools/call', { name: 'get_latest_task_update', arguments: args });
  expect((await response.json()).error.code).toBe(-32602);
  expect(fake.access).not.toHaveBeenCalled(); expect(documents.size).toBe(0);
});

it('does not return saved event data after authorization expires during the reader check', async () => {
  vi.useFakeTimers();
  const expiresAt = (await fake.auth()).expiresAt;
  fake.access.mockImplementationOnce(async () => { vi.setSystemTime(expiresAt); return { role: 'viewer' }; });
  const response = await call('tools/call', { name: 'get_latest_task_update' });
  expect((await response.json()).error.code).toBe(-32001);
  expect(fake.post).not.toHaveBeenCalled(); expect(documents.size).toBe(0);
});

async function productionFixture() {
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true');
  vi.stubEnv('SLOWTH_MCP_OAUTH_STORAGE_KEY', Buffer.alloc(32, 4).toString('base64'));
  fake.auth.mockResolvedValue({ ...(await fake.auth()), mode: 'production', authorizationExpiresAt: Date.now() + 30 * 86400000 });
  const db = memoryFirestore(); fake.db.mockReturnValue(db); return db;
}
it('production catalog hides the synthetic sender and exposes journal/acknowledgement tools', async () => {
  await productionFixture();
  const listed = (await (await call('tools/list')).json()).result.tools;
  expect(listed.map(tool => tool.name)).toEqual(['list_task_updates', 'acknowledge_task_updates']);
  expect((await (await call('tools/call', { name: 'send_synthetic_task_update', arguments: { project_id: 'fictional-project' } })).json()).error.code).toBe(-32602);
  expect(fake.post).not.toHaveBeenCalled();
});
it('production subscription outlives a token but not its finite grant, with encrypted callback keys', async () => {
  const db = await productionFixture();
  const response = (await (await call('events/subscribe', subscription)).json()).result;
  expect(Date.parse(response.refreshBefore)).toBeGreaterThan((await fake.auth()).expiresAt);
  expect(Date.parse(response.refreshBefore)).toBeLessThanOrEqual(Date.now() + 86400000);
  const record = [...db.records.values()][0]; expect(record.secret).toBeUndefined(); expect(record.deliveryKey).toBeTruthy();
  expect(JSON.stringify(record)).not.toContain(subscription.delivery.secret);
});
it('production reader and acknowledgement retain burst events and reject missing IDs', async () => {
  const db = await productionFixture();
  const owner = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(['fictional-user', 'fictional-grant'])).digest('hex');
  const journal = db.collection('mcpEventPrincipals').doc(owner).collection('journal');
  for (let n = 0; n < 3; n++) await journal.doc('task_' + String(n).repeat(64)).set({
    event: { eventId: 'task_' + String(n).repeat(64), name: 'task.updated', data: { project_id: 'fictional-project', synthetic: false } },
    acknowledged: false, occurredAt: n, expiresAt: Date.now() + 86400000, changeType: 'updated', changedFields: ['title'] });
  const page = (await (await call('tools/call', { name: 'list_task_updates', arguments: { limit: 2 } })).json()).result.structuredContent;
  expect(page.events).toHaveLength(2); expect(page.has_more).toBe(true);
  const ids = page.events.map(row => row.event.eventId);
  const ack = (await (await call('tools/call', { name: 'acknowledge_task_updates', arguments: { event_ids: ids } })).json()).result.structuredContent;
  expect(ack.acknowledged).toBe(2);
  const missing = await call('tools/call', { name: 'acknowledge_task_updates', arguments: { event_ids: ['task_' + 'f'.repeat(64)] } });
  expect((await missing.json()).error.message).toBe('Event unavailable');
  expect(fake.post).not.toHaveBeenCalled();
});
it('production cannot activate a subscription when its access token expires during challenge', async () => {
  vi.useFakeTimers(); const db = await productionFixture();
  fake.post.mockImplementationOnce(async (_url, options) => {
    vi.setSystemTime((await fake.auth()).expiresAt);
    return new Response(JSON.stringify({ challenge: JSON.parse(options.body).challenge }));
  });
  expect((await (await call('events/subscribe', subscription)).json()).error.code).toBe(-32001);
  expect(db.records.size).toBe(0);
});
it.each([null, [], { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { unknown: true }])('rejects invalid production list arguments %j', async args => {
  await productionFixture();
  expect((await (await call('tools/call', { name: 'list_task_updates', arguments: args })).json()).error.code).toBe(-32602);
});

it('discovers the full task tools under an old grant and prompts explicit step-up without reading tasks', async () => {
  await productionFixture(); vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'true');
  const listed = (await (await call('tools/list')).json()).result.tools;
  expect(listed.map(t => t.name)).toEqual(['list_task_updates', 'acknowledge_task_updates', 'get_task_contract', 'read_task_data', 'write_task_data']);
  fake.db.mockClear();
  const stepUp = (await (await call('tools/call', { name: 'write_task_data', arguments: { operations: [] } })).json()).result;
  expect(stepUp).toMatchObject({ isError: true, structuredContent: { code: 'INSUFFICIENT_SCOPE' } });
  expect(stepUp._meta['mcp/www_authenticate'][0]).toContain('tasks:read tasks:write');
  expect(stepUp._meta['mcp/www_authenticate'][0]).toContain('error_description=');
  expect(fake.db).not.toHaveBeenCalled();
  fake.auth.mockResolvedValue({ ...(await fake.auth()), taskScopes: ['tasks:read'] });
  const contract = (await (await call('tools/call', { name: 'get_task_contract', arguments: {} })).json()).result;
  expect(contract.isError).toBe(false); expect(Object.keys(contract.structuredContent.task_fields)).toHaveLength(47);
  const readOnly = (await (await call('tools/call', { name: 'write_task_data', arguments: {} })).json()).result;
  expect(readOnly.structuredContent.code).toBe('INSUFFICIENT_SCOPE');
});
