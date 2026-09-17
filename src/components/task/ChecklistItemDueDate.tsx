'use client';

import { useRef, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { ControlHint } from '@/components/ui/control-hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ChecklistItem } from '@/types';

export function ChecklistItemDueDate({ item, disabled, onSave }: {
  item: ChecklistItem;
  disabled: boolean;
  onSave: (dueDate: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(item.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const parsed = item.dueDate ? parseISO(item.dueDate) : null;
  const date = parsed && isValid(parsed) ? parsed : null;
  const overdue = !item.isChecked && date && item.dueDate! < format(new Date(), 'yyyy-MM-dd');
  const label = date ? `${item.text}の期限: ${format(date, 'yyyy/M/d')}${overdue ? '（期限切れ）' : ''}` : `${item.text}の期限を設定`;

  const save = async (value: string | null) => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(value);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '期限を保存できませんでした。もう一度お試しください。');
    } finally { pending.current = false; setBusy(false); }
  };

  return <Popover open={open} onOpenChange={value => {
    if (busy) return;
    setOpen(value);
    if (value) { setDraft(item.dueDate ?? ''); setError(''); }
  }}>
    <ControlHint label={label}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} aria-label={label}
          className={cn('h-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground', overdue && 'text-red-600')}>
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
          {date && <time dateTime={item.dueDate!} className="tabular-nums">{format(date, 'M/d')}</time>}
        </Button>
      </PopoverTrigger>
    </ControlHint>
    <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] space-y-2 p-3" aria-label={`${item.text}の期限`}>
      <p className="text-sm font-medium">期限</p>
      <Calendar mode="single" selected={draft ? parseISO(draft) : undefined} defaultMonth={date ?? undefined}
        labels={{ labelDayButton: day => format(day, 'yyyy年M月d日') }}
        disabled={disabled || busy} className="p-0"
        onSelect={day => setDraft(day ? format(day, 'yyyy-MM-dd') : '')} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy || !item.dueDate} onClick={() => void save(null)}>期限を外す</Button>
        <Button type="button" size="sm" disabled={disabled || busy || draft === (item.dueDate ?? '')} onClick={() => void save(draft || null)}>{busy ? '保存中…' : '保存'}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
