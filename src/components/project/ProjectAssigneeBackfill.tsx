'use client';
import { useState } from 'react';
import { useBoard } from '@/hooks/useBoard';
import { Button } from '@/components/ui/button';
import { applyProjectAssignee } from '@/lib/firebase/assigneeBackfill';
import { canReceiveDefaultAssignee } from '@/lib/task/assigneeBackfill';

export function ProjectAssigneeBackfill({ projectId, assigneeId, name }: { projectId: string; assigneeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <details className="text-sm" onToggle={event => setOpen(event.currentTarget.open)}><summary className="min-h-8 cursor-pointer py-1">既存の担当未設定タスクへ適用</summary>{open && <Selection projectId={projectId} assigneeId={assigneeId} name={name} />}</details>;
}
function Selection({ projectId, assigneeId, name }: { projectId: string; assigneeId: string; name: string }) {
  const { tasks, lists, isLoading, error } = useBoard(projectId);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const candidates = tasks.filter(canReceiveDefaultAssignee);
  return <div className="space-y-2 py-2"><p className="text-xs leading-relaxed text-muted-foreground">{name}を担当にする仕事を選んでください。未完了・担当未設定の仕事だけが対象です。</p>
    {isLoading ? <p role="status">取得中…</p> : error ? <p role="alert">対象を取得できません。開き直してください。</p> : candidates.length === 0 ? <p>対象のタスクはありません。</p> : <fieldset disabled={busy} className="max-h-64 overflow-y-auto">{candidates.map(task => <label key={task.id} className="flex min-h-9 items-center gap-2 py-1"><input type="checkbox" checked={selected.includes(task.id)} onChange={event => { setMessage(''); setSelected(event.target.checked ? [...selected, task.id] : selected.filter(id => id !== task.id)); }} /><span className="min-w-0 break-words">{task.title}<span className="ml-2 text-xs text-muted-foreground">{lists.find(list => list.id === task.listId)?.name}{task.parentTaskId ? '・サブタスク' : ''}</span></span></label>)}</fieldset>}
    <Button type="button" size="sm" disabled={busy || isLoading || !!error || !selected.length || selected.length > 100} onClick={async () => {
      setBusy(true); setFailure(''); setMessage('');
      try { await applyProjectAssignee(projectId, selected, assigneeId); setMessage(`${selected.length}件の担当を${name}に変更しました。`); setSelected([]); }
      catch (reason) { setFailure(reason instanceof Error ? reason.message : '保存できませんでした。選択を保持しています。'); }
      finally { setBusy(false); }
    }}>{busy ? '反映中…' : `選択した${selected.length}件へ適用`}</Button>
    {failure && <p role="alert" className="text-destructive">{failure}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
