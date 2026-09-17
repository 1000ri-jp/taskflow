import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { isValidProvider } from '@/lib/ai/providers';
import { isTaskRelationshipId, suggestTaskRelationships, TaskRelationshipError } from '@/lib/ai/taskRelationships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { return json({ error: 'ログインを確認してください。', code: 'UNAUTHORIZED' }, 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) return json({ error: 'このアカウントは利用対象外です。', code: 'FORBIDDEN' }, 403);
  try {
    const text = await request.text();
    let body: unknown;
    try { body = text.length <= 1000 ? JSON.parse(text) : null; } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskRelationshipError('INVALID', '入力形式を確認してください。');
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some(key => !['projectId', 'provider', 'model'].includes(key)) || !isTaskRelationshipId(data.projectId)
      || typeof data.provider !== 'string' || !isValidProvider(data.provider)
      || data.model !== undefined && (typeof data.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(data.model))) {
      throw new TaskRelationshipError('INVALID', 'プロジェクトとAI設定を確認してください。');
    }
    return json(await suggestTaskRelationships(user.uid, data.projectId, data.provider, data.model as string | undefined));
  } catch (error) {
    if (error instanceof TaskRelationshipError) {
      const status = { INVALID: 422, FORBIDDEN: 403, LIMIT: 422, SOURCE_UNAVAILABLE: 503, CONFLICT: 409, AI_NOT_CONFIGURED: 503, AI_INVALID: 502, AI_UNAVAILABLE: 503, AI_TIMEOUT: 504 }[error.code];
      return json({ error: error.message, code: error.code }, status);
    }
    return json({ error: 'タスク情報を取得できませんでした。時間をおいてもう一度お試しください。', code: 'SOURCE_UNAVAILABLE' }, 503);
  }
}
