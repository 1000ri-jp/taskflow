import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAutoArchiveBatch } from '@/lib/board/autoArchiveRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.TASK_AUTOMATION_JOB_SECRET;
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Background execution is not configured.' }, { status: 503, headers });
  if (Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  // The worker reads its shared policy itself. Requests cannot enable it or supply target tasks.
  try {
    return NextResponse.json(await runAutoArchiveBatch(request.nextUrl.searchParams.get('cursor') ?? undefined), { headers });
  } catch {
    return NextResponse.json({ error: 'Some automatic archive checks could not be completed.' }, { status: 503, headers });
  }
}
