import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { DescriptionOperation, ScopedConversationView, UnsavedDraft } from './descriptionOperationTypes';
export class ScopedRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export interface ScopedRequest { action: 'open' | 'read' | 'message'; conversationId: string; projectId?: string; taskId?: string; requestId?: string; content?: string }
export async function requestDescription(uid: string, request: ScopedRequest, provider = 'gemini', model?: string): Promise<ScopedConversationView> {
  if (isE2EMockAuthEnabled()) return (await import('./scopedConversationMock')).mockDescription(uid, request);
  const response = await fetch('/api/ai/chat', { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ description: request, provider, model }) });
  const result = await response.json(); if (!response.ok) throw new ScopedRequestError(result.error || '会話を保存できませんでした。', response.status);
  return result;
}
export async function updateDescription(uid: string, operation: DescriptionOperation, action: 'confirm' | 'undo'): Promise<DescriptionOperation> {
  if (isE2EMockAuthEnabled()) return (await import('./scopedConversationMock')).mockDescriptionAction(uid, operation, action);
  const response = await fetch(`/api/projects/${encodeURIComponent(operation.projectId)}/tasks/${encodeURIComponent(operation.taskId)}`, {
    method: 'PATCH', headers: await getAuthHeaders(), body: JSON.stringify({ aiDescriptionOperation: { operationId: operation.id, action } }),
  });
  const result = await response.json(); if (!response.ok) throw new ScopedRequestError(result.error || '変更結果を確認できませんでした。同じ操作を再試行できます。', response.status);
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return result;
}
export function showScopedConversation(uid: string, conversationId: string, mode: 'description' | 'draft') {
  window.dispatchEvent(new CustomEvent('taskflow-open-conversation', { detail: { userId: uid, conversationId, mode } }));
}

export interface DraftRequest { action: 'open' | 'read' | 'message'; conversationId?: string; sourceId?: string; candidateId?: string; signature?: string; requestId?: string; content?: string }
export async function requestReplyDraft(uid: string, request: DraftRequest, provider = 'gemini', model?: string): Promise<ScopedConversationView> {
  if (isE2EMockAuthEnabled()) return (await import('./scopedConversationMock')).mockReplyDraft(uid, request);
  const response = await fetch('/api/ai/chat', { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ draft: request, provider, model }) });
  const result = await response.json();
  if (!response.ok) {
    if (result.unsaved) {
      sessionStorage.setItem(`taskflow-unsaved-reply:${uid}:${result.unsaved.conversationId}`, JSON.stringify(result.unsaved));
      showScopedConversation(uid, result.unsaved.conversationId, 'draft');
    }
    throw new ScopedRequestError(result.error || '返信案の保存結果を確認できません。同じ依頼を再試行できます。', response.status);
  }
  const unsaved = unsavedReply(uid, result.conversationId);
  if (unsaved && result.messages.some((m: { id: string }) => m.id === `reply-${unsaved.requestId}`)) sessionStorage.removeItem(`taskflow-unsaved-reply:${uid}:${result.conversationId}`);
  return result;
}

export function unsavedReply(uid: string, conversationId: string): UnsavedDraft | null {
  try { return JSON.parse(sessionStorage.getItem(`taskflow-unsaved-reply:${uid}:${conversationId}`) ?? 'null'); } catch { return null; }
}
