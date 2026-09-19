'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyProjectMove, getProjectMoveContext, previewProjectMove } from '@/lib/task/projectMoveClient';
import type { ProjectMoveContext, ProjectMoveInput, ProjectMovePreview } from '@/lib/task/projectMove';

export function TaskProjectPicker({ projectId, taskId, projectName }: { projectId: string; taskId: string; projectName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [context, setContext] = useState<ProjectMoveContext | null>(null);
  const [targetId, setTargetId] = useState(''), [listId, setListId] = useState('');
  const [preview, setPreview] = useState<ProjectMovePreview | null>(null), [operation, setOperation] = useState<ProjectMoveInput | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    getProjectMoveContext(projectId, taskId).then(result => { if (active) setContext(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [open, projectId, taskId, reload]);
  const target = context?.projects.find(p => p.id === targetId);
  const resetPreview = () => { setPreview(null); setOperation(null); setError(''); };
  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const input = { id: crypto.randomUUID(), targetProjectId: targetId, listId };
      const result = await previewProjectMove(projectId, taskId, input);
      setPreview(result); setOperation({ ...input, version: result.version });
    } catch (error) { setError(error instanceof Error ? error.message : '内容を確認できませんでした。'); }
    finally { setBusy(false); }
  };
  const move = async () => {
    if (!operation || busy) return;
    setBusy(true); setError('');
    try {
      const result = await applyProjectMove(projectId, taskId, operation);
      setUncertain(false); setOpen(false);
      router.push(`/projects/${encodeURIComponent(result.projectId)}/board?task=${encodeURIComponent(result.taskId)}`);
    } catch (error) {
      const rejected = !!(error && typeof error === 'object' && 'rejected' in error && error.rejected);
      setUncertain(!rejected);
      if (rejected) { setPreview(null); setOperation(null); }
      setError(error instanceof Error ? error.message : '結果を確認できません。同じ操作で再試行してください。');
    } finally { setBusy(false); }
  };
  return <>
    <Button type="button" variant="ghost" size="sm" className="h-7 min-w-0 max-w-44 gap-1 px-1.5 text-xs text-muted-foreground" aria-label="プロジェクトを変更" title={projectName ? `${projectName}：プロジェクトを変更` : 'プロジェクトを変更'} onClick={() => { setOpen(true); if (!uncertain) { setContext(null); resetPreview(); } }}>
      <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{projectName || 'プロジェクト'}</span>
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy && !uncertain) setOpen(value); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>プロジェクトを変更</DialogTitle><DialogDescription>親タスクとサブタスクを、コメント・添付・チェックリストと一緒に移動します。</DialogDescription></DialogHeader>
        {context ? <div className="space-y-3">
          <p className="text-xs text-muted-foreground">現在：{context.currentName}</p>
          <label className="block space-y-1 text-sm"><span>移動先のプロジェクト</span><select className="h-9 w-full rounded-md border bg-background px-2" value={targetId} disabled={busy || uncertain} onChange={event => { setTargetId(event.target.value); setListId(''); resetPreview(); }}>
            <option value="">プロジェクトを選択</option>{context.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          {!context.projects.length && <p className="text-xs text-muted-foreground">移動できるプロジェクトがありません。移動先の編集権限が必要です。</p>}
          {target && <label className="block space-y-1 text-sm"><span>移動先のリスト</span><select className="h-9 w-full rounded-md border bg-background px-2" value={listId} disabled={busy || uncertain} onChange={event => { setListId(event.target.value); resetPreview(); }}>
            <option value="">リストを選択</option>{target.lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>}
          {target && !target.lists.length && <p className="text-xs text-muted-foreground">移動先のプロジェクトにリストを追加してください。</p>}
          {preview && <div className="rounded-md bg-muted p-3 text-sm" role="status">
            <p>{preview.targetName} / {preview.listName} へ移動します。</p>
            <p className="mt-1 text-xs">タスク {preview.taskCount}件 · コメント {preview.commentCount}件 · 添付 {preview.attachmentCount}件 · チェックリスト {preview.checklistCount}件</p>
            <p className="mt-2 text-xs">内容は移動先のメンバーに共有されます。進捗と日付はそのまま移します。</p>
          </div>}
        </div> : !error && <p className="text-sm text-muted-foreground">プロジェクトを確認中…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {uncertain && <p className="text-xs text-muted-foreground">入力を残しています。「結果を確認・再試行」で保存済みか確認します。</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy || uncertain} onClick={() => setOpen(false)}>キャンセル</Button>
          {!context && error ? <Button type="button" onClick={() => { setError(''); setReload(n => n + 1); }}>再試行</Button> :
            <Button type="button" disabled={busy || !targetId || !listId || !context} onClick={() => void (preview ? move() : confirm())}>{busy ? '確認中…' : uncertain ? '結果を確認・再試行' : preview ? '移動' : '内容を確認'}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
