import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { readTaskHistory } from '@/lib/task/history/repository';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }) {
  let uid: string;
  // Personal evidence is available only to the signed-in owner, never an API-token actor.
  try { uid = (await verifyAuthToken(request.headers.get('Authorization'))).uid; }
  catch { return json({ error: 'ログインを確認してください。' }, 401); }
  try {
    const { projectId, taskId } = await context.params;
    if (![projectId, taskId].every(id => /^[^/]{1,200}$/.test(id))) return json({ error: 'タスクの指定を確認してください。' }, 400);
    await getProjectAccess(uid, projectId, null, null, 'tasks:read');
    return json(await readTaskHistory(uid, projectId, taskId, request.nextUrl.searchParams.get('cursor')));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'FORBIDDEN') return json({ error: 'このプロジェクトを閲覧する権限がありません。' }, 403);
    if (message === 'NOT_FOUND') return json({ error: 'タスクを確認できません。' }, 404);
    if (message === 'INVALID_CURSOR') return json({ error: '履歴を再取得してください。' }, 400);
    return json({ error: '経緯を取得できませんでした。再取得してください。' }, 503);
  }
}
