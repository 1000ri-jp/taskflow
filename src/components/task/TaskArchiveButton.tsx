'use client';

import { useRef, useState } from 'react';
import { ControlHint } from '@/components/ui/control-hint';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { archiveTask } from '@/lib/firebase/firestore';
import { acknowledgeArchive, hasAcknowledgedArchive } from '@/lib/archiveNotice';

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
      acknowledgeArchive(userId, 'task');
      setOpen(false);
      onArchived();
    } catch {
      setOpen(true);
      setError('アーカイブできませんでした。接続・権限を確認して、再度お試しください。');
    } finally { pending.current = false; setSaving(false); }
  };
  return <Popover open={open} onOpenChange={value => {
    if (saving) return;
    if (value && hasAcknowledgedArchive(userId, 'task')) { void archive(); return; }
    setOpen(value); setError('');
  }}>
    <ControlHint label="アーカイブ" description="一覧からしまいます。プロジェクト設定から復元できます。"><PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={!userId || saving} aria-label="タスクをアーカイブ">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M12 11v6m-3-3 3 3 3-3" />
        </svg>
      </Button>
    </PopoverTrigger></ControlHint>
    <PopoverContent align="end" className="w-72 space-y-3" aria-label="アーカイブの確認">
      <p className="break-words text-sm font-medium">「{taskTitle}」をアーカイブしますか？</p>
      <p className="text-xs leading-relaxed text-muted-foreground">共有ボードから非表示になります。内容は削除されません。プロジェクトの「設定」→「アーカイブ済みタスク」から復元できます。</p>
      <p className="text-xs text-muted-foreground">この確認は初回のみです。次回からはワンクリックでアーカイブします（このブラウザ）。</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>キャンセル</Button>
        <Button type="button" size="sm" disabled={saving} onClick={archive}>{saving ? '処理中…' : 'アーカイブする'}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
