// MCP 2026 per-request contracts and stateless legacy Streamable HTTP support.
export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];
export const SERVER_INFO = { name: 'Slowth Tasks MCP', version: '0.2.0' };
const PREFIX = 'io.modelcontextprotocol/';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class ProtocolError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data; }
}
const invalidParams = () => { throw new ProtocolError(-32602, 'Invalid params'); };
const headerMismatch = () => { throw new ProtocolError(-32020, 'Header mismatch'); };
function unsupported(requested) {
  throw new ProtocolError(-32022, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested });
}
function decodeName(value) {
  if (value === null || !/^[\x20-\x7e\t]*$/.test(value)) headerMismatch();
  if (value.startsWith('=?base64?') && value.endsWith('?=')) {
    const encoded = value.slice(9, -2), bytes = Buffer.from(encoded, 'base64');
    if (!encoded || bytes.toString('base64') !== encoded) headerMismatch();
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { headerMismatch(); }
  }
  return value;
}

export function requestProtocol(message, headers) {
  const headerVersion = headers.get('MCP-Protocol-Version');
  const meta = message.params?._meta;
  const hasProtocolMeta = object(meta) && ['protocolVersion', 'clientCapabilities', 'clientInfo']
    .some(key => Object.hasOwn(meta, PREFIX + key));
  // Legacy 2025-03-26 omits headers. Existing OpenAI Events examples also omit
  // metadata: retain that extension without claiming those requests are 2026.
  if (!hasProtocolMeta && (headerVersion === null || LEGACY_VERSIONS.includes(headerVersion))) {
    return { version: headerVersion ?? '2025-03-26', modern: false };
  }
  // Accept the metadata-free JSON-RPC used by the documented OpenAI Events
  // flow. Validate routing headers when supplied.
  if (!hasProtocolMeta && headerVersion === MODERN_VERSION) {
    const method = headers.get('Mcp-Method');
    if (method !== null && method !== message.method) headerMismatch();
    const name = headers.get('Mcp-Name');
    if (name !== null && ['tools/call', 'prompts/get', 'resources/read'].includes(message.method)) {
      if (decodeName(name) !== (message.method === 'resources/read' ? message.params?.uri : message.params?.name)) headerMismatch();
    }
    return { version: MODERN_VERSION, modern: true };
  }
  if (!hasProtocolMeta && headerVersion !== MODERN_VERSION) unsupported(headerVersion);
  if (!object(meta) || typeof meta[PREFIX + 'protocolVersion'] !== 'string' ||
      !object(meta[PREFIX + 'clientCapabilities'])) invalidParams();
  if (Object.hasOwn(meta, PREFIX + 'clientInfo')) {
    const info = meta[PREFIX + 'clientInfo'];
    if (!object(info) || typeof info.name !== 'string' || typeof info.version !== 'string') invalidParams();
  }
  const version = meta[PREFIX + 'protocolVersion'];
  if (headerVersion !== version || headers.get('Mcp-Method') !== message.method) headerMismatch();
  if (!SUPPORTED_VERSIONS.includes(version)) unsupported(version);
  if (['tools/call', 'prompts/get', 'resources/read'].includes(message.method)) {
    const name = message.method === 'resources/read' ? message.params?.uri : message.params?.name;
    if (typeof name !== 'string') invalidParams();
    if (decodeName(headers.get('Mcp-Name')) !== name) headerMismatch();
  }
  return { version, modern: version === MODERN_VERSION };
}

export function initializeResult(params) {
  if (!object(params) || typeof params.protocolVersion !== 'string' || !object(params.capabilities) ||
      !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' ||
      typeof params.clientInfo.version !== 'string') invalidParams();
  // The old handshake cannot negotiate the modern per-request era.
  return {
    protocolVersion: LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0],
    capabilities: { tools: {} }, serverInfo: { ...SERVER_INFO },
  };
}

export function completeResult(value) {
  return { ...value, resultType: 'complete', _meta: { ...value._meta, [PREFIX + 'serverInfo']: { ...SERVER_INFO } } };
}
export function discoverResult(capabilities) {
  return completeResult({ supportedVersions: [...SUPPORTED_VERSIONS], capabilities, ttlMs: 0, cacheScope: 'private' });
}
