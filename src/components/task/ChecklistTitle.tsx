'use client';

import { useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ChecklistTitle({ title, disabled, onSave }: {
  title: string;
  disabled: boolean;
  onSave: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const save = async () => {
    if (pending.current || disabled || !draft.trim()) return;
    if (draft.trim() === title) { setEditing(false); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      setError('名前を保存できませんでした。もう一度お試しください。');
    } finally { pending.current = false; setBusy(false); }
  };

  if (!editing) return <h4 className="min-w-0 break-words font-medium">
    <button type="button" disabled={disabled} aria-label={`${title}の名前を変更`} title="名前を変更"
      className="group inline-flex max-w-full items-center gap-1.5 text-left hover:text-primary"
      onClick={() => { setDraft(title); setError(''); setEditing(true); }}>
      <span className="min-w-0 break-words">{title}</span>
      <Pencil aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
    </button>
  </h4>;

  return <div className="min-w-0 max-w-full space-y-1">
    <div className="flex items-center gap-1">
      <Input aria-label="チェックリスト名" data-checklist-title-editor value={draft} autoFocus disabled={disabled || busy}
        className="h-8 w-48 min-w-0 flex-1" onFocus={event => event.target.select()}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); void save(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) setEditing(false); }
        }} />
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="チェックリスト名を保存"
        disabled={disabled || busy || !draft.trim()} onClick={() => void save()}><Check className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="名前の変更をキャンセル"
        disabled={busy} onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
