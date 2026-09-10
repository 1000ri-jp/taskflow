import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { readSharedCountdown, saveSharedCountdown } from '@/lib/firebase/admin-countdown';
import { isCountdownTarget } from '@/lib/dashboard/countdown';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function authorize(request: NextRequest) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { throw new Error('UNAUTHORIZED'); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new Error('FORBIDDEN');
  return user.uid;
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'UNAUTHORIZED') return json({ error: 'ログインを確認してください。' }, 401);
  if (message === 'FORBIDDEN') return json({ error: 'この設定またはタスクへのアクセス権限がありません。' }, 403);
  if (message === 'NOT_FOUND' || message === 'INVALID_COUNTDOWN_TASK') return json({ error: '期限のある未完了タスクを選んでください。' }, 400);
  if (message === 'CONFLICT') return json({ error: 'ほかの人が設定を変更しました。最新の設定を確認して選び直してください。' }, 409);
  return json({ error: '共有設定を読み書きできません。サーバーのFirebase認証・接続設定を確認してください。' }, 503);
}

export async function GET(request: NextRequest) {
  try { return json(await readSharedCountdown(await authorize(request))); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await authorize(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '設定が不正です。' }, 400);
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => key !== 'target' && key !== 'revision') ||
      (value.target !== null && !isCountdownTarget(value.target)) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
      return json({ error: '設定が不正です。' }, 400);
    }
    await saveSharedCountdown(userId, value.target, value.revision as number);
    return json({ saved: true });
  } catch (error) { return failure(error); }
}
