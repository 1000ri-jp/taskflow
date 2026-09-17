import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { AutomationError, changeAutomationReminder, readAutomation, runTaskAutomation, saveAutomationRule, saveCompletionPolicy, undoAutomation } from '@/lib/task/automationRepository';
import type { AllChildrenCompletionPolicy, TaskEvidenceRule } from '@/lib/task/automationTypes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
async function authorize(request: NextRequest) {
  let user; try { user = await verifyAuthToken(request.headers.get('Authorization')); } catch { throw new AutomationError('ログインを確認してください。', 401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new AutomationError('会社のアカウントでログインしてください。', 403);
  return user.uid;
}
function failure(error: unknown) { return error instanceof AutomationError ? json({ error: error.message }, error.status) : json({ error: '自動更新の取得・反映を確認できません。確定した状態は保持しています。' }, 503); }
function completionPolicy(value: unknown): Pick<AllChildrenCompletionPolicy, 'condition' | 'required'> | null {
  if (value === null) return null;
  const invalid = () => new AutomationError('必要な担当ごとのサブタスクと、全員分の完了条件を指定してください。');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('condition' in value) || typeof value.condition !== 'string' || !value.condition.trim() || value.condition.length > 500 || !('required' in value) || !Array.isArray(value.required) || value.required.length < 1 || value.required.length > 40) throw invalid();
  const required = value.required.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('taskId' in row) || typeof row.taskId !== 'string' || !/^[^/]{1,200}$/.test(row.taskId) || !('assigneeId' in row) || typeof row.assigneeId !== 'string' || !/^[^/]{1,200}$/.test(row.assigneeId)) throw invalid();
    return { taskId: row.taskId, assigneeId: row.assigneeId };
  });
  if (new Set(required.map(row => row.taskId)).size !== required.length || new Set(required.map(row => row.assigneeId)).size !== required.length) throw invalid();
  return { condition: value.condition, required };
}
export async function GET(request: NextRequest) { try { return json(await readAutomation(await authorize(request))); } catch (e) { return failure(e); } }
export async function POST(request: NextRequest) {
  try {
    const uid = await authorize(request); const raw = await request.text();
    if (raw.length > 12000) throw new AutomationError('入力が長すぎます。');
    let body; try { body = JSON.parse(raw); } catch { throw new AutomationError('入力形式を確認してください。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AutomationError('入力形式を確認してください。');
    if (body.action === 'run' && Object.keys(body).length === 1) return json(await runTaskAutomation(uid));
    if (body.action === 'save' && Number.isSafeInteger(body.revision)) return json(await saveAutomationRule(uid, body.rule as TaskEvidenceRule, body.revision));
    if (!['projectId', 'taskId'].every(k => typeof body[k] === 'string' && /^[^/]{1,200}$/.test(body[k]))) throw new AutomationError('対象タスクを確認してください。');
    if (body.action === 'policy') {
      if (typeof body.expectedUpdatedAt !== 'string') throw new AutomationError('親タスクの更新日時を確認してください。', 409);
      return json(await saveCompletionPolicy(uid, body.projectId, body.taskId, completionPolicy(body.policy), body.expectedUpdatedAt));
    }
    if (body.action === 'reminder' && (body.until === null || typeof body.until === 'string')) return json(await changeAutomationReminder(uid, body.projectId, body.taskId, body.until));
    if (body.action === 'undo' && typeof body.recordId === 'string' && Number.isSafeInteger(body.revision)) return json(await undoAutomation(uid, body.projectId, body.taskId, body.recordId, body.revision));
    throw new AutomationError('操作を確認してください。');
  } catch (e) { return failure(e); }
}
