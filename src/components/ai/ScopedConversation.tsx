'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChatInput } from './ChatInput';
import { ToolConfirmDialog } from './ToolConfirmDialog';
import { requestDescription, requestReplyDraft, unsavedReply, updateDescription } from '@/lib/ai/scopedConversationClient';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import type { DescriptionOperation, ScopedConversationView } from '@/lib/ai/descriptionOperationTypes';

const pendingInputs = new Map<string, { id: string; content: string }>();
export function ScopedConversation({ userId, conversationId, mode, onBack }: { userId: string; conversationId: string; mode: 'description' | 'draft'; onBack: () => void }) {
  const [sentInput, setSentInput] = useState<{ id: string; content: string }>();
  const [view, setView] = useState<ScopedConversationView | null>(null);
  const [unsaved, setUnsaved] = useState(() => unsavedReply(userId, conversationId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DescriptionOperation | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true); const key = `${userId}:${conversationId}`;
  const requestConversation = mode === 'draft' ? requestReplyDraft : requestDescription;
  const { provider, getActiveModel } = useAISettingsStore();
  useEffect(() => {
    alive.current = true;
    void requestConversation(userId, { action: 'read', conversationId }).then(v => { if (alive.current) { setView(v); setUnsaved(unsavedReply(userId, conversationId)); } }).catch(e => { if (alive.current) { setView(null); setError(e.message); } });
    return () => { alive.current = false; };
  }, [userId, conversationId, requestConversation]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [view?.messages.length]);
  async function send(content: string, savedId?: string) {
    if (busy) return false;
    const pending = pendingInputs.get(key);
    const request = savedId ? { id: savedId, content } : pending?.content === content ? pending : { id: crypto.randomUUID(), content };
    pendingInputs.set(key, request); setBusy(true); setError(null);
    try {
      const next = await requestConversation(userId, { action: 'message', conversationId, requestId: request.id, content }, provider, getActiveModel());
      pendingInputs.delete(key);
      if (alive.current) { setUnsaved(unsavedReply(userId, conversationId)); setSentInput(request); }
      if (alive.current) setView(next);
      window.dispatchEvent(new Event('taskflow-work-updated'));
      return true;
    } catch (e) { if (alive.current) { if (e && typeof e === 'object' && 'status' in e && e.status === 403) setView(null); setUnsaved(unsavedReply(userId, conversationId)); setError(e instanceof Error ? e.message : '保存できませんでした。入力を残しています。'); } return false; }
    finally { if (alive.current) setBusy(false); }
  }
  async function act(op: DescriptionOperation, action: 'confirm' | 'undo') {
    if (busy) return; setBusy(true); setError(null);
    try {
      await updateDescription(userId, op, action);
      const next = await requestConversation(userId, { action: 'read', conversationId });
      if (alive.current) { setView(next); setConfirm(null); }
    } catch (e) { if (alive.current) { if (e && typeof e === 'object' && 'status' in e && e.status === 403) setView(null); setError(e instanceof Error ? e.message : '保存結果を確認できません。'); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function copy(messageId: string) {
    setBusy(true); setError(null);
    try {
      const latest = await requestConversation(userId, { action: 'read', conversationId });
      if (!alive.current) return;
      setView(latest); setUnsaved(unsavedReply(userId, conversationId));
      const message = latest.messages.find(m => m.id === messageId && m.role === 'assistant');
      if (!message) throw new Error('返信案を確認できません。');
      await navigator.clipboard.writeText(message.content);
    } catch (e) { if (alive.current) { if (e && typeof e === 'object' && 'status' in e && e.status === 403) setView(null); setError(e instanceof Error ? e.message : 'コピーできませんでした。'); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="border-b px-4 py-2"><Button size="sm" variant="ghost" disabled={busy} onClick={onBack}>通常の会話へ</Button><h3 className="text-sm font-medium">{view?.title ?? '会話を開いています…'}</h3>{view?.sourceUrl && <a className="text-xs underline" href={view.sourceUrl} target="_blank" rel="noopener noreferrer">元のメールを開く</a>}</div>
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {isE2EMockAuthEnabled() && <p className="text-xs text-amber-800">架空データ。変更はこのブラウザだけに保存します。</p>}
      {view?.sourceWarning && <p role="status" className="text-sm text-amber-800">{view.sourceWarning}</p>}
      {view && unsaved && <article className="space-y-2 rounded border p-3 text-sm"><p className="text-amber-800">保存を確認できていない返信案</p><p className="whitespace-pre-wrap">{unsaved.body}</p><Button disabled={busy} size="sm" onClick={() => send(unsaved.content, unsaved.requestId)}>同じ依頼を再試行</Button></article>}
      {view?.sourceUrl && <div className="space-y-2 text-xs text-stone-600"><details><summary>元の情報・取得範囲</summary><p className="whitespace-pre-wrap">{view.sourceNotice}</p></details></div>}
      {view?.messages.length === 0 && <p className="text-sm text-muted-foreground">説明をどう直すか入力してください。</p>}
      {view?.messages.map(m => <article key={m.id} className="space-y-2 rounded border p-3 text-sm">
        <p className="text-xs text-muted-foreground">{m.role === 'user' ? 'あなた' : mode === 'draft' ? '返信案' : '説明案'}</p><p className="whitespace-pre-wrap break-words">{m.content}</p>
        {m.sourceWarning && <p className="text-xs text-amber-800">{m.sourceWarning}</p>}
        {(m.retry || m.operation && ['preparing', 'failed'].includes(m.operation.state)) && <Button size="sm" variant="outline" disabled={busy} onClick={() => send(m.content, m.id)}>同じ依頼を再試行</Button>}
        {mode === 'draft' && m.role === 'assistant' && <Button size="sm" variant="outline" disabled={busy} onClick={() => copy(m.id)}>本文をコピー</Button>}
        {m.operation && <div>{m.operation.state === 'prepared' ? <Button size="sm" disabled={busy} onClick={() => setConfirm(m.operation!)}>変更前後を確認</Button> : m.operation.state === 'applied' ? <><p role="status">説明を変更しました。</p><Button size="sm" variant="ghost" disabled={busy} onClick={() => act(m.operation!, 'undo')}>戻す</Button></> : m.operation.state === 'undone' ? <p role="status">変更を取り消しました。</p> : null}</div>}
      </article>)}
      <div ref={endRef} />
    </div>
    {error && <p role="alert" className="border-t p-3 text-sm text-destructive">{error}</p>}
    <ChatInput draftKey={key} sentInput={sentInput} onSend={content => send(content)} isLoading={busy} disabled={!view} placeholder={mode === 'draft' ? '返信案を短くして…' : '説明を短く整理して…'} />
    {confirm && <ToolConfirmDialog open onOpenChange={open => { if (!open && !busy) setConfirm(null); }}
      toolCalls={[{ id: confirm.id, name: 'update_task', arguments: { taskId: confirm.taskId, taskTitle: confirm.taskTitle, description: confirm.after } }]}
      descriptionChange={{ before: confirm.before, after: confirm.after }} onConfirm={() => act(confirm, 'confirm')} onCancel={() => setConfirm(null)} isExecuting={busy} />}
  </div>;
}
