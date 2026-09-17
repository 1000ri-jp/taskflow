'use client';

import { useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { List, Task } from '@/types';
import { cn } from '@/lib/utils';

export type MoveTaskToList = (taskId: string, listId: string) => Promise<void>;

export function TaskListPicker({ task, lists, onMove, showName = false, className }: { task: Task; lists: List[]; onMove: MoveTaskToList; showName?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = lists.find(list => list.id === task.listId);
  const target = lists.find(list => list.id === targetId);
  const completionChange = target?.autoCompleteOnEnter && !task.isCompleted ? '移動先の設定により、このタスクは完了になります。' : current?.autoUncompleteOnExit && task.isCompleted ? '現在のリストの設定により、未完了に戻ります。' : null;
  return <Popover open={open} onOpenChange={value => { if (saving) return; setOpen(value); if (value) { setTargetId(current?.id ?? ''); setError(''); } }}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className={cn('h-7 max-w-44 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground', className)} aria-label={`${task.title || '名称未設定のタスク'}のリストを変更`} title={`リストを変更（現在：${current?.name ?? '分類不明'}）`}>
      <FolderKanban className="h-3.5 w-3.5 shrink-0" />{(!current || showName) && <span className="truncate">{current?.name ?? 'リストを設定'}</span>}
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-3">
      <p className="text-sm font-medium">リストを変更</p>
      <p className="text-xs text-muted-foreground">現在：{current?.name ?? '分類不明（元のリストが見つかりません）'}</p>
      <label className="block space-y-1 text-sm"><span>移動先</span><select aria-label="移動先のリスト" disabled={saving} className="h-9 w-full rounded-md border bg-background px-2" value={targetId} onChange={event => { setTargetId(event.target.value); setError(''); }}>
        <option value="" disabled>リストを選択</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select></label>
      {!lists.length && <p className="text-xs text-muted-foreground">移動先のリストがありません。カンバンからリストを追加してください。</p>}
      {target && target.id !== task.listId && <>
        {completionChange && <p className="text-xs text-muted-foreground">{completionChange}</p>}
        {target.autoSetStartDateOnEnter && !task.startDate && <p className="text-xs text-muted-foreground">移動先の設定により、開始日が今日になります。</p>}
      </>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setOpen(false)}>キャンセル</Button><Button type="button" size="sm" disabled={saving || !target || target.id === task.listId} onClick={async () => {
        if (!target || saving) return;
        setSaving(true); setError('');
        try { await onMove(task.id, target.id); setOpen(false); }
        catch { setError('移動できませんでした。選択を残しています。再度お試しください。'); }
        finally { setSaving(false); }
      }}>{saving ? '移動中…' : '移動'}</Button></div>
    </PopoverContent>
  </Popover>;
}
