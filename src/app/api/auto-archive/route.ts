import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { validArchiveDays } from '@/lib/board/autoArchivePreview';
import { AutoArchiveError, readAutoArchive, runAutoArchive, saveAutoArchive } from '@/lib/board/autoArchiveRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const validId = (id: unknown): id is string => typeof id === 'string' && /^[^/\s]{1,200}$/.test(id);
const validCursor = (cursor: unknown): cursor is string => typeof cursor === 'string' && /^projects\/[^/\s]{1,200}$/.test(cursor);

async function authorize(request: Request) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { throw new AutoArchiveError('ログインを確認してください。', 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new AutoArchiveError('会社のアカウントでログインしてください。', 403);
  return user.uid;
}
function failure(error: unknown) {
  return error instanceof AutoArchiveError ? json({ error: error.message }, error.status)
    : json({ error: '自動アーカイブの設定・実行を確認できません。もう一度お試しください。' }, 503);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 2000) throw new AutoArchiveError('入力が長すぎます。');
  let value;
  try { value = JSON.parse(text); } catch { throw new AutoArchiveError('入力形式を確認してください。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutoArchiveError('入力形式を確認してください。');
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const uid = await authorize(request);
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (projectId !== null && !validId(projectId)) throw new AutoArchiveError('対象プロジェクトを確認してください。');
    return json(await readAutoArchive(uid, projectId));
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    const uid = await authorize(request);
    const input = await body(request);
    if (Object.keys(input).some(key => !['projectId', 'revision', 'mode', 'days'].includes(key))
      || input.projectId !== null && !validId(input.projectId)
      || typeof input.revision !== 'string' || input.revision.length > 200
      || input.mode !== 'inherit' && input.mode !== 'custom'
      || input.projectId === null && input.mode !== 'custom'
      || input.days !== null && !validArchiveDays(input.days)) throw new AutoArchiveError('設定内容を確認してください。');
    return json(await saveAutoArchive(uid, { projectId: input.projectId, revision: input.revision, mode: input.mode, days: input.days }));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const uid = await authorize(request);
    const input = await body(request);
    if (input.action !== 'run' || Object.keys(input).some(key => !['action', 'cursor'].includes(key))
      || input.cursor !== undefined && !validCursor(input.cursor)) throw new AutoArchiveError('実行内容を確認してください。');
    return json(await runAutoArchive(uid, input.cursor as string | undefined));
  } catch (error) { return failure(error); }
}
