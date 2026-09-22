'use client';
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { MessageSquare, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Prose } from '@/components/ui/typography';
import { AttachmentPreview } from '@/components/task/AttachmentPreview';
import { useReferenceComments } from '@/hooks/useReferenceComments';
import { useAuthStore } from '@/stores/authStore';
import { uploadReferenceAttachment } from '@/lib/firebase/storage';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { linkifyText } from '@/lib/utils';
import type { CommentAttachment, ReferenceComment } from '@/types';

export function ReferenceComments({ projectId, referenceId, legacyComment, canEdit, onDirtyChange, onBusyChange }: {
  projectId: string; referenceId: string; legacyComment?: string; canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const { comments, loading, error: loadError, reload, post, change } = useReferenceComments(projectId, referenceId);
  const user = useAuthStore(state => state.user);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ id: string; content: string; files: File[]; uploaded: CommentAttachment[] } | null>(null);
  const [editing, setEditing] = useState<ReferenceComment | null>(null);
  const [editText, setEditText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { onDirtyChange(Boolean(content || files.length || pending || editing)); }, [content, files.length, pending, editing, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存できませんでした。入力を保持しています。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const submit = () => run(async () => {
    if (!pending && (files.length > 20 || files.some(file => file.size > 10 * 1024 * 1024))) throw new Error('添付は20件まで、1ファイル10MB以下にしてください。');
    const request = pending ?? { id: crypto.randomUUID(), content: content.trim(), files: [...files], uploaded: [] };
    setPending(request);
    for (let index = request.uploaded.length; index < request.files.length; index++) {
      const file = request.files[index];
      if (file.size > 10 * 1024 * 1024) throw new Error('ファイルサイズは10MB以下にしてください。');
      const uploaded = isE2EMockAuthEnabled()
        ? { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file) }
        : await uploadReferenceAttachment(projectId, referenceId, file);
      request.uploaded.push({ id: uploaded.id, name: uploaded.name, type: uploaded.type, size: uploaded.size, url: uploaded.url });
    }
    await post({ id: request.id, content: request.content, authorLabel: user?.displayName ?? 'メンバー', attachments: request.uploaded });
    setContent(''); setFiles([]); setPending(null);
  });
  return <section className="space-y-3" aria-label="関連情報のコメント">
    <h3 className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="size-4" />コメント</h3>
    {legacyComment && <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">以前のコメント</p><Prose className="break-words">{linkifyText(legacyComment)}</Prose></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">コメントを読み込み中…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><Button variant="outline" size="sm" onClick={reload}>再読み込み</Button></div>}
    {comments.map(comment => <article key={comment.id} className="flex gap-3">
      <Avatar className="size-8"><AvatarFallback>{(comment.authorLabel || 'メンバー').slice(0, 2)}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{comment.authorLabel || 'メンバー'}</span>
          <time className="text-xs text-muted-foreground" dateTime={comment.createdAt.toISOString()}>{format(comment.createdAt, 'M/d HH:mm')}{comment.updatedAt.getTime() !== comment.createdAt.getTime() && '（編集済み）'}</time>
          {canEdit && <><Button variant="ghost" size="icon" className="size-6" disabled={busy || !!pending} aria-label="コメントを編集" onClick={() => { setEditing(comment); setEditText(comment.content); }}><Pencil className="size-3" /></Button><Button variant="ghost" size="icon" className="size-6" disabled={busy || !!pending} aria-label="コメントを削除" onClick={() => { if (confirm('このコメントを削除しますか？')) void run(async () => { await change(comment, null); if (editing?.id === comment.id) setEditing(null); }); }}><Trash2 className="size-3" /></Button></>}
        </div>
        {editing?.id === comment.id ? <div className="space-y-2"><Textarea aria-label="コメントを編集" value={editText} onChange={event => setEditText(event.target.value)} maxLength={20000} disabled={busy} /><div className="flex gap-2"><Button size="sm" disabled={busy || (!editText.trim() && !comment.attachments?.length)} onClick={() => void run(async () => { await change(editing, editText); setEditing(null); })}>保存</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>キャンセル</Button></div></div> : <div className="rounded-lg bg-muted p-3"><Prose className="break-words">{linkifyText(comment.content)}</Prose></div>}
        {comment.attachments?.map(file => <AttachmentPreview key={file.id} {...file} />)}
      </div>
    </article>)}
    {canEdit && <div className="rounded-lg border p-3">
      <fieldset disabled={busy || !!pending} className="min-w-0 space-y-2">
        <Textarea aria-label="コメントを書く" placeholder="コメントを書く（画像は貼り付け可能）" rows={3} maxLength={20000} value={content} onChange={event => setContent(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && (content.trim() || files.length)) { event.preventDefault(); void submit(); } }} onPaste={event => {
          const images = Array.from(event.clipboardData.items).filter(item => item.type.startsWith('image/')).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
          if (images.length) { event.preventDefault(); setFiles(old => [...old, ...images]); }
        }} />
        <input ref={input} className="sr-only" aria-label="コメントの添付ファイル" type="file" multiple onChange={event => { setFiles(old => [...old, ...Array.from(event.target.files ?? [])]); event.target.value = ''; }} />
        <Button variant="ghost" size="sm" onClick={() => input.current?.click()}><Paperclip className="mr-1 size-3" />添付を追加</Button>
        {files.map((file, index) => <div key={index} className="flex items-center gap-2 text-xs"><span className="min-w-0 break-all">{file.name}</span><Button variant="ghost" size="sm" aria-label={`${file.name}の添付を外す`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}>外す</Button></div>)}
      </fieldset>
      <div className="flex justify-end"><Button size="sm" disabled={busy || loading || !!loadError || (!pending && !content.trim() && !files.length)} onClick={() => void submit()}>{busy ? '投稿中…' : pending ? '同じ投稿を再試行' : '投稿'}</Button></div>
      {pending && !busy && <p className="text-xs text-muted-foreground">投稿内容を保持しています。再試行しても二重投稿しません。</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
