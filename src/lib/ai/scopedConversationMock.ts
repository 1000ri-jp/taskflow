// Browser-only workbench. No Firebase or network imports.
import type { DraftRequest, ScopedRequest } from './scopedConversationClient';
import { explicitDescription, type DescriptionOperation, type ScopedConversationView } from './descriptionOperationTypes';
import type { MockSecretary } from '@/lib/secretary/mock';
type Stored = ScopedConversationView & { projectId: string; taskId: string };
const storageKey = (uid: string) => `taskflow-scoped-conversation-lab-v1:${uid}`;
function read(uid: string): Record<string, Stored> { return JSON.parse(localStorage.getItem(storageKey(uid)) ?? '{}'); }
function write(uid: string, records: Record<string, Stored>) { localStorage.setItem(storageKey(uid), JSON.stringify(records)); window.dispatchEvent(new Event('taskflow-scoped-history')); }
function taskData(uid: string, taskId: string) {
  const key = `taskflow-secretary-lab-v1:${uid}`;
  const work: MockSecretary = JSON.parse(localStorage.getItem(key) ?? 'null');
  const task = work?.tasks.find(t => t.taskId === taskId);
  if (!task) throw new Error('架空の仕事を初期化してください。');
  return { task, work, key };
}
export async function mockDescription(uid: string, request: ScopedRequest): Promise<ScopedConversationView> {
  const all = read(uid);
  if (request.action === 'open' && !all[request.conversationId]) {
    const { task } = taskData(uid, request.taskId!);
    all[request.conversationId] = { mode: 'description', conversationId: request.conversationId, title: `${task.title}の説明`, messages: [], projectId: task.projectId, taskId: task.taskId };
    write(uid, all);
  }
  const conversation = all[request.conversationId]; if (!conversation) throw new Error('架空の会話がありません。');
  if (request.action === 'message') {
    const old = conversation.messages.find(m => m.id === request.requestId);
    if (old && old.content !== request.content) throw new Error('同じ依頼IDの内容が違います。');
    if (!old) {
      const { task } = taskData(uid, conversation.taskId); const exact = explicitDescription(request.content!); const now = new Date().toISOString();
      const op: DescriptionOperation = { id: request.requestId!, conversationId: conversation.conversationId, sourceMessageId: request.requestId!, projectId: task.projectId, taskId: task.taskId, taskTitle: task.title,
        source: request.content!, before: task.description, beforeVersion: JSON.stringify(task), after: exact ?? `公開用の紹介文を整え、内容を確認する。`, approval: exact === null ? 'required' : 'explicit', state: 'prepared', afterVersion: null, attempt: 'mock', leaseUntil: 0, createdAt: now };
      conversation.messages.push({ id: request.requestId!, role: 'user', content: request.content!, createdAt: now }, { id: `reply-${request.requestId}`, role: 'assistant', content: op.after, operation: op, createdAt: now });
      write(uid, all);
      if (exact !== null) await mockDescriptionAction(uid, op, 'confirm');
    }
  }
  return read(uid)[request.conversationId];
}
export async function mockDescriptionAction(uid: string, requested: DescriptionOperation, action: 'confirm' | 'undo'): Promise<DescriptionOperation> {
  const all = read(uid); const conversation = all[requested.conversationId];
  const op = conversation?.messages.find(m => m.operation?.id === requested.id)?.operation;
  if (!op) throw new Error('説明変更がありません。');
  if (op.state === 'undone' || action === 'confirm' && op.state === 'applied') return op;
  const { task, work, key } = taskData(uid, op.taskId);
  if (JSON.stringify(task) !== (action === 'undo' ? op.afterVersion : op.beforeVersion)) throw new Error('別の編集があるため変更できません。');
  task.description = action === 'undo' ? op.before : op.after;
  op.state = action === 'undo' ? 'undone' : 'applied'; op.afterVersion = JSON.stringify(task);
  localStorage.setItem(key, JSON.stringify(work)); write(uid, all);
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return op;
}

export async function mockReplyDraft(uid: string, request: DraftRequest): Promise<ScopedConversationView> {
  const all = read(uid); const id = request.conversationId ?? 'mock-reply-mail-1';
  if (request.action === 'open' && !all[id]) {
    all[id] = { mode: 'draft', conversationId: id, title: '紹介文の確認への返信案', projectId: '', taskId: '', sourceUrl: 'https://mail.google.com/mail/#all/mock-mail-1', sourceNotice: '架空のメール。本文抜粋のみ。', messages: [
      { id: 'initial', role: 'user', content: 'このメールへの返信案を作って。', createdAt: new Date().toISOString() },
      { id: 'reply-initial', role: 'assistant', content: 'ご連絡ありがとうございます。紹介文を確認します。\n回答予定：[要確認]', createdAt: new Date().toISOString() },
    ] }; write(uid, all);
  }
  const conversation = all[id]; if (!conversation || conversation.mode !== 'draft') throw new Error('返信案がありません。');
  if (request.action === 'message') {
    const previous = conversation.messages.find(m => m.id === request.requestId);
    if (previous && previous.content !== request.content) throw new Error('同じ依頼IDの内容が違います。');
    if (!previous) {
      conversation.messages.push({ id: request.requestId!, role: 'user', content: request.content!, createdAt: new Date().toISOString() }, { id: `reply-${request.requestId}`, role: 'assistant', content: 'ご連絡ありがとうございます。紹介文を確認します。', createdAt: new Date().toISOString() }); write(uid, all);
    }
  }
  return conversation;
}

export function listMockScoped(uid: string) {
  return Object.values(read(uid)).map(c => ({ id: c.conversationId, mode: c.mode, scope: 'companion' as const, contextType: 'personal' as const, contextId: null, projectId: null, title: c.title, createdBy: uid, createdAt: new Date(c.messages[0]?.createdAt ?? Date.now()), updatedAt: new Date(c.messages.at(-1)?.createdAt ?? Date.now()) })).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
export function deleteMockScoped(uid: string, id: string) { const all = read(uid); delete all[id]; write(uid, all); }
