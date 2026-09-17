import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GoogleService } from './types';

export class GoogleWorkspaceError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export const CALENDAR_LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const SCOPES: Record<GoogleService, string[]> = {
  calendar: ['https://www.googleapis.com/auth/calendar.events.readonly', CALENDAR_LIST_SCOPE],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
  chat: ['https://www.googleapis.com/auth/chat.spaces.readonly', 'https://www.googleapis.com/auth/chat.messages.readonly'],
};
export function googleConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const namespace = process.env.GOOGLE_WORKSPACE_NAMESPACE;
  if (!clientId || !clientSecret || !redirectUri || !key || !namespace || !/^[a-zA-Z0-9_-]{1,80}$/.test(namespace) || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new GoogleWorkspaceError('NOT_CONFIGURED', 'Google連携のサーバー設定を準備中です。');
  }
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.pathname !== '/api/google/callback' || url.search || url.hash || url.username || url.password) {
    throw new GoogleWorkspaceError('NOT_CONFIGURED', 'Google連携の戻り先設定を確認してください。');
  }
  return { clientId, clientSecret, redirectUri, key: Buffer.from(key, 'hex'), namespace, origin: url.origin, secure: url.protocol === 'https:' };
}
export function isGoogleConfigured() { try { googleConfig(); return true; } catch { return false; } }
export function seal(value: unknown, context: string) {
  const config = googleConfig(); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(Buffer.from(`${config.namespace}:${context}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal<T>(value: string, context: string): T {
  const config = googleConfig(); const raw = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', config.key, raw.subarray(0, 12));
  cipher.setAAD(Buffer.from(`${config.namespace}:${context}`)); cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8')) as T;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
export function equalSecret(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function assertGoogleAccount(profile: { email?: string; email_verified?: boolean; hd?: string }, email: string) {
  if (profile.email_verified !== true || profile.email?.toLowerCase() !== email.toLowerCase() || !email.toLowerCase().endsWith('@1000ri.jp') || profile.hd !== '1000ri.jp') {
    throw new GoogleWorkspaceError('ACCOUNT_MISMATCH', 'TaskFlowと同じ会社のGoogleアカウントを選んでください。', 403);
  }
}
export async function googleJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    if (response.status === 401) throw new GoogleWorkspaceError('RECONNECT', 'Googleとの再接続が必要です。', 401);
    if (response.status === 403) throw new GoogleWorkspaceError('PERMISSION', 'Googleの権限またはAPI設定を確認してください。', 403);
    if (response.status === 429) throw new GoogleWorkspaceError('RATE_LIMIT', 'Googleの取得制限に達しました。時間を置いて更新してください。', 429);
    throw new GoogleWorkspaceError('GOOGLE_UNAVAILABLE', 'Googleから取得できませんでした。前回の情報を保持しています。');
  }
  return response.json() as Promise<T>;
}
