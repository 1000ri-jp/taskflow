import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { isValidProvider } from '@/lib/ai/providers';
import { isValidSecretaryDate, mergeReview, needsReview, SecretaryError } from '@/lib/secretary/engine';
import { actOnSecretary, actOnIncoming, readSecretary, saveReview } from '@/lib/secretary/repository';
import type { IncomingActionRequest } from '@/lib/secretary/incomingDecisions';
import { interpretSnapshot } from '@/lib/secretary/interpret';
import { interpretIncoming } from '@/lib/secretary/interpretIncoming';
import { incomingNeedsReview } from '@/lib/secretary/incoming';
import type { ActionRequest } from '@/lib/secretary/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function authorize(request: NextRequest) {
  let user;
  try { user = await verifyAuthToken(request.headers.get('Authorization')); }
  catch { throw new Error('UNAUTHORIZED'); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) throw new SecretaryError('FORBIDDEN', 'このアカウントは利用対象外です。');
  return user.uid;
}
function failure(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return json({ error: 'ログインを確認してください。', code: 'UNAUTHORIZED' }, 401);
  if (error instanceof SecretaryError) return json({ error: error.message, code: error.code }, ({ INVALID: 422, CONFLICT: 409, FORBIDDEN: 403, INCOMPLETE: 503, AI_UNAVAILABLE: 503 })[error.code]);
  return json({ error: '取得または保存に失敗しました。情報なしとは判断していません。再取得してください。', code: 'UNAVAILABLE' }, 503);
}
async function body(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 4000) throw new SecretaryError('INVALID', '入力が長すぎます。');
  try { const data = JSON.parse(raw); if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>; }
  catch { /* handled below */ }
  throw new SecretaryError('INVALID', '入力形式を確認してください。');
}
export async function GET(request: NextRequest) {
  try { return json(await readSecretary(await authorize(request))); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const uid = await authorize(request);
    const data = await body(request);
    if (Object.keys(data).some(k => !['provider', 'model'].includes(k)) || typeof data.provider !== 'string' || !isValidProvider(data.provider) ||
      (data.model !== undefined && (typeof data.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(data.model)))) throw new SecretaryError('INVALID', 'AI設定を確認してください。');
    const loaded = await readSecretary(uid);
    const reviewTasks = needsReview(loaded.state, loaded.snapshot, loaded.snapshot.checkedAt);
    const reviewIncoming = incomingNeedsReview(loaded.state, loaded.snapshot);
    if (!reviewTasks && !reviewIncoming) return json(loaded);
    const [taskResult, incomingResult] = await Promise.allSettled([
      reviewTasks ? interpretSnapshot(loaded.snapshot, loaded.state, data.provider, data.model as string | undefined).then(raw => {
        // Validate completeness before either result is saved; a malformed task result
        // must not discard a separately valid incoming review.
        mergeReview(loaded.state, loaded.snapshot, raw, loaded.snapshot.checkedAt, 'validation');
        return raw;
      }) : Promise.resolve(undefined),
      reviewIncoming ? interpretIncoming(loaded.snapshot, loaded.state, data.provider, data.model as string | undefined) : Promise.resolve(undefined),
    ]);
    const result = taskResult.status === 'fulfilled' ? taskResult.value : undefined;
    const incoming = reviewIncoming && incomingResult.status === 'fulfilled' ? { signature: loaded.snapshot.incoming!.signature, raw: incomingResult.value } : undefined;
    if (result === undefined && !incoming) {
      if (taskResult.status === 'rejected') throw taskResult.reason;
      if (incomingResult.status === 'rejected') throw incomingResult.reason;
    }
    const expected = { revision: loaded.state.revision, signature: loaded.snapshot.signature };
    const saved = incoming ? await saveReview(uid, expected, result, incoming) : await saveReview(uid, expected, result);
    const warnings = [taskResult.status === 'rejected' ? '既存タスクのAI整理は完了しませんでした。前回の判断を保持しています。' : null,
      incomingResult.status === 'rejected' ? 'メール・ChatのAI整理は完了しませんでした。今回の連絡は未確認です。' : null].filter((s): s is string => !!s);
    return json(warnings.length ? { ...saved, reviewWarnings: warnings } : saved);
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const uid = await authorize(request);
    const data = await body(request);
    if (data.kind === 'incoming') {
      if (Object.keys(data).some(k => !['kind', 'action', 'candidateId', 'decisionKey', 'revision', 'requestId', 'taskKey', 'reason', 'connectionEpoch'].includes(k))) throw new SecretaryError('INVALID', '連絡の操作内容を確認してください。');
      return json(await actOnIncoming(uid, data as unknown as IncomingActionRequest));
    }
    if (Object.keys(data).some(k => !['action', 'proposalId', 'revision', 'correction', 'dueDate', 'taskKey', 'sourceVersion'].includes(k)) ||
      !['accept', 'next_week', 'next_month', 'reschedule', 'unneeded', 'correct', 'complete', 'cancel', 'undo'].includes(String(data.action)) ||
      ((data.taskKey !== undefined || data.sourceVersion !== undefined) && (!['reschedule', 'unneeded'].includes(String(data.action)) || typeof data.taskKey !== 'string' || data.taskKey.length > 300 || typeof data.sourceVersion !== 'string' || data.sourceVersion.length > 2000)) ||
      typeof data.proposalId !== 'string' || data.proposalId.length > 100 || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 ||
      (data.action === 'reschedule' ? !isValidSecretaryDate(data.dueDate) : data.dueDate !== undefined) ||
      (data.correction !== undefined && (typeof data.correction !== 'string' || data.correction.length > 800))) throw new SecretaryError('INVALID', '操作内容を確認してください。');
    return json(await actOnSecretary(uid, data as unknown as ActionRequest));
  } catch (error) { return failure(error); }
}
