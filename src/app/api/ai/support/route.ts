import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { parseSupportProfile } from '@/lib/ai/support/profile';
import { readAISupportProfile, saveAISupportProfile } from '@/lib/ai/support/repository';

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function userId(request: NextRequest) {
  try { return (await verifyAuthToken(request.headers.get('Authorization'))).uid; }
  catch { return null; }
}
export async function GET(request: NextRequest) {
  const uid = await userId(request);
  if (!uid) return json({ error: 'ログインを確認してください。' }, 401);
  try { return json(await readAISupportProfile(uid)); }
  catch { return json({ error: '手伝い方を取得できませんでした。再取得してください。' }, 503); }
}
export async function PUT(request: NextRequest) {
  const uid = await userId(request);
  if (!uid) return json({ error: 'ログインを確認してください。' }, 401);
  let profile;
  try {
    const raw = await request.text();
    if (raw.length > 24000) return json({ error: '入力が長すぎます。' }, 400);
    profile = parseSupportProfile(JSON.parse(raw));
  } catch { return json({ error: '入力の形式と長さを確認してください。' }, 400); }
  try { await saveAISupportProfile(uid, profile); return json(profile); }
  catch { return json({ error: '保存できませんでした。入力内容は残っています。' }, 503); }
}
