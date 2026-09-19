import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { OrganizationError } from '@/lib/task/organizationEngine';
import { applyWorkflow } from '@/lib/task/workflowRepository';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); } catch { return json({ error: 'ログインを確認してください。' }, 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) return json({ error: '利用権限を確認してください。' }, 403);
  try {
    const text = await request.text();
    if (text.length > 12000) return json({ rejected: true, error: '入力が長すぎます。' }, 400);
    let input; try { input = JSON.parse(text); } catch { return json({ rejected: true, error: '操作内容を確認してください。' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['id','action','expectedVersion','note','details','attachments','subtaskPatch','parentTaskId'].includes(k))) return json({ rejected: true, error: '操作内容を確認してください。' }, 400);
    const { projectId, taskId } = await context.params;
    return json(await applyWorkflow(user.uid, projectId, taskId, input));
  } catch (error) { return json({ rejected: error instanceof OrganizationError, error: error instanceof OrganizationError ? error.message : '保存できませんでした。同じ操作を再試行してください。' }, error instanceof OrganizationError ? error.status : 503); }
}
