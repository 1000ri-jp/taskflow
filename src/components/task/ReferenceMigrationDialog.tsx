'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Archive, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Comment, CommentAttachment, Task } from '@/types';
import { useListReferences } from '@/hooks/useListReferences';

function extractLinks(text: string) {
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map(match => match[0].replace(/[。、，,]+$/, ''));
  return [...new Set(urls)].map((url, index) => ({ id: `migration-link-${index}`, label: `本文のリンク${index + 1}`, url }));
}

export function ReferenceMigrationDialog({ task, projectId, comments, commentAttachments, hasBlockers, onUpdate, userId }: {
  task: Task;
  projectId: string;
  comments: Comment[];
  commentAttachments: CommentAttachment[];
  hasBlockers: boolean;
  onUpdate: (patch: Partial<Task>) => void | Promise<void>;
  userId: string;
}) {
  const { references, create, update } = useListReferences(projectId, task.listId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const conversionId = `migration-${projectId}-${task.id}-${task.updatedAt.getTime()}`;
  const links = useMemo(() => extractLinks([task.description, ...comments.map(comment => comment.content)].join('\n')), [comments, task.description]);
  const body = useMemo(() => [`元タスク「${task.title}」からの移行です。`, `元タスクを開く: /projects/${projectId}/board?task=${task.id}`, '', task.description, comments.length ? `\n元のやり取り:\n${comments.map(comment => `${comment.authorLabel ?? comment.authorId}（${comment.createdAt.toLocaleString('ja-JP')}）\n${comment.content}`).join('\n\n')}` : ''].filter(Boolean).join('\n'), [comments, projectId, task.description, task.id, task.title]);
  const existing = references.find(reference => reference.sourceTaskId === task.id);

  const confirm = async () => {
    setError('');
    if (existing) { setError('このタスクからの移行記録は既にあります。重複作成しません。'); return; }
    setBusy(true);
    try {
      const id = await create({ title: task.title === '情報' ? '関連情報' : task.title, body, links, conversionId, sourceTaskId: task.id });
      if (commentAttachments.length) await update(id, { attachments: commentAttachments.map(attachment => ({ ...attachment, referenceId: id, uploadedBy: userId, uploadedAt: new Date() })) });
      if (!hasBlockers) await onUpdate({ isArchived: true, archivedAt: new Date(), archivedBy: userId });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移行できませんでした。元タスクは変更していません。');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setError(''); setOpen(true); }}><ArrowRight className="mr-1 size-3" />関連情報へ移す</Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>関連情報への移行を確認</DialogTitle><DialogDescription>本文・コメントからURLを候補として表示しています。内容を確認してから確定します。</DialogDescription></DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto text-sm">
          {hasBlockers && <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">子タスク、未処理の手順、確認依頼、依存関係、自動処理があるため、元タスクは保管しません。関連情報だけ追加します。</p>}
          <div><p className="font-medium">タイトル</p><p className="mt-1 rounded border p-2">{task.title === '情報' ? '関連情報' : task.title}</p></div>
          <div><p className="font-medium">メモ・元のやり取り</p><pre className="mt-1 whitespace-pre-wrap break-words rounded border bg-muted/30 p-2 text-xs">{body}</pre></div>
          <div><p className="font-medium">URL候補</p>{links.length ? <ul className="mt-1 space-y-1">{links.map(link => <li key={link.id} className="flex gap-1 break-all text-xs"><Link2 className="mt-0.5 size-3 shrink-0" />{link.url}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">URL候補はありません。</p>}</div>
          {commentAttachments.length > 0 && <p className="text-xs text-muted-foreground">添付 {commentAttachments.length}件も関連情報へ引き継ぎます。</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>キャンセル</Button><Button onClick={() => void confirm()} disabled={busy}><Archive className="mr-1 size-3" />{busy ? '処理中…' : hasBlockers ? '関連情報を追加' : '移行して元タスクを保管'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
