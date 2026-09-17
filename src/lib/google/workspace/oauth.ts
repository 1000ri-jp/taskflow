import { randomBytes, randomUUID } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import { assertGoogleAccount, CALENDAR_LIST_SCOPE, digest, equalSecret, googleConfig, googleJson, GoogleWorkspaceError, SCOPES, seal, unseal } from './security';
import { googleSelections, type GoogleService, type StoredGoogleSelections } from './types';

export interface Connection extends StoredGoogleSelections {
  epoch: string; email: string; clientId: string; scopes: string[]; enabled: GoogleService[]; credentials: string;
}
interface Credentials { accessToken: string; refreshToken: string; expiresAt: number }
interface OAuthCookie { uid: string; state: string; expiresAt: number }
interface OAuthState extends OAuthCookie { email: string; service: GoogleService; verifier: string }
interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
export const COOKIE_NAME = 'taskflow_google_oauth';
export const connectionRef = (uid: string) => getAdminDb().doc(`googleWorkspaceConnections/${googleConfig().namespace}/users/${uid}`);
export const cacheRef = (uid: string) => getAdminDb().doc(`googleWorkspaceSnapshots/${googleConfig().namespace}/users/${uid}`);
const stateRef = (uid: string) => connectionRef(uid).collection('oauth').doc('state');
export async function startGoogleOAuth(uid: string, email: string, service: GoogleService) {
  const config = googleConfig();
  const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
  const expiresAt = Date.now() + 10 * 60000;
  const data: OAuthState = { uid, email, service, state, verifier, expiresAt };
  // One pending request per user; retries overwrite instead of accumulating state documents.
  await stateRef(uid).set({ hash: digest(state), expiresAt, sealed: seal(data, `${uid}:oauth`) });
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: ['openid', 'email', ...SCOPES[service]].join(' '), access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent',
    state, code_challenge: digest(verifier), code_challenge_method: 'S256', login_hint: email, hd: '1000ri.jp' });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, cookie: seal({ uid, state, expiresAt } satisfies OAuthCookie, 'oauth-cookie') };
}
export async function finishGoogleOAuth(cookie: string, state: string, code: string) {
  let browser: OAuthCookie;
  try { browser = unseal<OAuthCookie>(cookie, 'oauth-cookie'); }
  catch { throw new GoogleWorkspaceError('INVALID_STATE', '接続操作の期限が切れました。設定からやり直してください。', 400); }
  if (!state || !code || browser.expiresAt < Date.now() || !equalSecret(browser.state, state)) throw new GoogleWorkspaceError('INVALID_STATE', '接続操作を確認できません。設定からやり直してください。', 400);
  const pending = await getAdminDb().runTransaction(async tx => {
    const ref = stateRef(browser.uid); const doc = await tx.get(ref); const data = doc.data();
    if (!data || data.expiresAt < Date.now() || !equalSecret(data.hash, digest(state))) throw new GoogleWorkspaceError('INVALID_STATE', '接続操作の期限が切れました。', 400);
    const pending = unseal<OAuthState>(data.sealed, `${browser.uid}:oauth`);
    tx.delete(ref); return pending;
  });
  const config = googleConfig();
  const token = await googleJson<TokenResponse>('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: pending.verifier }) });
  if (!token.access_token || !Number.isFinite(token.expires_in)) throw new GoogleWorkspaceError('RECONNECT', 'Googleから接続情報を取得できませんでした。');
  const profile = await googleJson<{ email: string; email_verified: boolean; hd: string }>('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
  assertGoogleAccount(profile, pending.email);
  const scopes = (token.scope ?? '').split(' ');
  if (!SCOPES[pending.service].every(s => scopes.includes(s))) throw new GoogleWorkspaceError('SCOPE_MISSING', '必要な読み取り権限が選択されていません。接続画面で確認してください。', 403);
  await getAdminDb().runTransaction(async tx => {
    const ref = connectionRef(pending.uid); const previous = (await tx.get(ref)).data() as Connection | undefined;
    const reusable = previous?.clientId === config.clientId && previous.email === profile.email;
    const oldTokens = reusable ? unseal<Credentials>(previous.credentials, `${pending.uid}:tokens`) : undefined;
    const refreshToken = token.refresh_token || oldTokens?.refreshToken;
    if (!refreshToken) throw new GoogleWorkspaceError('RECONNECT', '接続維持の権限を取得できませんでした。もう一度接続してください。');
    const credentials = seal({ accessToken: token.access_token, refreshToken, expiresAt: Date.now() + token.expires_in * 1000 } satisfies Credentials, `${pending.uid}:tokens`);
    const next: Connection = { epoch: randomUUID(), email: profile.email, clientId: config.clientId, credentials, scopes,
      enabled: [...new Set([...(reusable ? previous.enabled : []), pending.service])].filter(s => SCOPES[s].filter(scope => scope !== CALENDAR_LIST_SCOPE).every(scope => scopes.includes(scope))),
      selectedSpaces: reusable ? previous.selectedSpaces : [],
      selectedCalendars: googleSelections(reusable ? previous : { selectedSpaces: [] }, 'calendar'),
      gmailLabels: googleSelections(reusable ? previous : { selectedSpaces: [] }, 'gmail') };
    tx.set(ref, next); tx.delete(cacheRef(pending.uid));
  });
  return pending.service;
}
const tokenRequests = new Map<string, Promise<string>>();
export async function accessToken(uid: string, connection: Connection) {
  const key = `${uid}:${connection.epoch}`; const running = tokenRequests.get(key); if (running) return running;
  const request = (async () => {
    const config = googleConfig();
    if (connection.clientId !== config.clientId) throw new GoogleWorkspaceError('RECONNECT', 'Google連携の設定が変わりました。再接続してください。');
    const tokens = unseal<Credentials>(connection.credentials, `${uid}:tokens`);
    if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
    let token: TokenResponse;
    try { token = await googleJson<TokenResponse>('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refreshToken }) }); }
    catch { throw new GoogleWorkspaceError('RECONNECT', 'Googleとの接続が切れました。設定から再接続してください。', 401); }
    if (!token.access_token || !Number.isFinite(token.expires_in)) throw new GoogleWorkspaceError('RECONNECT', 'Googleとの再接続が必要です。');
    await getAdminDb().runTransaction(async tx => {
      const ref = connectionRef(uid); const latest = (await tx.get(ref)).data() as Connection | undefined;
      if (latest?.epoch !== connection.epoch) throw new GoogleWorkspaceError('CONNECTION_CHANGED', 'Google連携の設定が変わりました。更新してください。', 409);
      tx.update(ref, { credentials: seal({ accessToken: token.access_token, refreshToken: token.refresh_token || tokens.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 } satisfies Credentials, `${uid}:tokens`) });
    });
    return token.access_token;
  })();
  tokenRequests.set(key, request); try { return await request; } finally { tokenRequests.delete(key); }
}
