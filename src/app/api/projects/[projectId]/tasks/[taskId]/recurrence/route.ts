import { TaskDateValidationError } from '@/lib/task/dateValidation';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { OrganizationError } from '@/lib/task/organizationEngine';
import { saveRecurrence, completeFromBoard } from '@/lib/task/recurrenceRepository';
export const runtime = 'nodejs';
const json = (body: unknown, status=200) => NextResponse.json(body, { status, headers:{ 'Cache-Control':'no-store' } });
export async function POST(request: NextRequest, context: { params: Promise<{projectId:string;taskId:string}> }) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); } catch { return json({error:'ログインを確認してください。'},401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) return json({error:'利用権限を確認してください。'},403);
  try {
    const text = await request.text(); if (text.length > 6000) return json({error:'入力が長すぎます。'},400);
    let input; try { input = JSON.parse(text); } catch { return json({error:'入力内容を確認してください。'},400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({error:'入力内容を確認してください。'},400);
    const { projectId, taskId } = await context.params;
    if (input.action === 'configure' && Object.keys(input).every(k=>['action','expectedVersion','settings'].includes(k))) return json({recurrence:await saveRecurrence(user.uid,projectId,taskId,input.expectedVersion,input.settings)});
    if (input.action === 'complete' && Object.keys(input).every(k=>['action','patch'].includes(k))) { await completeFromBoard(user.uid,projectId,taskId,input.patch); return json({ok:true}); }
    return json({error:'操作内容を確認してください。'},400);
  } catch (error) { if (error instanceof TaskDateValidationError) return json({error:error.message},422); return json({error:error instanceof OrganizationError ? error.message : '保存できませんでした。同じ操作を再試行してください。'},error instanceof OrganizationError ? error.status : 503); }
}
