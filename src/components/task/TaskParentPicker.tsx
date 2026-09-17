'use client';

import { useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { canBeTaskParent, TaskParentRejected, type ChangeTaskParent } from '@/lib/task/parentTask';
import type { List, Task } from '@/types';

export function TaskParentPicker({ task, tasks, lists, onChange, compact = false }: {
  task: Task; tasks: Task[]; lists: List[]; onChange: ChangeTaskParent; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const candidates = useMemo(() => {
    const byId = new Map(tasks.map(item => [item.id, item]));
    return tasks.filter(item => canBeTaskParent(task, item.id, byId));
  }, [task, tasks]);
  const parent = tasks.find(item => item.id === task.parentTaskId);
  const currentName = task.parentTaskId ? parent?.title || '親タスクを確認できません' : '親なし（単独タスク）';
  const triggerLabel = compact ? `親タスクを変更（現在：${currentName}）` : '親タスクを変更';
  const valid = !targetId || candidates.some(item => item.id === targetId);

  return <Popover open={open} onOpenChange={value => {
    if (saving) return;
    setOpen(value);
    if (value) { setTargetId(task.parentTaskId ?? ''); setError(''); }
  }}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className={compact ? 'h-7 min-w-0 max-w-44 justify-start gap-1 px-1.5 text-xs text-muted-foreground' : 'h-auto min-h-8 max-w-full justify-start gap-2 px-1 text-muted-foreground'} aria-label={triggerLabel} title={compact ? triggerLabel : undefined} disabled={task.isArchived}>
      <GitBranch aria-hidden="true" className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} /><span className="min-w-0 truncate">{compact ? task.parentTaskId ? currentName : '親なし' : `親タスク：${currentName}`}</span>
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 space-y-3">
      <p className="text-sm font-medium">親タスクを変更</p>
      <p className="text-xs text-muted-foreground">現在：{currentName}</p>
      <label className="block space-y-1 text-sm"><span>新しい親タスク</span><select aria-label="新しい親タスク" value={targetId} disabled={saving} className="h-9 w-full rounded-md border bg-background px-2" onChange={event => { setTargetId(event.target.value); setError(''); }}>
        <option value="">親なし（単独タスク）</option>
        {targetId && !valid && <option value={targetId} disabled>この親タスクは選択できません</option>}
        {candidates.map(item => <option key={item.id} value={item.id}>{item.title || '名称未設定のタスク'} · {lists.find(list => list.id === item.listId)?.name ?? '分類不明'}{item.isCompleted ? '（完了）' : ''}</option>)}
      </select></label>
      <p className="text-xs text-muted-foreground">親の下にまとめて表示します。「親なし」で単独のタスクに戻せます。</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setOpen(false)}>キャンセル</Button>
        <Button type="button" size="sm" disabled={saving || !valid || targetId === (task.parentTaskId ?? '')} onClick={async () => {
          if (saving || !valid) return;
          setSaving(true); setError('');
          try { await onChange(task.id, targetId || null); setOpen(false); }
          catch (cause) { setError(cause instanceof TaskParentRejected ? cause.message : '変更できませんでした。選択を残しています。再度お試しください。'); }
          finally { setSaving(false); }
        }}>{saving ? '変更中…' : '変更'}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
