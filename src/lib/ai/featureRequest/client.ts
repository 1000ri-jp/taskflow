import { parseAnnotationReferences, type AnnotationReference } from './annotations';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { getFirebaseAuth } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { REQUEST_LIST, parsePreparation, parseRequestTurns, requestRecord, type RequestTurn } from './types';
import type { AIProviderType } from '@/types/ai';

async function request(uid: string, path: string, body?: unknown) {
  if (isE2EMockAuthEnabled()) throw new Error('この検証画面からは送信できません。');
  const check = () => { if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('アカウントが切り替わりました。開き直してください。'); };
  check(); const headers = await getAuthHeaders(); check();
  let response: Response;
  try {
    response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new Error(path.endsWith('/tasks') ? '登録を確認できませんでした。要望リストを確認してから再送してください。' : '通信できませんでした。入力内容は残っています。');
  }
  check();
  if (!response.ok) {
    if (path.endsWith('/submit') && response.status === 409) throw new Error('受付済みの内容と異なります。要望リストを確認してください。');
    if (response.status === 401 || response.status === 403) throw new Error('送信先への権限とAIアクセス設定を確認してください。');
    if (path === '/api/ai/feature-request') {
      const failure = await response.json().catch(() => null);
      const messages = ['AI設定で接続を確認してください。', '要望の内容と長さを確認してください。', '要望を整理できませんでした。入力内容は残っています。'];
      if (messages.includes(failure?.error)) throw new Error(failure.error);
    }
    throw new Error(body && path.includes('/tasks') ? '登録を確認できませんでした。要望リストを確認してから再送してください。' : '内容を確認できませんでした。もう一度お試しください。');
  }
  return response.json();
}
export async function requestList(uid: string, projectId: string): Promise<string> {
  const data = await request(uid, `/api/projects/${encodeURIComponent(projectId)}/lists`);
  const matches = Array.isArray(data.lists) ? data.lists.filter((list: { id?: unknown; name?: unknown }) => typeof list.id === 'string' && typeof list.name === 'string' && list.name.trim() === REQUEST_LIST) : [];
  if (matches.length !== 1) throw new Error('「要望」リストを一つに特定できません。送信先を確認してください。');
  return matches[0].id;
}
export async function organizeFeatureRequest(uid: string, projectId: string, turns: RequestTurn[], provider: AIProviderType, model: string, annotations?: AnnotationReference[]) {
  return parsePreparation(await request(uid, '/api/ai/feature-request', { projectId, turns: parseRequestTurns(turns), provider, model, ...(annotations?.length ? { annotations: parseAnnotationReferences(annotations) } : {}) }));
}
export async function registerFeatureRequest(uid: string, projectId: string, title: string, description: string, turns: RequestTurn[], submission?: { id: string; annotations: AnnotationReference[] }): Promise<string> {
  if (!title.trim() || title.trim().length > 32 || !description.trim() || description.length > 6000) throw new Error('タスク名は32文字以内、説明は6000文字以内で入力してください。');
  const record = requestRecord(parseRequestTurns(turns));
  const result = submission
    ? await request(uid, '/api/ai/feature-request/submit', { projectId, requestId: submission.id, title: title.trim(), description: description.trim(), turns, annotations: parseAnnotationReferences(submission.annotations) })
    : await request(uid, `/api/projects/${encodeURIComponent(projectId)}/tasks`, { listId: await requestList(uid, projectId), title: title.trim(), description: `${description.trim()}\n\n---\n要望の原文・聞き取り\n${record}` });
  if (!result.task || typeof result.task.id !== 'string' || !result.task.id) throw new Error('登録結果を確認できませんでした。要望リストを確認してください。');
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return result.task.id;
}
