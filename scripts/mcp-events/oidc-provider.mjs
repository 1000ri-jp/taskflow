import Provider, { errors } from 'oidc-provider';
import { authorizationMode, CONSENT_MS, READ_SCOPE, TEST_SCOPE, TASK_READ_SCOPE, TASK_WRITE_SCOPE } from './policy.mjs';

export { TEST_SCOPE };

// oidc-provider advertises openid, which ChatGPT requests with the test scope.
// This identity scope never expands the MCP resource's events:test permission.
export function isTestAuthorizationScope(scope) {
  if (typeof scope !== 'string') return false;
  const scopes = scope.split(' ');
  return scopes.includes(TEST_SCOPE) && new Set(scopes).size === scopes.length &&
    scopes.every(value => value === TEST_SCOPE || value === 'openid');
}

// Claude Code publishes this metadata at its client_id, but without application_type.
// Pinning it as a native client keeps the published callbacks and applies RFC 8252's
// any-port rule to its loopback listener.
export const CLAUDE_CODE_CLIENT = Object.freeze({
  client_id: 'https://claude.ai/oauth/claude-code-client-metadata', client_name: 'Claude Code',
  application_type: 'native', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
});
// Hosted connectors (Desktop/web/mobile) use a separate public client and exact HTTPS callback.
export const CLAUDE_CLIENT = Object.freeze({
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_name: 'Claude',
  application_type: 'web', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
});
// Manually registered public client; Muse's supplied callback must match exactly.
export const MUSE_CLIENT = Object.freeze({
  client_id: 'slowth-muse', client_name: 'Muse',
  application_type: 'web', redirect_uris: ['https://agent.meta.ai/api/hatch/oauth/callback'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
});
export function isClaudeCodeCallback(uri) {
  const match = typeof uri === 'string' && /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})\/callback$/.exec(uri);
  return Boolean(match && Number(match[1]) <= 65535);
}

// Claude Code requests every advertised scope. events:test is the separate synthetic
// mode, so production connections drop it instead of being sent back to consent.
export function claudeScope(scope) {
  if (typeof scope !== 'string') return scope;
  const scopes = scope.split(' ');
  return new Set(scopes).size === scopes.length ? scopes.filter(s => s !== TEST_SCOPE).join(' ') : scope;
}

