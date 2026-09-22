"use client";
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { reviewOutcome, workflowReceiptMessage, type WorkflowReceipt, type WorkflowAction } from '@/lib/task/workflow';
import { uploadCommentAttachment } from '@/lib/firebase/storage';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { reviewCanResubmit } from '@/lib/task/continuation';
import { TaskMaterials } from './TaskMaterials';
import type { CommentAttachment, Task } from '@/types';

export function TaskWorkflow({ task, tasks, userId, names = {}, continuation = false, compact = false, availableAttachments = [], onRecorded }: {
  task: Task; tasks: Task[]; userId: string; names?: Record<string,string>; continuation?: boolean; compact?: boolean; availableAttachments?: CommentAttachment[]; onRecorded?: (receipt: WorkflowReceipt | null) => void;
}) {
  const flow = useTaskWorkflow(task, userId, 'actions', onRecorded);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<CommentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [correctingApproval, setCorrectingApproval] = useState(false);
  const [showCorrection, setShowCorrection] = useState(!continuation);
  const uploads = useRef(new Map<File, CommentAttachment>());
  const uploadGuard = useRef(false);
  const locked = flow.locked || uploading;
  const perform = async (action: WorkflowAction, text = '') => {
    if (uploadGuard.current) return;
    uploadGuard.current = true; setUploadError('');
    try {
      let attachments: CommentAttachment[] | undefined;
      if (action === 'resubmit' && !flow.pending) {
        if (files.length + selected.length > 10) throw new Error('添付は10件までです。');
        if (files.some(file => file.size > 10 * 1024 * 1024)) throw new Error('ファイルサイズは10MB以下にしてください。');
        if (isE2EMockAuthEnabled() && files.length) throw new Error('隔離環境ではファイルをアップロードしません。');
        setUploading(true);
        for (const file of files) if (!uploads.current.has(file)) uploads.current.set(file, await uploadCommentAttachment(task.projectId, task.sourceCommentTaskId ?? task.parentTaskId ?? task.id, file));
        attachments = [...selected, ...files.map(file => uploads.current.get(file)!)];
      }
      if (await flow.run(action, text, undefined, attachments)) { setNote(''); setCorrectingApproval(false); setShowCorrection(!continuation); setFiles([]); setSelected([]); uploads.current.clear(); }
    } catch (error) { setUploadError(error instanceof Error ? error.message : '添付を用意できません。'); }
    finally { uploadGuard.current = false; setUploading(false); }
  };
  const review = task.taskKind === 'review_request';
  const outcome = reviewOutcome(task);
  const parent = tasks.find(t => t.projectId === task.projectId && t.id === task.parentTaskId);
  const validParent = parent && !parent.isArchived && !parent.isAbandoned && !parent.isCompleted;
  const canReply = review && validParent && !task.isCompleted && outcome === 'pending' && task.assigneeIds.includes(userId) && !task.review?.responses[userId];
  const canCorrectApproval = review && validParent && task.isCompleted && outcome === 'approved' && task.assigneeIds.includes(userId) && task.review?.responses[userId]?.outcome === 'approved';
  const canResubmit = review && reviewCanResubmit(task, tasks, userId);
  const next = tasks.find(t => t.projectId === task.projectId && t.id === task.review?.nextTaskId && !t.isCompleted && !t.isArchived && !t.isAbandoned);
  const remaining = task.assigneeIds.filter(id => task.review?.responses[id]?.outcome !== 'approved');
  const handsOff = continuation && next && (task.review?.policy !== 'all' || remaining.length === 1);
  if (task.isArchived || task.isAbandoned) return null;
  return <section aria-label="仕事を進める" className={compact ? 'contents' : 'my-2 space-y-3'}>
    {review && <div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <p className="text-xs font-medium">{task.review?.round ?? 1}回目の確認 · {task.review?.policy === 'all' ? '全員の確認OKで完了' : '誰か1人の確認OKで完了'}</p>
      <p className="text-xs text-muted-foreground">{(task.review?.round ?? 1) > 1 ? '提出者が記入した修正内容・今回の確認点' : '依頼者が記入した確認点'}</p>
      <p className="whitespace-pre-wrap break-words">{task.review?.request ?? task.description}</p>
      <TaskMaterials files={task.review?.attachments ?? []} label="今回の確認資料" />
      {task.review && !task.review.attachments.length && <p className="text-xs text-muted-foreground">今回の添付はありません。依頼文の資料・リンクも確認してください。</p>}
      {task.review?.previousRound && <div className="space-y-1 border-t pt-2 text-xs"><p className="font-medium">前回の修正依頼</p>{Object.entries(task.review.previousRound.responses).filter(([, response]) => response.outcome === 'changes_requested').map(([id, response]) => <p key={id} className="whitespace-pre-wrap break-words">{names[id] ?? '名前は未取得'}：{response.note}</p>)}</div>}
      {task.review?.correctedApproval && <p className="whitespace-pre-wrap break-words border-l-2 pl-2 text-xs">確認OKの訂正 · {names[task.review.correctedApproval.by] ?? 'メンバー'}：{task.review.correctedApproval.note}</p>}
      {Object.entries(task.review?.responses ?? {}).map(([id, response]) => <p key={id} className="whitespace-pre-wrap break-words text-xs">{names[id] ?? '名前は未取得'}：{response.outcome === 'approved' ? '確認OK' : '修正依頼'}{response.note ? '：' + response.note : ''}</p>)}
      {next && <p className="text-xs">確認OKのあと：<strong className="font-medium">{next.title}</strong> · {next.assigneeIds.map(id => names[id] ?? '名前は未取得').join('、') || '担当者未設定'}</p>}
      {task.review?.nextTaskId && !next && !task.isCompleted && <p className="text-xs text-amber-800">引き継ぎ先を現在の仕事として確認できません。確認OKは作業担当へ返します。</p>}
      {(canResubmit || canReply && showCorrection) && <Textarea aria-label={canResubmit ? '修正した内容・成果物' : '返答・修正してほしいこと'} placeholder={canResubmit ? '修正した内容（資料は下から添付できます）' : '修正してほしいこと（確認OKの場合は任意）'} rows={2} maxLength={2000} disabled={locked} value={note} onChange={e => setNote(e.target.value)} />}
      {canResubmit && <fieldset disabled={locked} className="min-w-0 space-y-2 text-xs">
        <label className="inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-2">修正版を添付<input type="file" aria-label="再提出の添付ファイル" multiple className="sr-only" onChange={e => { setFiles(old => [...old, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} /></label>
        {availableAttachments.length > 0 && <div aria-label="登録済み資料から再提出"><p className="mb-1 text-muted-foreground">登録済み資料から選ぶ</p>{availableAttachments.map(file => <label key={file.url} className="flex items-start gap-2 py-1"><input type="checkbox" checked={selected.some(item => item.url === file.url)} onChange={e => setSelected(old => e.target.checked ? [...old, file] : old.filter(item => item.url !== file.url))} /><span className="break-all">{file.name}</span></label>)}</div>}
        {files.map((file, i) => <p key={i}>{file.name} <button type="button" aria-label={file.name + 'を外す'} onClick={() => setFiles(old => old.filter((_, index) => index !== i))}><X className="inline h-3 w-3" aria-hidden="true" /></button></p>)}
        {flow.pending?.attachments?.length ? <TaskMaterials files={flow.pending.attachments} label="送信結果を確認中の資料" /> : null}
      </fieldset>}
    </div>}
    <div className={compact ? 'contents' : 'flex flex-wrap gap-2'}>
      {!review && !task.isCompleted && task.workProgress !== 'started' && <Button size="sm" variant="outline" disabled={locked} onClick={() => void perform('start')}>作業を始める</Button>}
      {!review && (!continuation || task.workProgress === 'started' || task.isCompleted) && <Button size="sm" variant="outline" disabled={locked} onClick={() => void perform(task.isCompleted ? 'reopen' : 'complete')}>{task.isCompleted ? '未完了に戻す' : '完了にする'}</Button>}
      {canReply && <><Button size="sm" className="h-auto whitespace-normal" disabled={locked} onClick={() => void perform('approve', note)}>{handsOff ? '確認OK・' + next.title + 'へ渡す' : '確認OK'}</Button>{continuation && !showCorrection ? <Button size="sm" variant="outline" disabled={locked} onClick={() => setShowCorrection(true)}>修正を依頼</Button> : <Button size="sm" variant="outline" disabled={locked || !note.trim()} onClick={() => void perform('request_changes', note)}>修正が必要</Button>}</>}
      {canResubmit && <Button size="sm" disabled={locked || !note.trim()} onClick={() => void perform('resubmit', note)}>再確認を依頼</Button>}
      {canCorrectApproval && !correctingApproval && <Button size="sm" variant="outline" disabled={locked} onClick={() => setCorrectingApproval(true)}>確認結果を訂正する</Button>}
      {flow.pending && <Button size="sm" disabled={flow.busy || uploading} onClick={() => void perform(flow.pending!.action)}>同じ操作を再試行</Button>}
    </div>
    {correctingApproval && canCorrectApproval && <div className="space-y-2 rounded-md border p-3 text-xs">
      <p>元の確認OKを残し、訂正を追加します。後続の作業は自動で戻しません。</p>
      <Textarea aria-label="訂正する理由" rows={2} maxLength={2000} disabled={locked} value={note} onChange={event => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={locked || !note.trim()} onClick={() => void perform('correct_approval', note)}>訂正を記録して知らせる</Button><Button size="sm" variant="ghost" disabled={locked} onClick={() => { setCorrectingApproval(false); setNote(''); }}>やめる</Button></div>
    </div>}
    {(flow.error || uploadError) && <p role="alert" className="text-xs text-destructive">{flow.error || uploadError}</p>}{flow.success && !onRecorded && <p role="status" className="text-xs text-emerald-700">{flow.receipt ? workflowReceiptMessage(flow.receipt, names) : flow.success}</p>}
  </section>;
}
