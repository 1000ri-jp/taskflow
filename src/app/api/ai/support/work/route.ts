import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { isValidProvider } from '@/lib/ai/providers';
import { prepareWorkSupport } from '@/lib/ai/support/work';
import { SecretaryError } from '@/lib/secretary/engine';
export const runtime = 'nodejs';
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
  let uid: string;
  try { uid = (await verifyAuthToken(request.headers.get('Authorization'))).uid; } catch { return json({ error: 'ログインを確認してください。' }, 401); }
  let body;
  try {
    const raw = await request.text(); if (raw.length > 3000) throw new Error(); body = JSON.parse(raw);
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !['projectId', 'taskId', 'provider', 'model', 'once'].includes(k))
      || !isValidProvider(body.provider) || [body.projectId, body.taskId].some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))
      || body.model !== undefined && (typeof body.model !== 'string' || body.model.length > 200)
      || body.once !== undefined && (typeof body.once !== 'string' || body.once.length > 1000)) throw new Error();
  } catch { return json({ error: '対象と手伝い方を確認してください。' }, 400); }
  try { return json(await prepareWorkSupport(uid, body.projectId, body.taskId, body.provider, body.model, body.once)); }
  catch (error) {
    return json({ error: error instanceof SecretaryError ? error.message : 'AIの整理を取得できませんでした。' }, error instanceof SecretaryError ? ({ FORBIDDEN: 403, INVALID: 400, CONFLICT: 409, INCOMPLETE: 503, AI_UNAVAILABLE: 503 })[error.code] : 503);
  }
}
