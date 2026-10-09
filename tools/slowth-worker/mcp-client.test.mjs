import test from 'node:test';
import assert from 'node:assert/strict';
import { SlowthMcpClient } from './mcp-client.mjs';
test('uses the explicitly configured MCP endpoint and scoped task tool RPC without logging credentials', async () => {
  let seen;
  const client = new SlowthMcpClient({ tokenProvider: async () => 'fixture-private-token', fetchImpl: async (url, request) => {
    seen = { url, request }; const rpc = JSON.parse(request.body);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: rpc.id, result: { structuredContent: { item: null, _version: 'absent' } } }) };
  } });
  const result = await client.callTool('read_task_data', { resource: 'coordination_policy' });
  assert.equal(seen.url, 'https://mcp.invalid/api/mcp');
  assert.equal(seen.request.headers['MCP-Protocol-Version'], '2026-07-28');
  assert.equal(result.structuredContent._version, 'absent');
  await assert.rejects(client.callTool('acknowledge_task_updates', {}), /only supports/);
});
test('authorization failure is explicit and does not include the credential or server body', async () => {
  const client = new SlowthMcpClient({ tokenProvider: async () => 'fixture-private-token', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(client.callTool('read_task_data', {}), error => error.message.includes('MCP_HTTP_401') && !error.message.includes('fixture-private-token'));
});
