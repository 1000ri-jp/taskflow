import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { GoogleWorkspaceError } from './security';
import { GOOGLE_SERVICES, type GoogleService } from './types';
export const googleResponse = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
export async function googleUser(request: NextRequest) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { throw new GoogleWorkspaceError('UNAUTHORIZED', 'TaskFlowにログインしてください。', 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new GoogleWorkspaceError('FORBIDDEN', '会社のアカウントでログインしてください。', 403);
  return { uid: user.uid, email: user.email };
}
export function googleFailure(error: unknown) {
  return error instanceof GoogleWorkspaceError ? googleResponse({ error: error.message, code: error.code }, error.status) : googleResponse({ error: 'Google連携を確認できませんでした。時間を置いて更新してください。' }, 503);
}
export async function googleBody(request: NextRequest) {
  const text = await request.text();
  try {
    if (text.length > 3000) throw new Error();
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new GoogleWorkspaceError('INVALID', '入力を確認してください。', 422); }
}
export function googleService(value: unknown): GoogleService {
  if (!GOOGLE_SERVICES.includes(value as GoogleService)) throw new GoogleWorkspaceError('INVALID', '連携するサービスを選んでください。', 422);
  return value as GoogleService;
}
