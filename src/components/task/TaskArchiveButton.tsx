'use client';

import { useRef, useState } from 'react';
import { Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { archiveTask } from '@/lib/firebase/firestore';

export function TaskArchiveButton({ projectId, taskId, taskTitle, userId, onArchived }: {
  projectId: string; taskId: string; taskTitle: string; userId?: string; onArchived: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const archive = async () => {
    if (!userId || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await archiveTask(projectId, taskId, userId);
      setOpen(false);
      onArchived();
    } catch {
      setError('アーカイブできませんでした。接続・権限を確認して、再度お試しください。');
    } finally { pending.current = false; setSaving(false); }
  };
  return <Popover open={open} onOpenChange={value => { if (!saving) { setOpen(value); setError(''); } }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!userId || saving} aria-label="タスクをアーカイブ">
        <Archive className="h-4 w-4" /><span className="ml-1 text-xs">アーカイブ</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 space-y-3" aria-label="アーカイブの確認">
      <p className="break-words text-sm font-medium">「{taskTitle}」をアーカイブしますか？</p>
      <p className="text-xs leading-relaxed text-muted-foreground">共有ボードから非表示になります。内容は削除されません。プロジェクトの「設定」→「アーカイブ済みタスク」から復元できます。</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>キャンセル</Button>
        <Button type="button" size="sm" disabled={saving} onClick={archive}>{saving ? '処理中…' : 'アーカイブする'}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
