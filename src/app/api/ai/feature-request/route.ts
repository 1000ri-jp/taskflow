import { parseAnnotationReferences } from '@/lib/ai/featureRequest/annotations';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { isValidProvider } from '@/lib/ai/providers';
import { parseRequestTurns } from '@/lib/ai/featureRequest/types';
import { prepareFeatureRequest } from '@/lib/ai/featureRequest/prepare';
export const runtime = 'nodejs';
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
  let uid: string;
  try { uid = (await verifyAuthToken(request.headers.get('Authorization'))).uid; } catch { return json({ error: 'ログインを確認してください。' }, 401); }
  let body, turns, annotations;
  try {
    const raw = await request.text(); if (raw.length > 48000) throw new Error(); body = JSON.parse(raw);
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !['projectId', 'turns', 'provider', 'model', 'annotations'].includes(key)) || typeof body.projectId !== 'string' || !/^[\w-]{1,100}$/.test(body.projectId) || !isValidProvider(body.provider) || body.model !== undefined && (typeof body.model !== 'string' || body.model.length > 200)) throw new Error();
    turns = parseRequestTurns(body.turns); annotations = parseAnnotationReferences(body.annotations);
  } catch { return json({ error: '要望の内容と長さを確認してください。' }, 400); }
  try { return json(await prepareFeatureRequest(uid, body.projectId, turns, body.provider, body.model, ...(annotations.length ? [annotations] : []))); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'FORBIDDEN' || message === 'NOT_FOUND') return json({ error: '送信先への権限とAIアクセス設定を確認してください。' }, 403);
    if (message === 'AI_NOT_CONFIGURED') return json({ error: 'AI設定で接続を確認してください。' }, 503);
    return json({ error: '要望を整理できませんでした。入力内容は残っています。' }, 503);
  }
}
