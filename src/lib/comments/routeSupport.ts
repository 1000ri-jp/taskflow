import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { ReactionError } from './reactions';
export const reactionJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function reactionUser(request: Request) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { throw new ReactionError('ログインを確認してください。', 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new ReactionError('このアカウントは利用対象外です。', 403);
  return user.uid;
}
export async function reactionBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 3000) throw new ReactionError('入力が長すぎます。');
  try { const data = JSON.parse(raw); if (data && typeof data === 'object' && !Array.isArray(data)) return data; } catch { /* invalid below */ }
  throw new ReactionError('入力形式を確認してください。');
}
export const reactionFailure = (error: unknown) => error instanceof ReactionError
  ? reactionJson({ error: error.message }, error.status)
  : reactionJson({ error: 'スタンプの取得・保存を確認できませんでした。再試行してください。' }, 503);
