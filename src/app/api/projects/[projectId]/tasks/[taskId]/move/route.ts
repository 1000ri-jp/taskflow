import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { OrganizationError } from '@/lib/task/organizationEngine';
import { locateMovedTask, moveProjectTask, projectMoveContext } from '@/lib/task/projectMoveRepository';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); } catch { return json({ rejected: true, error: 'ログインを確認してください。' }, 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) return json({ rejected: true, error: '利用権限を確認してください。' }, 403);
  try {
    const text = await request.text();
    if (text.length > 4000) throw new OrganizationError('入力が長すぎます。', 400);
    let input; try { input = JSON.parse(text); } catch { throw new OrganizationError('操作内容を確認してください。', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'id', 'targetProjectId', 'listId', 'version'].includes(key))) throw new OrganizationError('操作内容を確認してください。', 400);
    const { projectId, taskId } = await context.params;
    if (input.action === 'context') return json(await projectMoveContext(user.uid, projectId, taskId));
    if (input.action === 'locate') return json(await locateMovedTask(user.uid, projectId, taskId));
    if (!['preview', 'move'].includes(input.action)) throw new OrganizationError('操作内容を確認してください。', 400);
    const { action, ...move } = input;
    return json(await moveProjectTask(user.uid, projectId, taskId, move, action === 'move'));
  } catch (error) {
    return json({ rejected: error instanceof OrganizationError, error: error instanceof OrganizationError ? error.message : '結果を確認できません。同じ操作で再試行してください。' }, error instanceof OrganizationError ? error.status : 503);
  }
}
