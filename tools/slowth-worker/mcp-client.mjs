import fs from 'node:fs/promises';
import { readWorkerConfig, validateMcpEndpoint } from './config.mjs';

/** Standard public Slowth MCP transport. Caller supplies its currently authorized OAuth token. */
export class SlowthMcpClient {
  constructor({ tokenProvider, endpoint = readWorkerConfig().mcpEndpoint, fetchImpl = fetch, timeoutMs = 60000 }) {
    if (typeof tokenProvider !== 'function') throw new Error('A current authorized OAuth token provider is required.');
    this.endpoint = validateMcpEndpoint(endpoint);
    this.tokenProvider = tokenProvider; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.nextId = 0;
  }
  async callTool(name, args) {
    if (!['get_task_contract', 'read_task_data', 'write_task_data'].includes(name)) throw new Error('This worker transport only supports task contract/read/write tools.');
    const token = await this.tokenProvider();
    if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) throw new Error('MCP access token is missing or malformed.');
    const id = ++this.nextId;
    const response = await this.fetch(this.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`MCP_HTTP_${response.status}: authorized task connection must be checked; response body and credentials are not printed.`);
    const rpc = await response.json();
    if (rpc.id !== id) throw new Error('MCP response identity mismatch.');
    if (rpc.error) throw new Error(`MCP_RPC_${rpc.error.code}: ${rpc.error.message}`);
    return rpc.result;
  }
  static fromTokenFile(file, options = {}) {
    if (!file) throw new Error('Set SLOWTH_MCP_TOKEN_FILE to a private current OAuth access-token file; do not put tokens in job JSON.');
    return new SlowthMcpClient({ ...options, tokenProvider: async () => (await fs.readFile(file, 'utf8')).trim() });
  }
}