// Protocol validation/code issuance/PKCE/replay protection are owned by oidc-provider.
export function makeProvider({ issuer, resource, clientId, redirectUri, jwks, cookieKeys,
  adapter, findAccount, clients = [], productionEnabled = false, taskAccessEnabled = false, claudeCodeEnabled = false, claudeEnabled = false, museEnabled = false }) {
  if (!jwks?.keys?.length || !cookieKeys?.length) throw new Error('Explicit OAuth keys required');
  const claudeCode = productionEnabled && claudeCodeEnabled;
  const claude = productionEnabled && claudeEnabled;
  const muse = productionEnabled && museEnabled;
  const pinnedClients = [...(claudeCode ? [{ ...CLAUDE_CODE_CLIENT }] : []), ...(claude ? [{ ...CLAUDE_CLIENT }] : []), ...(muse ? [{ ...MUSE_CLIENT }] : [])];
  const clientIds = new Set([clientId, ...pinnedClients.map(client => client.client_id)]);
  const provider = new Provider(issuer, {
    adapter, jwks, findAccount, clients: [...clients, ...pinnedClients],
    cookies: { keys: cookieKeys, short: { signed: true }, long: { signed: true } },
    scopes: productionEnabled ? [TEST_SCOPE, READ_SCOPE, 'offline_access', ...(taskAccessEnabled ? [TASK_READ_SCOPE, TASK_WRITE_SCOPE] : [])] : [TEST_SCOPE], claims: {},
    pkce: { required: () => true },
    clientAuthMethods: ['none', 'private_key_jwt'],
    issueRefreshToken: (_ctx, client, source) => productionEnabled && client.grantTypeAllowed('refresh_token') &&
      source.scopes.has(READ_SCOPE) && source.scopes.has('offline_access'),
    rotateRefreshToken: true,
    ttl: { AccessToken: productionEnabled ? 3600 : 900, AuthorizationCode: 60, IdToken: 900,
      Interaction: 300, Session: 900, Grant: productionEnabled ? CONSENT_MS / 1000 : 900,
      RefreshToken: ctx => ctx?.oidc?.entities.RotatedRefreshToken?.remainingTTL ?? CONSENT_MS / 1000 },
    interactions: { url: (_ctx, interaction) => new URL(`/mcp-connect?interaction=${interaction.uid}`, issuer).href },
    // Always ask for a fresh, explicit consent rather than reusing a broader grant.
    loadExistingGrant: async ctx => {
      const id = ctx.oidc.result?.consent?.grantId;
      return id ? provider.Grant.find(id) : undefined;
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      clientIdMetadataDocument: {
        enabled: true, ack: 'draft-02',
        allowFetch: async (_ctx, id) => id === clientId,
        allowClient: async (_ctx, client) => client.clientId === clientId,
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => { throw new errors.InvalidTarget('resource is required'); },
        useGrantedResource: () => false,
        getResourceServerInfo: async (_ctx, target, client) => {
          if (target !== resource || !clientIds.has(client.clientId)) throw new errors.InvalidTarget();
          return { scope: productionEnabled ? `${TEST_SCOPE} ${READ_SCOPE}${taskAccessEnabled ? ` ${TASK_READ_SCOPE} ${TASK_WRITE_SCOPE}` : ''}` : TEST_SCOPE,
            audience: resource, accessTokenFormat: 'opaque', accessTokenTTL: productionEnabled ? 3600 : 900 };
        },
      },
    },
    renderError: async (ctx) => { ctx.type = 'text/plain'; ctx.body = 'OAuth request could not be completed. Return to the connecting app and retry.'; },
  });
  provider.proxy = true;
  provider.use(async (ctx, next) => {
    // Reject before any redirect. Pinned clients and their exact (or loopback) callbacks only.
    if (ctx.path === '/auth') {
      const native = claudeCode && ctx.query.client_id === CLAUDE_CODE_CLIENT.client_id;
      const hosted = claude && ctx.query.client_id === CLAUDE_CLIENT.client_id;
      const metaAgent = muse && ctx.query.client_id === MUSE_CLIENT.client_id;
      const pinned = native || hosted || metaAgent;
      if (native || hosted) ctx.query.scope = claudeScope(ctx.query.scope);
      if (ctx.method !== 'GET' || !(native ? isClaudeCodeCallback(ctx.query.redirect_uri)
        : hosted ? ctx.query.redirect_uri === CLAUDE_CLIENT.redirect_uris[0]
        : metaAgent ? ctx.query.redirect_uri === MUSE_CLIENT.redirect_uris[0]
        : ctx.query.client_id === clientId && ctx.query.redirect_uri === redirectUri) ||
          (pinned && authorizationMode(ctx.query.scope, productionEnabled, taskAccessEnabled, true) !== 'production') ||
          !authorizationMode(ctx.query.scope, productionEnabled, taskAccessEnabled, pinned) || ctx.query.resource !== resource ||
          ctx.query.response_type !== 'code' || ctx.query.code_challenge_method !== 'S256' ||
          typeof ctx.query.state !== 'string' || !ctx.query.state || ctx.query.state.length > 1024) {
        ctx.status = 400; ctx.body = { error: 'invalid_request' }; return;
      }
      if (authorizationMode(ctx.query.scope, productionEnabled, taskAccessEnabled, pinned) === 'production') {
        // offline_access requires explicit consent. Our UI always asks afresh;
        // preserve caller prompts and make that policy explicit to oidc-provider.
        const prompts = (ctx.query.prompt ?? '').split(' ').filter(Boolean);
        if (prompts.includes('none')) { ctx.status = 400; ctx.body = { error: 'interaction_required' }; return; }
        // Mutate parsed params only: rewriting querystring would discard the
        // /api/oidc mount in oidc-provider's generated resume URL.
        ctx.query.prompt = [...new Set([...prompts, 'consent'])].join(' ');
      }
    }
    await next();
  });
  return provider;
}

// Next Pages API exposes the Node req/res required by the library. No extra service.
export function mountedCallback(provider, mountPath) {
  const callback = provider.callback();
  return async (req, res) => {
    const original = req.url;
    req.originalUrl = original;
    req.url = original.slice(mountPath.length) || '/';
    try { await callback(req, res); } finally { req.url = original; }
  };
}
