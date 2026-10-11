import { firestoreAdapter } from './oidc-store.mjs';

export const CLAUDE_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];
export const isClaudeClientId = id => typeof id === 'string' && /^slowth-claude-[0-9a-f-]{36}$/.test(id);

// Dynamic registration is limited to public Claude Web/Desktop clients. Never
// fetch caller-supplied client metadata, keys, or sector identifier documents.
export function claudeClientMetadata(metadata) {
  return metadata?.application_type === 'web' && metadata.token_endpoint_auth_method === 'none' &&
    Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.length > 0 &&
    metadata.redirect_uris.length <= CLAUDE_REDIRECT_URIS.length &&
    new Set(metadata.redirect_uris).size === metadata.redirect_uris.length &&
    metadata.redirect_uris.every(uri => CLAUDE_REDIRECT_URIS.includes(uri)) &&
    Array.isArray(metadata.grant_types) && metadata.grant_types.includes('authorization_code') &&
    metadata.grant_types.every(type => ['authorization_code', 'refresh_token'].includes(type)) &&
    Array.isArray(metadata.response_types) && metadata.response_types.length === 1 && metadata.response_types[0] === 'code' &&
    ['sector_identifier_uri', 'jwks_uri', 'jwks', 'request_uris', 'initiate_login_uri'].every(key => metadata[key] === undefined);
}

export function allowedOAuthClient(config, id, metadata, redirectUri) {
  if (id === config.clientId && (redirectUri === undefined || redirectUri === config.redirectUri)) return { id, name: 'ChatGPT' };
  if (!config.claudeEnabled || !isClaudeClientId(id) || metadata?.client_id !== id || !claudeClientMetadata(metadata) ||
      redirectUri !== undefined && !metadata.redirect_uris.includes(redirectUri)) return null;
  return { id, name: 'Claude' };
}

export async function resolveOAuthClient(db, key, config, id, redirectUri) {
  if (id === config.clientId) return allowedOAuthClient(config, id, undefined, redirectUri);
  if (!config.claudeEnabled || !isClaudeClientId(id)) return null;
  const Adapter = firestoreAdapter(db, key);
  const metadata = await new Adapter('Client').find(id);
  return allowedOAuthClient(config, id, metadata, redirectUri);
}
