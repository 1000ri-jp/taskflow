import Provider, { errors } from 'oidc-provider';
import { randomUUID } from 'node:crypto';
import { authorizationMode, CONSENT_MS, READ_SCOPE, TEST_SCOPE, TASK_READ_SCOPE, TASK_WRITE_SCOPE } from './policy.mjs';
import { allowedOAuthClient, isClaudeClientId } from './oauth-clients.mjs';

export { TEST_SCOPE };

// oidc-provider advertises openid, which ChatGPT requests with the test scope.
// This identity scope never expands the MCP resource's events:test permission.
export function isTestAuthorizationScope(scope) {
  if (typeof scope !== 'string') return false;
  const scopes = scope.split(' ');
  return scopes.includes(TEST_SCOPE) && new Set(scopes).size === scopes.length &&
    scopes.every(value => value === TEST_SCOPE || value === 'openid');
}

// Protocol validation/code issuance/PKCE/replay protection are owned by oidc-provider.
export function makeProvider({ issuer, resource, clientId, redirectUri, jwks, cookieKeys,
  adapter, findAccount, clients = [], productionEnabled = false, taskAccessEnabled = false, claudeEnabled = false }) {
  if (!jwks?.keys?.length || !cookieKeys?.length) throw new Error('Explicit OAuth keys required');
  const clientConfig = { clientId, redirectUri, claudeEnabled };
  const provider = new Provider(issuer, {
    adapter, jwks, clients, findAccount,
    clientDefaults: { application_type: 'web', token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    extraClientMetadata: { properties: ['slowth_client'], validator: (_ctx, _key, _value, metadata) => {
      if (metadata.client_id === clientId) return;
      if (!allowedOAuthClient(clientConfig, metadata.client_id, metadata)) throw new errors.InvalidClientMetadata('Only Claude Web/Desktop callbacks are supported');
      metadata.slowth_client = 'claude';
    } },
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
      registration: { enabled: claudeEnabled, idFactory: () => 'slowth-claude-' + randomUUID(), issueRegistrationAccessToken: false },
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
          if (target !== resource || !allowedOAuthClient(clientConfig, client.clientId, client.metadata())) throw new errors.InvalidTarget();
          return { scope: productionEnabled ? `${TEST_SCOPE} ${READ_SCOPE}${taskAccessEnabled ? ` ${TASK_READ_SCOPE} ${TASK_WRITE_SCOPE}` : ''}` : TEST_SCOPE,
            audience: resource, accessTokenFormat: 'opaque', accessTokenTTL: productionEnabled ? 3600 : 900 };
        },
      },
    },
    renderError: async (ctx) => { ctx.type = 'text/plain'; ctx.body = 'OAuth request could not be completed. Return to your MCP client and retry.'; },
  });
  provider.proxy = true;
  provider.use(async (ctx, next) => {
    // Reject before any redirect. ChatGPT remains pinned; registered Claude
    // clients must use one of their exact, approved callbacks.
    if (ctx.path === '/auth') {
      let client;
      if (ctx.query.client_id === clientId) client = allowedOAuthClient(clientConfig, clientId, undefined, ctx.query.redirect_uri);
      else if (claudeEnabled && isClaudeClientId(ctx.query.client_id)) {
        const registered = await provider.Client.find(ctx.query.client_id);
        client = allowedOAuthClient(clientConfig, ctx.query.client_id, registered?.metadata(), ctx.query.redirect_uri);
      }
      if (client?.name === 'Claude') {
        // MCP clients request resource scopes rather than OIDC identity/offline
        // scopes. The same explicit, thirty-day consent applies to both clients.
        const scope = ctx.query.scope ?? (productionEnabled
          ? `${READ_SCOPE}${taskAccessEnabled ? ` ${TASK_READ_SCOPE} ${TASK_WRITE_SCOPE}` : ''}` : TEST_SCOPE);
        if (typeof scope === 'string') {
          const scopes = scope.split(' ');
          if (new Set(scopes).size === scopes.length && scopes.every(Boolean)) {
            const extras = scopes.includes(READ_SCOPE) ? ['openid', 'offline_access'] : ['openid'];
            ctx.query.scope = [...scopes, ...extras.filter(value => !scopes.includes(value))].join(' ');
          }
        }
      }
      if (ctx.method !== 'GET' || !client ||
          !authorizationMode(ctx.query.scope, productionEnabled, taskAccessEnabled) || ctx.query.resource !== resource ||
          ctx.query.response_type !== 'code' || ctx.query.code_challenge_method !== 'S256' ||
          typeof ctx.query.state !== 'string' || !ctx.query.state || ctx.query.state.length > 1024) {
        ctx.status = 400; ctx.body = { error: 'invalid_request' }; return;
      }
      if (authorizationMode(ctx.query.scope, productionEnabled, taskAccessEnabled) === 'production') {
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
    if (claudeEnabled && productionEnabled && ctx.path.startsWith('/.well-known/') && ctx.body?.issuer === issuer) {
      // Production and synthetic scopes describe separate grants. Advertising
      // both together makes clients that request discovery scopes ask for an
      // invalid combination. Explicit synthetic requests remain supported.
      ctx.body.scopes_supported = [READ_SCOPE, 'openid', 'offline_access', ...(taskAccessEnabled ? [TASK_READ_SCOPE, TASK_WRITE_SCOPE] : [])];
    }
  });
  return provider;
}

// Next Pages API exposes the Node req/res required by the library. No extra service.
export function mountedCallback(provider, mountPath) {
  const callback = provider.callback();
  return async (req, res) => {
    const original = req.url;
    const pathname = original.split('?')[0];
    // Next rewrites preserve the public request URL on req.url. RFC 8414
    // discovery puts the issuer path after /.well-known, outside our mount.
    const discovery = ['oauth-authorization-server', 'openid-configuration']
      .find(name => pathname === `/.well-known/${name}${mountPath}`);
    const mounted = discovery ? `${mountPath}/.well-known/${discovery}${original.slice(pathname.length)}` : original;
    req.originalUrl = mounted;
    req.url = mounted.slice(mountPath.length) || '/';
    try { await callback(req, res); } finally { req.url = original; }
  };
}
