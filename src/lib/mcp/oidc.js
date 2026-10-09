import { createHash } from 'node:crypto';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { makeProvider, TEST_SCOPE } from '../../../scripts/mcp-events/oidc-provider.mjs';
import { firestoreAdapter } from '../../../scripts/mcp-events/oidc-store.mjs';
import { PILOT_PROJECT, READ_SCOPE, TASK_READ_SCOPE, TASK_WRITE_SCOPE } from '../../../scripts/mcp-events/policy.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function oidcConfig() {
  if (process.env.SLOWTH_MCP_OAUTH_ENABLED !== 'true') throw new Error('OAuth disabled');
  const origin = process.env.SLOWTH_MCP_OAUTH_ORIGIN;
  const allowedUid = process.env.SLOWTH_MCP_OAUTH_ALLOWED_UID;
  const clientId = process.env.SLOWTH_MCP_OAUTH_CLIENT_ID;
  const redirectUri = process.env.SLOWTH_MCP_OAUTH_REDIRECT_URI;
  if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://') || !allowedUid ||
      !/^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(clientId ?? '') ||
      !/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(redirectUri ?? '')) throw new Error('OAuth configuration incomplete');
  const productionEnabled = process.env.SLOWTH_MCP_EVENTS_PRODUCTION === 'true';
  if (productionEnabled && process.env.SLOWTH_MCP_EVENTS_PROJECT_ID !== PILOT_PROJECT) throw new Error('Pilot project required');
  return { origin, issuer: origin + '/api/oidc', resource: origin + '/api/mcp', allowedUid, clientId, redirectUri, productionEnabled, taskAccessEnabled: productionEnabled && process.env.SLOWTH_MCP_TASK_ACCESS === 'true' };
}
let instance;
export function oidcProvider() {
  const config = oidcConfig();
  if (!instance) {
    const jwks = JSON.parse(process.env.SLOWTH_MCP_OAUTH_JWKS ?? 'null');
    const cookieKeys = JSON.parse(process.env.SLOWTH_MCP_OAUTH_COOKIE_KEYS ?? 'null');
    const storageKey = Buffer.from(process.env.SLOWTH_MCP_OAUTH_STORAGE_KEY ?? '', 'base64');
    if (!jwks?.keys?.some(k => k.d) || !Array.isArray(cookieKeys) || !cookieKeys.length ||
        cookieKeys.some(k => typeof k !== 'string' || k.length < 32) || storageKey.length !== 32) throw new Error('OAuth keys not configured');
    instance = makeProvider({ ...config, jwks, cookieKeys, adapter: firestoreAdapter(getAdminDb(), storageKey),
      findAccount: async (ctx, uid) => {
        const artifact = ctx?.oidc?.entities?.RefreshToken;
        if (artifact) {
          const binding = (await getAdminDb().collection('mcpOAuthGrants').doc(digest(artifact.grantId)).get()).data();
          if (!config.productionEnabled || binding?.mode !== 'production' || binding.userId !== uid ||
              binding.projectId !== PILOT_PROJECT || binding.expiresAt?.toMillis?.() <= Date.now() ||
              !Number.isFinite(binding.expiresAt?.toMillis?.())) throw new Error('Forbidden');
          await activeUser(uid, config, binding.authTime);
          await assertProject(uid, binding.projectId);
        } else await activeUser(uid, config);
        return { accountId: uid, claims: async () => ({ sub: uid }) };
      },
    });
  }
  return instance;
}
export async function activeUser(uid, config = oidcConfig(), authTime) {
  if (uid !== config.allowedUid) throw new Error('Forbidden');
  const user = await getAdminAuth().getUser(uid);
  if (user.disabled || !user.emailVerified || !user.email?.endsWith('@1000ri.jp') ||
      !user.providerData.some(p => p.providerId === 'google.com') ||
      (authTime !== undefined && (!Number.isFinite(authTime) || authTime < Date.parse(user.tokensValidAfterTime) / 1000)) ||
      !(await getAdminDb().collection('users').doc(uid).get()).exists) throw new Error('Forbidden');
  return user;
}
export async function firebaseConsentUser(header) {
  if (!header?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const user = await getAdminAuth().verifyIdToken(header.slice(7), true);
  if (user.email_verified !== true || user.firebase?.sign_in_provider !== 'google.com') throw new Error('Forbidden');
  await activeUser(user.uid, oidcConfig(), user.auth_time);
  return user;
}
export async function assertProject(uid, projectId, write = false) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error('Forbidden');
  await getProjectAccess(uid, projectId, write ? ['tasks:read', 'tasks:write'] : ['tasks:read'], [projectId], write ? 'tasks:write' : 'tasks:read');
}
export async function authenticateMcp(header) {
  const config = oidcConfig();
  if (!header?.startsWith('Bearer ') || header.length > 2048) throw new Error('Unauthorized');
  const provider = oidcProvider();
  const token = await provider.AccessToken.find(header.slice(7));
  const scopes = typeof token?.scope === 'string' ? token.scope.split(' ') : [];
  const production = config.productionEnabled && scopes.includes(READ_SCOPE);
  const validScopes = token?.scope === TEST_SCOPE || production && new Set(scopes).size === scopes.length &&
    scopes.every(s => [READ_SCOPE, ...(config.taskAccessEnabled ? [TASK_READ_SCOPE, TASK_WRITE_SCOPE] : [])].includes(s)) &&
    (!scopes.includes(TASK_WRITE_SCOPE) || scopes.includes(TASK_READ_SCOPE));
  if (!token || token.clientId !== config.clientId || token.aud !== config.resource ||
      !validScopes ||
      !token.grantId || !Number.isFinite(token.exp)) throw new Error('Unauthorized');
  const grant = await provider.Grant.find(token.grantId);
  if (!grant || !Number.isFinite(grant.exp)) throw new Error('Unauthorized');
  const binding = (await getAdminDb().collection('mcpOAuthGrants').doc(digest(token.grantId)).get()).data();
  const deadlines = [binding?.expiresAt?.toMillis?.(), grant.exp * 1000, token.exp * 1000];
  const expiresAt = Math.min(...deadlines);
  if (!binding || binding.userId !== token.accountId || binding.clientId !== config.clientId ||
      binding.resource !== config.resource || !deadlines.every(Number.isFinite) || expiresAt <= Date.now()) throw new Error('Unauthorized');
  const taskScopes = scopes.filter(s => [TASK_READ_SCOPE, TASK_WRITE_SCOPE].includes(s));
  if (taskScopes.some(s => !binding.taskScopes?.includes(s))) throw new Error('Unauthorized');
  if (production && (binding.mode !== 'production' || binding.projectId !== PILOT_PROJECT)) throw new Error('Unauthorized');
  if (!production && binding.mode === 'production') throw new Error('Unauthorized');
  await activeUser(binding.userId, config, binding.authTime);
  await assertProject(binding.userId, binding.projectId);
  if (expiresAt <= Date.now()) throw new Error('Unauthorized');
  return { userId: binding.userId, grantId: token.grantId, expiresAt, permissions: ['tasks:read', ...(taskScopes.includes(TASK_WRITE_SCOPE) ? ['tasks:write'] : [])], projectIds: [binding.projectId],
    ...(taskScopes.length ? { taskScopes } : {}),
    ...(production ? { mode: 'production', authorizationExpiresAt: Math.min(binding.expiresAt.toMillis(), grant.exp * 1000) } : {}) };
}
