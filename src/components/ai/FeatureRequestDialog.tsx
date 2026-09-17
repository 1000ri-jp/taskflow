'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { organizeFeatureRequest, registerFeatureRequest, requestList } from '@/lib/ai/featureRequest/client';
import { uploadRequestAnnotation } from '@/lib/ai/featureRequest/attachmentUpload';
import { annotationReferences, type ScreenAnnotation } from '@/lib/ai/featureRequest/annotations';
import { REQUEST_LIST, REQUEST_PROJECT, draftDescription, requestProject, type RequestTurn } from '@/lib/ai/featureRequest/types';
import { ScreenAnnotationPicker } from './ScreenAnnotationPicker';
import { RequestAnnotations } from './RequestAnnotations';
import type { Project } from '@/types';

type Submission = { id: string; projectId: string; taskId?: string; uploaded: Set<string> };
export function FeatureRequestDialog({ open, onOpenChange, userId, projects, projectsLoading, projectsFailed }: {
  open: boolean; onOpenChange: (open: boolean) => void; userId: string; projects: Pick<Project, 'id' | 'name' | 'isArchived'>[]; projectsLoading: boolean; projectsFailed: boolean;
}) {
  const settings = useAISettingsStore();
  let projectId = '', destinationError = '';
  try { projectId = requestProject(projects); } catch (error) { destinationError = error instanceof Error ? error.message : '送信先を確認できません。'; }
  const destination = useQuery({ queryKey: ['feature-request-list', userId, projectId], queryFn: () => requestList(userId, projectId), enabled: open && !!userId && !!projectId && !projectsLoading && !projectsFailed, staleTime: 0, retry: false });
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<RequestTurn[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; projectId: string } | null>(null);
  const [annotations, setAnnotations] = useState<ScreenAnnotation[]>([]);
  const [picking, setPicking] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const lock = useRef(false);
  const previews = useRef(new Set<string>());
  useEffect(() => () => { previews.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [error, setError] = useState('');
  const ready = !!destination.data && !destination.isFetching && !destination.isError && !!projectId && !projectsLoading && !projectsFailed;
  const annotationsReady = annotations.every(item => !!item.comment.trim());
  const editingLocked = busy || !!submission;
  const updateAnnotations = (next: ScreenAnnotation[]) => {
    const urls = new Set(next.map(item => item.preview));
    previews.current.forEach(url => { if (!urls.has(url)) URL.revokeObjectURL(url); });
    previews.current = urls;
    setAnnotations(next);
  };
  const reset = () => { setInput(''); setTurns([]); setQuestions([]); setSummary(''); setDraft(null); setReceipt(null); setError(''); setSubmission(null); setProgress(''); updateAnnotations([]); };
  const organize = async () => {
    if (lock.current || !ready || !annotationsReady || (!input.trim() && !annotations.length)) return;
    lock.current = true; setBusy(true); setError('');
    const next: RequestTurn[] = [...turns, ...(summary ? [{ role: 'assistant' as const, content: `${summary}\n${questions.join('\n')}` }] : []), { role: 'user', content: input.trim() ? input : '画面注釈のコメントをもとに、要望を整理してください。' }];
    try {
      const result = await organizeFeatureRequest(userId, projectId, next, settings.provider, settings.getActiveModel(), annotationReferences(annotations));
      setTurns(next); setInput('');
      if (result.type === 'questions') { setSummary(result.summary); setQuestions(result.questions); }
      else { setDraft({ title: result.title, description: draftDescription(result) }); setSummary(''); setQuestions([]); }
    } catch (error) { setError(error instanceof Error ? error.message : '整理できませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const register = async () => {
    if (lock.current || (!ready && !submission) || !draft || !annotationsReady) return;
    lock.current = true; setBusy(true); setError('');
    const attempt = submission ?? { id: crypto.randomUUID(), projectId, uploaded: new Set<string>() };
    setSubmission(attempt);
    try {
      setProgress('要望を登録中…');
      if (!attempt.taskId) attempt.taskId = await registerFeatureRequest(userId, attempt.projectId, draft.title, draft.description, turns, { id: attempt.id, annotations: annotationReferences(annotations) });
      setSubmission({ ...attempt });
      for (const [index, annotation] of annotations.entries()) {
        if (attempt.uploaded.has(annotation.id)) continue;
        setProgress(`画像を送信中… ${index + 1}/${annotations.length}`);
        await uploadRequestAnnotation(userId, attempt.projectId, attempt.taskId, annotation);
        attempt.uploaded.add(annotation.id);
      }
      window.dispatchEvent(new Event('taskflow-work-updated'));
      setReceipt({ id: attempt.taskId, projectId: attempt.projectId });
    } catch (error) {
      setSubmission({ ...attempt });
      setError(attempt.taskId ? `要望は登録済みです。画像 ${attempt.uploaded.size}/${annotations.length} 件を送信しました。残りの画像を再送できます。` : error instanceof Error ? error.message : '受付を確認できませんでした。同じ受付で再送できます。');
    } finally { lock.current = false; setBusy(false); setProgress(''); }
  };
  if (open && picking) return <ScreenAnnotationPicker onCapture={annotation => { updateAnnotations([...annotations, annotation]); setPicking(false); }} onCancel={() => setPicking(false)} />;
  return <Dialog open={open} onOpenChange={value => { if (!lock.current) onOpenChange(value); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy} onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquarePlus className="h-5 w-5" aria-hidden="true" />要望を送る</DialogTitle><DialogDescription>{REQUEST_PROJECT} ＞ {REQUEST_LIST}</DialogDescription></DialogHeader>
      {receipt ? <div className="space-y-4"><p role="status">要望を登録しました。{annotations.length > 0 && ` 注釈画像 ${annotations.length} 件も送信しました。`}</p><p className="break-all text-xs text-muted-foreground">受付番号：{receipt.id}</p><a className="text-sm underline" href={`/projects/${encodeURIComponent(receipt.projectId)}/board?task=${encodeURIComponent(receipt.id)}`}>追加したタスクを開く</a><div><Button variant="outline" onClick={reset}>別の要望を送る</Button></div></div> : <>
        {(projectsLoading || destination.isFetching) && <p role="status" className="text-sm text-muted-foreground">送信先を確認中…</p>}
        {(projectsFailed || !projectsLoading && destinationError || destination.isError) && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{projectsFailed ? 'プロジェクトを取得できませんでした。' : destinationError || (destination.error instanceof Error ? destination.error.message : '送信先を確認できません。')}</p>{destination.isError && <Button variant="ghost" size="sm" onClick={() => void destination.refetch()}>再取得</Button>}</div>}
        <RequestAnnotations items={annotations} disabled={editingLocked} onChange={updateAnnotations} onCapture={() => setPicking(true)} />
        {draft ? <>
          <p className="text-sm">この内容で登録します。必要なら直せます。</p>
          <label className="space-y-1 text-sm"><span>タスク名</span><Input value={draft.title} maxLength={32} disabled={editingLocked} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="space-y-1 text-sm"><span>説明</span><Textarea className="min-h-64" rows={10} maxLength={6000} disabled={editingLocked} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          <details className="text-xs text-muted-foreground"><summary>原文・聞き取りも残します</summary>{turns.map((turn, index) => <p key={index} className="mt-2 whitespace-pre-wrap break-words">{turn.role === 'user' ? '本人：' : 'モアイ：'}{turn.content}</p>)}</details>
          {!!submission && !busy && <p className="text-xs text-muted-foreground">送信した内容を保持しています。再送しても同じ受付に続けます。</p>}
          {submission?.taskId && <a className="text-sm underline" href={`/projects/${encodeURIComponent(submission.projectId)}/board?task=${encodeURIComponent(submission.taskId)}`}>受付済みのタスクを開く</a>}
          <div className="flex flex-wrap justify-between gap-2"><Button variant="ghost" disabled={editingLocked} onClick={() => { setInput(turns[0]?.content ?? ''); setTurns([]); setSummary(''); setQuestions([]); setDraft(null); setError(''); }}>書き直す</Button><Button disabled={busy || (!ready && !submission) || !annotationsReady || !draft.title.trim() || !draft.description.trim()} onClick={register}><Send aria-hidden="true" />{busy ? '登録中…' : submission ? submission.taskId ? '残りの画像を再送' : '同じ受付で再送' : 'この内容で登録'}</Button></div>
        </> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void organize(); }}>
          {summary ? <div className="space-y-2 rounded-md bg-muted p-3 text-sm"><p className="whitespace-pre-wrap">{summary}</p>{questions.map((question, index) => <p key={`${index}:${question}`} className="font-medium">{question}</p>)}</div> : <p className="text-sm">困っていること、こうしてほしいことをどうぞ。必要なことはモアイが伺います。</p>}
          <Textarea className="min-h-32" aria-label={summary ? 'モアイへの回答' : '要望の内容'} placeholder={summary ? '分かる範囲で答えてください' : annotations.length ? '補足があればどうぞ（任意）' : 'どこで、何に困っていますか？'} rows={5} maxLength={3000} disabled={busy} value={input} onChange={event => setInput(event.target.value)} />
          <div className="flex justify-end"><Button type="submit" disabled={busy || !ready || !annotationsReady || (!input.trim() && !annotations.length)}><Sparkles aria-hidden="true" />{busy ? '整理中…' : summary ? '回答して整理' : 'モアイと整理する'}</Button></div>
        </form>}
        {progress && <p role="status" className="text-sm">{progress}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {projectId && <a className="text-xs underline" href={`/projects/${encodeURIComponent(projectId)}/board`}>要望リストを開く</a>}
      </>}
    </DialogContent>
  </Dialog>;
}
