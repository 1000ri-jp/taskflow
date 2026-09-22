import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { approveMiniPairing, consumeMiniPairing, MiniPairingError } from '@/lib/auth/miniPairingServer';
import { validateMiniPairing } from '@/lib/auth/miniPairing';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });

async function readBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new MiniPairingError('Invalid request', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 18000) { await reader.cancel(); throw new MiniPairingError('Request too large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const local = process.env.NODE_ENV !== 'production' && origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin !== 'https://slowth.1000ri.jp' && !local) return reply({ error: 'Forbidden' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Invalid content type' }, 415);
  try {
    // Never parse/log bearer credentials or encrypted envelopes in errors.
    const body = await readBody(request);
    if (!body || typeof body !== 'object') return reply({ error: 'Invalid request' }, 400);
    if (body.action === 'consume') {
      if (typeof body.id !== 'string' || typeof body.secret !== 'string') return reply({ error: 'Invalid request' }, 400);
      const result = await consumeMiniPairing(getAdminDb(), body.id, body.secret);
      return reply(result ? { status: 'approved', ...result } : { status: 'pending' });
    }
    if (body.action !== 'approve') return reply({ error: 'Invalid action' }, 400);
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ') || bearer.startsWith('Bearer tf_')) return reply({ error: 'ログインしてください。' }, 401);
    let user;
    try { user = await getAdminAuth().verifyIdToken(bearer.slice(7), true); }
    catch { return reply({ error: 'ログインを確認できません。もう一度お試しください。' }, 401); }
    if (!user.email_verified || !user.email?.endsWith('@1000ri.jp') || user.firebase?.sign_in_provider !== 'google.com') return reply({ error: '会社のGoogleアカウントでログインしてください。' }, 403);
    if (!user.auth_time || Date.now() / 1000 - user.auth_time > 300) return reply({ error: 'もう一度Googleでログインしてください。' }, 401);
    let pairing;
    try { pairing = validateMiniPairing(body.request); }
    catch { return reply({ error: '接続情報が無効か、期限が切れています。Miniでやり直してください。' }, 400); }
    await approveMiniPairing(getAdminDb(), pairing, body.envelope, user.uid);
    return reply({ status: 'approved' });
  } catch (error) {
    if (error instanceof MiniPairingError) return reply({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return reply({ error: 'Invalid JSON' }, 400);
    return reply({ error: 'Miniとの接続に失敗しました。Miniでやり直してください。' }, 500);
  }
}
