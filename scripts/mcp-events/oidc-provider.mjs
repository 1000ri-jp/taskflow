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

// Protocol validation/code issuance/PKCE/replay protection are owned by oidc-provider.
export function makeProvider({ issuer, resource, clientId, redirectUri, jwks, cookieKeys,
  adapter, findAccount, clients = [], productionEnabled = false, taskAccessEnabled = false }) {
  if (!jwks?.keys?.length || !cookieKeys?.length) throw new Error('Explicit OAuth keys required');
  const provider = new Provider(issuer, {
    adapter, jwks, clients, findAccount,
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
          if (target !== resource || client.clientId !== clientId) throw new errors.InvalidTarget();
          return { scope: productionEnabled ? `${TEST_SCOPE} ${READ_SCOPE}${taskAccessEnabled ? ` ${TASK_READ_SCOPE} ${TASK_WRITE_SCOPE}` : ''}` : TEST_SCOPE,
            audience: resource, accessTokenFormat: 'opaque', accessTokenTTL: productionEnabled ? 3600 : 900 };
        },
      },
    },
    renderError: async (ctx) => { ctx.type = 'text/plain'; ctx.body = 'OAuth request could not be completed. Return to ChatGPT and retry.'; },
  });
  provider.proxy = true;
  provider.use(async (ctx, next) => {
    // Reject before any redirect. One pinned client and exact callback only.
    if (ctx.path === '/auth') {
      if (ctx.method !== 'GET' || ctx.query.client_id !== clientId || ctx.query.redirect_uri !== redirectUri ||
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
