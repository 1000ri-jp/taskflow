'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Bell, ListChecks, Paperclip, X } from 'lucide-react';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { uploadCommentAttachment } from '@/lib/firebase/storage';
import { loadPendingComment, pendingCommentKey, validateCommentSubmission, type CommentSubmission } from '@/lib/task/commentSubmission';
import type { ChecklistMemberState } from './ChecklistItemAssignees';
import type { CommentAttachment } from '@/types';

type CommentMembers = ChecklistMemberState & { refresh: () => void };
interface Props { projectId: string; taskId: string; authorId: string; authorName: string; members: CommentMembers }
export function CommentComposer({ projectId, taskId, authorId, authorName, members }: Props) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [retainedAttachments, setRetainedAttachments] = useState<CommentAttachment[]>([]);
  const [notify, setNotify] = useState(false);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [request, setRequest] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [pending, setPending] = useState<CommentSubmission | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const guard = useRef(false);
  const mounted = useRef(true);
  const uploads = useRef(new Map<File, CommentAttachment>());
  const key = pendingCommentKey(authorId, projectId, taskId);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => {
      if (!mounted.current) return;
      try {
        const saved = loadPendingComment(authorId, projectId, taskId);
        if (saved) {
          setRetainedAttachments(saved.attachments);
          setPending(saved); setContent(saved.content); setNotify(saved.notifyIds.length > 0); setNotifyIds(saved.notifyIds);
          setReview(Boolean(saved.review)); setRequest(saved.review?.content ?? ''); setAssigneeIds(saved.review?.assigneeIds ?? []); setDueDate(saved.review?.dueDate ?? '');
          setError('前回の投稿結果を確認してください。「同じ投稿を再試行」で二重登録せずに結果を確認できます。');
        }
        setHydrated(true);
      } catch { setError('送信状態を読み込めません。このタブでは投稿を停止しています。ブラウザの保存設定を確認してください。'); }
    });
    return () => { mounted.current = false; };
  }, [authorId, projectId, taskId]);

  const submit = async () => {
    if (guard.current || !hydrated) return;
    guard.current = true; setBusy(true); setError(''); setSuccess('');
    let frozen = pending;
    try {
      if (!frozen) {
        if ((notify || review) && (members.isLoading || members.hasError)) throw new Error('メンバーを読み込んでから投稿してください。');
        if (notify && !notifyIds.length) throw new Error('通知先を選んでください。');
        const draft: CommentSubmission = { id: crypto.randomUUID(), projectId, taskId, authorId, authorName,
          content: content.trim(), notifyIds: notify ? notifyIds : [],
          review: review ? { content: request.trim(), assigneeIds, dueDate: dueDate || null } : null, attachments: retainedAttachments };
        // Validate before uploads; files themselves are not serialized in the pending receipt.
        if (files.length + retainedAttachments.length > 10) throw new Error('添付は10件までです。');
        validateCommentSubmission({ ...draft, content: draft.content || (files.length ? '添付' : '') });
        for (const file of files) {
          if (!uploads.current.has(file)) uploads.current.set(file, await uploadCommentAttachment(projectId, taskId, file));
        }
        frozen = { ...draft, attachments: [...retainedAttachments, ...files.map(file => uploads.current.get(file)!)] };
        validateCommentSubmission(frozen);
        // Persist the exact operation before sending. Reload/retry uses the same receipt ID.
        sessionStorage.setItem(key, JSON.stringify(frozen));
        if (mounted.current) setPending(frozen);
      }
      const result = await submitTaskComment(frozen);
      sessionStorage.removeItem(key);
      if (!mounted.current) return;
      setPending(null); setContent(''); setFiles([]); setRetainedAttachments([]); setNotify(false); setNotifyIds([]);
      setReview(false); setRequest(''); setAssigneeIds([]); setDueDate(''); uploads.current.clear();
      setSuccess(result.alreadySubmitted ? '投稿済みであることを確認しました。重複登録・再通知はしていません。' : result.reviewTaskId ? 'コメントと確認依頼を共有登録しました。依頼先のマイタスクに表示されます。' : 'コメントを投稿しました。');
    } catch (cause) {
      if (!mounted.current) return;
      // This rejection is issued only after the transaction verified no receipt exists.
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'submission-rejected') {
        try { sessionStorage.removeItem(key); setPending(null); } catch { /* retain frozen retry state */ }
      }
      setError(cause instanceof Error ? cause.message : '投稿の結果を確認できません。接続・権限を確認して再試行してください。');
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const locked = busy || Boolean(pending) || !hydrated;
  return <section aria-label="コメント投稿" className="rounded-lg border p-3">
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <Textarea value={content} onChange={e => setContent(e.target.value)} maxLength={20000}
        onPaste={event => {
          const pasted = Array.from(event.clipboardData.items).filter(item => item.type.startsWith('image/')).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
          if (pasted.length) { event.preventDefault(); setFiles(old => [...old, ...pasted]); }
        }} placeholder="コメントを書く（画像は貼り付け可能）" rows={3} className="resize-none break-all border-none p-0 shadow-none focus-visible:ring-0" />
      <div className="flex flex-wrap gap-2 text-xs">
        {!pending && files.map((file, index) => <span key={index} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1"><PendingImage file={file} /><span className="truncate">{file.name}</span><button type="button" aria-label={`${file.name}の添付を外す`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button></span>)}
        {!pending && retainedAttachments.map(file => <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1"><span className="truncate">添付：{file.name}</span><button type="button" aria-label={`${file.name}の添付を外す`} onClick={() => setRetainedAttachments(old => old.filter(item => item.id !== file.id))}><X className="h-3 w-3" /></button></span>)}
        {pending?.attachments.map(file => <span key={file.id} className="max-w-full truncate rounded bg-muted px-2 py-1">添付：{file.name}</span>)}
      </div>
      {notify && <Recipients label="通知先" members={members} selected={notifyIds} onChange={setNotifyIds} />}
      {review && <div className="space-y-3 rounded-md bg-muted/40 p-3">
        <label className="block space-y-1 text-xs font-medium"><span>依頼内容</span><Textarea value={request} onChange={e => setRequest(e.target.value)} placeholder="何を確認してほしいか" rows={2} maxLength={2000} /></label>
        <Recipients label="依頼先担当者" members={members} selected={assigneeIds} onChange={setAssigneeIds} />
        <label className="block space-y-1 text-xs font-medium"><span>確認期限（任意）</span><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">依頼先のサブタスクとして共有登録し、依頼先に通知します。複数担当の場合も1件の依頼・共通の完了状態です。</p>
      </div>}
    </fieldset>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} disabled={locked} onChange={e => setNotify(e.target.checked)} /><Bell className="h-4 w-4" />メンバーに通知</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={review} disabled={locked} onChange={e => setReview(e.target.checked)} /><ListChecks className="h-4 w-4" />確認依頼</label>
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground"><Paperclip className="h-4 w-4" />添付を追加<input type="file" aria-label="コメントの添付ファイル" multiple disabled={locked} className="sr-only" onChange={e => { setFiles(old => [...old, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} /></label>
      </div>
      <Button type="button" size="sm" onClick={submit} disabled={busy || !hydrated || (!pending && !content.trim() && !files.length && !retainedAttachments.length && !review)}>{busy ? '投稿・共有保存中…' : pending ? '同じ投稿を再試行' : review ? 'コメントと確認依頼を投稿' : 'コメントを投稿'}</Button>
    </div>
    {error && <p role="alert" className="mt-3 break-words text-xs text-destructive">{error}</p>}
    {pending && <p className="mt-2 text-xs text-muted-foreground">送信内容をこのタブに保持しています。再試行しても同じ投稿を二重登録しません。確認が済むまで内容の編集はできません。</p>}
    {success && <p role="status" className="mt-3 text-xs text-emerald-700">{success}</p>}
  </section>;
}

function PendingImage({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const next = URL.createObjectURL(file);
    let active = true;
    Promise.resolve().then(() => { if (active) setUrl(next); });
    return () => { active = false; URL.revokeObjectURL(next); };
  }, [file]);
  // Uploaded files use the existing attachment viewer; this is a temporary blob preview.
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={`${file.name}のプレビュー`} className="h-16 w-20 rounded object-contain" /> : null;
}

function Recipients({ label, members, selected, onChange }: { label: string; members: CommentMembers; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="min-w-0 rounded border p-2"><legend className="px-1 text-xs font-medium">{label}（複数可）</legend>
    {members.isLoading ? <p role="status" className="text-xs">メンバーを読み込み中…</p> : members.hasError ? <p role="alert" className="text-xs text-destructive">メンバーを取得できません。<button type="button" className="ml-2 underline" onClick={members.refresh}>再試行</button></p> : <>
      <Button type="button" size="sm" variant="ghost" className="mb-1 h-6 text-xs" onClick={() => onChange(members.users.map(user => user.id))}>全員を選択</Button>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{members.users.map(member => <label key={member.id} className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={selected.includes(member.id)} onChange={e => onChange(e.target.checked ? [...selected, member.id] : selected.filter(id => id !== member.id))} />{member.displayName}</label>)}</div>
      {!members.users.length && <p className="text-xs">選択できるメンバーがいません。</p>}
    </>}
  </fieldset>;
}
