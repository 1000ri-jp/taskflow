'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ListChecks, MessageSquare, Paperclip, X } from 'lucide-react';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { uploadCommentAttachment } from '@/lib/firebase/storage';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { CommentRecipients } from './CommentRecipients';
import { frequentRecipientIds, rememberRecipients } from '@/lib/comments/frequentRecipients';
import { ControlHint } from '@/components/ui/control-hint';
import { COMMENT_PURPOSE_LABELS, loadPendingComment, pendingCommentKey, validateCommentSubmission, type CommentSubmission } from '@/lib/task/commentSubmission';
import type { ChecklistMemberState } from './ChecklistItemAssignees';
import type { CommentAttachment, CommentPurpose, Task } from '@/types';

import { TaskMaterials } from './TaskMaterials';
import { taskVersion } from '@/lib/task/workflow';

export interface ReviewComposerContext { request: string; assigneeIds: string[]; nextTaskId: string; policy: 'any' | 'all'; sourceLabel: string; expectedVersion: string }
type CommentMembers = ChecklistMemberState & { refresh: () => void };
interface Props { projectId: string; taskId: string; authorId: string; authorName: string; members: CommentMembers; parentAssigneeIds?: string[]; tasks?: Task[]; reviewContext?: ReviewComposerContext; availableAttachments?: CommentAttachment[]; onSubmitted?: (message: string) => void }
export function CommentComposer({ projectId, taskId, authorId, authorName, members, parentAssigneeIds, tasks = [], reviewContext, availableAttachments = [], onSubmitted }: Props) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [retainedAttachments, setRetainedAttachments] = useState<CommentAttachment[]>([]);
  const [frequentIds, setFrequentIds] = useState<string[]>([]);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const notify = notifyIds.length > 0;
  const [purpose, setPurpose] = useState<CommentPurpose>(reviewContext ? 'review_request' : 'memo');
  const review = purpose === 'review_request';
  const purposeInputName = useId();
  const [request, setRequest] = useState(reviewContext?.request ?? '');
  const [preparedVersion, setPreparedVersion] = useState(reviewContext?.expectedVersion);
  const currentTask = tasks.find(task => task.projectId === projectId && task.id === taskId);
  const preparationChanged = preparedVersion !== undefined && (!currentTask || taskVersion(currentTask) !== preparedVersion);
  // null follows the parent; an explicit empty selection remains empty.
  const [assigneeOverride, setAssigneeIds] = useState<string[] | null>(reviewContext?.assigneeIds ?? null);
  const assigneeIds = assigneeOverride ?? parentAssigneeIds ?? [];
  const [dueDate, setDueDate] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [policy, setPolicy] = useState<'any' | 'all'>(reviewContext?.policy ?? 'any');
  const [nextTaskId, setNextTaskId] = useState(reviewContext?.nextTaskId ?? '');
  const [editPrepared, setEditPrepared] = useState(false);
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
          setPending(saved); setUrgent(saved.review?.urgency === 'urgent'); setContent(saved.content); setNotifyIds(saved.notifyIds);
          setPurpose(saved.review ? 'review_request' : 'memo'); setRequest(saved.review?.content ?? ''); setAssigneeIds(saved.review?.assigneeIds ?? []); setDueDate(saved.review?.dueDate ?? ''); setPolicy(saved.review?.policy ?? 'any'); setNextTaskId(saved.review?.nextTaskId ?? '');
          setError('前回の投稿結果を確認してください。「同じ投稿を再試行」で二重登録せずに結果を確認できます。');
        }
        setFrequentIds(frequentRecipientIds(authorId, projectId));
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
        if (preparationChanged) throw new Error('仕事の情報が変わりました。確認内容を見直してください。');
        if ((notify || review) && (members.isLoading || members.hasError)) throw new Error('メンバーを読み込んでから投稿してください。');
        const draft: CommentSubmission = { id: crypto.randomUUID(), projectId, taskId, authorId, authorName,
          ...(preparedVersion ? { expectedTaskVersion: preparedVersion } : {}), content: content.trim(), purpose, notifyIds: notify ? notifyIds : [],
          review: review ? { ...(urgent ? { urgency: 'urgent' as const } : {}), content: request.trim(), assigneeIds, dueDate: dueDate || null, ...(policy === 'all' ? { policy } : {}), ...(nextTaskId ? { nextTaskId } : {}) } : null, attachments: retainedAttachments };
        // Validate before uploads; files themselves are not serialized in the pending receipt.
        if (files.length + retainedAttachments.length > 10) throw new Error('添付は10件までです。');
        validateCommentSubmission({ ...draft, content: draft.content || (files.length ? '添付' : '') });
        if (isE2EMockAuthEnabled() && files.length) throw new Error('隔離環境ではファイルをアップロードしません。');
        for (const file of files) {
          if (!uploads.current.has(file)) uploads.current.set(file, await uploadCommentAttachment(projectId, taskId, file));
        }
        frozen = { ...draft, attachments: [...retainedAttachments, ...files.map(file => uploads.current.get(file)!)] };
        validateCommentSubmission(frozen);
        // Persist the exact operation before sending. Reload/retry uses the same receipt ID.
        sessionStorage.setItem(key, JSON.stringify(frozen));
        if (mounted.current) {
          setPending(frozen);
          if (frozen.review) setAssigneeIds(frozen.review.assigneeIds);
        }
      }
      const result = await submitTaskComment(frozen);
      rememberRecipients(authorId, projectId, frozen.id, [...frozen.notifyIds, ...(frozen.review?.assigneeIds ?? [])]);
      sessionStorage.removeItem(key);
      const message = isE2EMockAuthEnabled() ? '隔離データへ投稿しました。実際の通知は送っていません。' : result.alreadySubmitted ? '投稿済みであることを確認しました。重複登録・再通知はしていません。' : result.reviewTaskId ? `${frozen.review?.assigneeIds.map(id => members.users.find(member => member.id === id)?.displayName ?? 'メンバー').join('、')}に確認を依頼しました。次は確認担当の返答を待ちます。依頼先のマイタスク・通知に追加しました。`  : '共有メモ・報告を投稿しました。';
      onSubmitted?.(message);
      if (!mounted.current) return;
      setPending(null); setUrgent(false); setContent(''); setFiles([]); setRetainedAttachments([]); setNotifyIds([]);
      setFrequentIds(frequentRecipientIds(authorId, projectId));
      setPurpose(reviewContext ? 'review_request' : 'memo'); setRequest(reviewContext?.request ?? ''); setAssigneeIds(reviewContext?.assigneeIds ?? null); setDueDate(''); setPolicy(reviewContext?.policy ?? 'any'); setNextTaskId(reviewContext?.nextTaskId ?? ''); uploads.current.clear();
      setSuccess(message);
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
  const recipients = [...new Set([...(review ? assigneeIds : []), ...notifyIds])].filter(id => id !== authorId);
  const notificationMembers = { ...members, users: members.users.filter(member => member.id !== authorId) };
  const recipientNames = recipients.map(id => members.users.find(member => member.id === id)?.displayName || '名前を確認できないメンバー').join('、');
  const notificationSummary = review && !assigneeIds.length ? '確認する人を選ぶと、その人に通知します。'
    : recipients.length ? `通知：${recipientNames}（${recipients.length}人）` : '通知なし';
  const prepared = Boolean(reviewContext && request.trim() && assigneeIds.length && !members.isLoading && !members.hasError && assigneeIds.every(id => members.users.some(member => member.id === id)) && !preparationChanged && (!nextTaskId || tasks.some(t => t.projectId === projectId && t.id === nextTaskId && !t.isCompleted && !t.isArchived && !t.isAbandoned)));
  const nextJob = <label className="block text-xs">確認OKのあとに進む仕事<select aria-label="確認OKのあとに進む仕事" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={nextTaskId} onChange={e => setNextTaskId(e.target.value)}><option value="">指定しない</option>{tasks.filter(t => t.projectId === projectId && t.id !== taskId && !t.isArchived && !t.isAbandoned && !t.isCompleted && t.taskKind !== 'review_request').map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>;
  return <section aria-label={reviewContext ? "資料を送って確認を依頼" : "コメント投稿"} className="rounded-lg border bg-white p-3">
    <fieldset disabled={locked} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <fieldset hidden={Boolean(reviewContext)} className="min-w-0" aria-label="投稿の用途">
          <legend className="sr-only">コメント</legend>
          <div className="flex flex-wrap items-center gap-1">{(['memo', 'review_request'] as const).map(value => {
            const Icon = value === 'memo' ? MessageSquare : ListChecks;
            return <ControlHint key={value} label={value === 'memo' ? 'コメント' : '確認依頼'} description={value === 'memo' ? 'プロジェクトのメンバーが読める共有の記録です。' : '確認する人に通知し、親タスク内に確認依頼を残します。'}><label className="cursor-pointer">
              <input type="radio" className="peer sr-only" name={purposeInputName} aria-label={value === 'memo' ? 'コメント' : COMMENT_PURPOSE_LABELS[value]} value={value} checked={purpose === value} onChange={() => { setPurpose(value); setError(''); setSuccess(''); }} />
              <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground peer-checked:border-foreground peer-checked:bg-muted peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-60"><Icon aria-hidden="true" className="h-3.5 w-3.5" />{value === 'memo' ? 'コメント' : '確認依頼'}</span>
            </label></ControlHint>;
          })}</div>
        </fieldset>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring"><Paperclip className="h-4 w-4" />添付を追加<input type="file" aria-label="コメントの添付ファイル" multiple disabled={locked} className="sr-only" onChange={e => { setFiles(old => [...old, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} /></label>
      </div>
      {reviewContext && <p className="text-xs text-muted-foreground">{reviewContext.sourceLabel}</p>}
      {reviewContext && availableAttachments.length > 0 && <div className="space-y-1 text-xs" aria-label="登録済み資料から添付"><p className="text-muted-foreground">登録済み資料から選ぶ</p>{availableAttachments.map(file => <label key={file.url} className="flex items-start gap-2 py-1"><input type="checkbox" checked={retainedAttachments.some(item => item.url === file.url)} onChange={e => setRetainedAttachments(old => e.target.checked ? [...old, file] : old.filter(item => item.url !== file.url))} /><span className="min-w-0 break-all">{file.name}</span></label>)}</div>}
      {reviewContext && retainedAttachments.length > 0 && <TaskMaterials files={retainedAttachments} label="提出する資料" />}
      {review && <div className="space-y-3">
        <label className="inline-flex items-center gap-2 text-xs" title="相手に至急のポップアップを表示します"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />至急</label>
        {prepared && !editPrepared && <div className="space-y-2 text-sm"><p className="whitespace-pre-wrap break-words">{request}</p><p className="text-xs">確認：{assigneeIds.map(id => members.users.find(member => member.id === id)?.displayName ?? '名前は未取得').join('、')} · {policy === 'all' ? '全員の確認OK' : '誰か1人の確認OK'}{dueDate ? ` · 期限 ${dueDate}` : ''}</p><p className="text-xs">確認OK後：{tasks.find(t => t.id === nextTaskId)?.title ?? '作業担当へ返す'}</p></div>}
        {prepared && <button type="button" className="text-xs text-primary underline" aria-expanded={editPrepared} onClick={() => setEditPrepared(value => !value)}>{editPrepared ? '確認表示に戻す' : '内容・相手を変える'}</button>}
        <div hidden={prepared && !editPrepared} className="space-y-3">
        <label className="block space-y-1 text-xs font-medium"><span>確認してほしいこと</span><Textarea value={request} onChange={e => { setRequest(e.target.value); setEditPrepared(true); }} placeholder="何を確認してほしいか" rows={2} maxLength={2000} /></label>
        <CommentRecipients label="確認する人" members={members} selected={assigneeIds} onChange={ids => { setAssigneeIds(ids); setEditPrepared(true); }} frequentIds={frequentIds} disabled={locked} />
        <label className="flex flex-wrap items-center gap-2 text-xs font-medium"><span>確認期限（任意）</span><Input type="date" className="h-7 w-36 px-2 py-1 text-xs leading-4 md:text-xs" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
        {assigneeIds.length > 1 && <label className="flex flex-wrap items-center gap-2 text-xs">確認の完了条件<select aria-label="確認の完了条件" className="h-7 rounded border bg-background px-2" value={policy} onChange={e => setPolicy(e.target.value as 'any'|'all')}><option value="any">誰か1人が確認OK</option><option value="all">全員が確認OK</option></select></label>}
        {reviewContext && nextJob}
        </div>
      </div>}
      {review ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{reviewContext ? '補足・追加の通知先（任意）' : '補足・追加の通知先・確認後の仕事（任意）'}</summary><div className="mt-3 space-y-3">
        <label className="block space-y-1">補足コメント<Textarea aria-label="補足コメント（任意）" rows={2} value={content} maxLength={20000} onChange={e => setContent(e.target.value)} /></label>
        <CommentRecipients label="追加の通知先" members={notificationMembers} selected={notifyIds} onChange={setNotifyIds} frequentIds={frequentIds} disabled={locked} />
        {!reviewContext && nextJob}
      </div></details> : <>
      <label className="block space-y-1">
        <span className={review ? 'text-xs font-medium text-muted-foreground' : 'sr-only'}>{review ? '補足コメント（任意）' : 'メモ・報告の本文'}</span>
        <Textarea value={content} onChange={e => setContent(e.target.value)} maxLength={20000}
        onPaste={event => {
          const pasted = Array.from(event.clipboardData.items).filter(item => item.type.startsWith('image/')).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
          if (pasted.length) { event.preventDefault(); setFiles(old => [...old, ...pasted]); }
        }} placeholder={review ? '補足を書く（画像は貼り付け可能）' : 'コメントを書く（画像は貼り付け可能）'} rows={3} className="resize-none break-all border-none p-0 shadow-none focus-visible:ring-0" />
      </label>
        <CommentRecipients label="通知先" members={notificationMembers} selected={notifyIds} onChange={setNotifyIds} frequentIds={frequentIds} disabled={locked} />
      </>}
      <div className="flex flex-wrap gap-2 text-xs empty:hidden">
        {!pending && files.map((file, index) => <span key={index} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1"><PendingImage file={file} /><span className="truncate">{file.name}</span><button type="button" aria-label={`${file.name}の添付を外す`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button></span>)}
        {!pending && retainedAttachments.map(file => <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1"><span className="truncate">添付：{file.name}</span><button type="button" aria-label={`${file.name}の添付を外す`} onClick={() => setRetainedAttachments(old => old.filter(item => item.id !== file.id))}><X className="h-3 w-3" /></button></span>)}
        {pending?.attachments.map(file => <span key={file.id} className="max-w-full truncate rounded bg-muted px-2 py-1">添付：{file.name}</span>)}
      </div>
    </fieldset>
    <div className="mt-2 flex items-end justify-between gap-2">
      <p aria-label="投稿内容と通知先" aria-live="polite" className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">{notificationSummary}</p>
      <Button type="button" size="sm" className="h-8 shrink-0" onClick={submit} disabled={busy || !hydrated || (!pending && !content.trim() && !files.length && !retainedAttachments.length && !review)}>{busy ? '投稿中…' : pending ? '同じ投稿を再試行' : review ? reviewContext ? '資料を送って確認を依頼' : '確認を依頼' : '投稿'}</Button>
    </div>
    {preparationChanged && !pending && <div className="mt-2 space-y-2 text-xs"><p role="alert">仕事の情報が変わりました。現在の条件と依頼内容を照合してください。</p><Button type="button" size="sm" variant="outline" disabled={!currentTask || locked} onClick={() => currentTask && setPreparedVersion(taskVersion(currentTask))}>変更後の内容を確認しました</Button></div>}
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
