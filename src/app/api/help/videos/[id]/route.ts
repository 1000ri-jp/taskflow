import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/admin';
import videos from '@/lib/help/videos.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return failure('ログインしてください。', 401);
  let user;
  try { user = await getAdminAuth().verifyIdToken(authorization.slice(7), true); }
  catch { return failure('ログインを確認できません。', 401); }
  if (!user.email_verified || !user.email?.toLowerCase().endsWith('@1000ri.jp')) return failure('社内アカウントでログインしてください。', 403);
  const { id } = await context.params;
  const video = videos.find(item => item.id === id);
  if (!video) return failure('動画が見つかりません。', 404);
  try {
    // Only allowlisted, server-side media is shipped. Never expose recordings in public/.
    const data = await readFile(path.join(process.cwd(), 'src/assets/help-videos', video.file));
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Type': 'video/mp4', 'Content-Length': String(data.byteLength) } });
  } catch { return failure('動画を読み込めませんでした。もう一度お試しください。', 503); }
}
