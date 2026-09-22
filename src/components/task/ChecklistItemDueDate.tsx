'use client';

import { useRef, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { validateChecklistDeadline, type ChecklistDeadline } from '@/lib/utils/checklist-item';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { ControlHint } from '@/components/ui/control-hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ChecklistItem } from '@/types';

export function ChecklistItemDueDate({ item, disabled, onSave, onSaveDeadline }: {
  item: ChecklistItem;
  disabled: boolean;
  onSaveDeadline?: (value: ChecklistDeadline) => Promise<void>;
  onSave: (dueDate: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(item.dueDate ?? '');
  const [time, setTime] = useState(item.dueTime ?? '');
  const [strict, setStrict] = useState(item.deadlinePolicy === 'strict');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const parsed = item.dueDate ? parseISO(item.dueDate) : null;
  const date = parsed && isValid(parsed) ? parsed : null;
  const overdue = !item.isChecked && date && item.dueDate! < format(new Date(), 'yyyy-MM-dd');
  const label = date ? `${item.text}の期限: ${format(date, 'yyyy/M/d')}${item.dueTime ? ` ${item.dueTime}` : ''}${item.deadlinePolicy === 'strict' ? ' 期限厳守' : ''}${overdue ? '（期限切れ）' : ''}` : `${item.text}の期限を設定`;

  const save = async (value: string | null) => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (onSaveDeadline) {
        const deadline: ChecklistDeadline = { dueDate: value, dueTime: value ? time || null : null, deadlinePolicy: value && strict ? 'strict' : null };
        validateChecklistDeadline(deadline);
        await onSaveDeadline(deadline);
      } else await onSave(value);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '期限を保存できませんでした。もう一度お試しください。');
    } finally { pending.current = false; setBusy(false); }
  };

  return <Popover open={open} onOpenChange={value => {
    if (busy) return;
    setOpen(value);
    if (value) { setDraft(item.dueDate ?? ''); setTime(item.dueTime ?? ''); setStrict(item.deadlinePolicy === 'strict'); setError(''); }
  }}>
    <ControlHint label={label}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} aria-label={label}
          className={cn('h-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground', overdue && 'text-red-600')}>
          {date && <time dateTime={item.dueDate!} className="tabular-nums">{format(date, 'M/d')}{item.dueTime && ` ${item.dueTime}`}{item.deadlinePolicy === 'strict' && ' 厳守'}</time>}
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
    </ControlHint>
    <PopoverContent align="end" className="w-auto max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-2rem)] overflow-y-auto space-y-2 p-3" aria-label={`${item.text}の期限`}>
      <p className="text-sm font-medium">期限</p>
      <Calendar mode="single" selected={draft ? parseISO(draft) : undefined} defaultMonth={date ?? undefined}
        labels={{ labelDayButton: day => format(day, 'yyyy年M月d日') }}
        disabled={disabled || busy} className="p-0"
        onSelect={day => setDraft(day ? format(day, 'yyyy-MM-dd') : '')} />
      {onSaveDeadline && <div className="space-y-2">
        <label className="block space-y-1 text-xs">時刻（日本時間）<Input type="time" aria-label="期限の時刻（日本時間）" value={time} disabled={disabled || busy} onChange={event => setTime(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={strict} disabled={disabled || busy} onCheckedChange={value => setStrict(value === true)} />期限厳守：ダッシュボードに表示</label>
        <p className="max-w-64 text-xs text-muted-foreground">タスクの担当者の「期限厳守」に、完了するまで表示します。時刻の通知や自動実行は行いません。</p>
      </div>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy || !item.dueDate} onClick={() => void save(null)}>期限を外す</Button>
        <Button type="button" size="sm" disabled={disabled || busy || (draft === (item.dueDate ?? '') && time === (item.dueTime ?? '') && strict === (item.deadlinePolicy === 'strict'))} onClick={() => void save(draft || null)}>{busy ? '保存中…' : '保存'}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
