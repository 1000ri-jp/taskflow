import { NextRequest } from 'next/server';
import { googleBody, googleFailure, googleResponse, googleService, googleUser } from '@/lib/google/workspace/http';
import { disconnectWorkspace, readWorkspace, refreshWorkspace, selectWorkspace, workspaceChoices } from '@/lib/google/workspace/repository';
import { GoogleWorkspaceError } from '@/lib/google/workspace/security';
import { MAX_GOOGLE_SELECTIONS } from '@/lib/google/workspace/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  try {
    const { uid } = await googleUser(request); const choices = request.nextUrl.searchParams.get('choices');
    if (choices === 'calendar' || choices === 'gmail' || choices === 'chat') return googleResponse(await workspaceChoices(uid, choices));
    return googleResponse(await readWorkspace(uid));
  } catch (e) { return googleFailure(e); }
}
export async function POST(request: NextRequest) {
  try {
    const { uid } = await googleUser(request); const data = await googleBody(request);
    if (![0, 1, 5, 15, 30, 60, 180].includes(Number(data.minutes)) || typeof data.minutes !== 'number' || typeof data.force !== 'boolean') throw new GoogleWorkspaceError('INVALID', '取得間隔を選択してください。', 422);
    return googleResponse(await refreshWorkspace(uid, data.minutes, data.force));
  } catch (e) { return googleFailure(e); }
}
export async function PATCH(request: NextRequest) {
  try {
    const { uid } = await googleUser(request); const data = await googleBody(request); const service = googleService(data.service);
    if (!Array.isArray(data.ids) || data.ids.length > MAX_GOOGLE_SELECTIONS || data.ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(data.ids).size !== data.ids.length) throw new GoogleWorkspaceError('INVALID', '取得対象を確認してください。', 422);
    return googleResponse(await selectWorkspace(uid, service, data.ids as string[]));
  } catch (e) { return googleFailure(e); }
}
export async function DELETE(request: NextRequest) {
  try { const { uid } = await googleUser(request); const data = await googleBody(request); return googleResponse(await disconnectWorkspace(uid, googleService(data.service))); }
  catch (e) { return googleFailure(e); }
}
