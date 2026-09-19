import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAutomationBatch } from '@/lib/task/automationRepository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const secret = process.env.TASK_AUTOMATION_JOB_SECRET;
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Background execution is not configured.' }, { status: 503 });
  if (Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Jobs can advance only already-authorized grants. Never accept an arbitrary user or evidence body.
  try { return NextResponse.json(await runAutomationBatch(request.nextUrl.searchParams.get('cursor') ?? undefined), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Some background checks could not be completed.' }, { status: 503 }); }
}
