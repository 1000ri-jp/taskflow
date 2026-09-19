'use client';

import { useId, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarClock, CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jstDay, nextMonth, nextWeek } from '@/lib/secretary/engine';

function daysAfter(now: string, days: number) {
  const date = new Date(`${jstDay(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function SecretaryReschedule({ title, dueDate, startDate, disabled, onSave }: {
  title: string; dueDate: string | null; startDate?: string | null; disabled: boolean; onSave: (day: string) => void | Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarId = useId();
  const [today, setToday] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = dueDate ? jstDay(dueDate) : '';
  const start = startDate ? jstDay(startDate) : '';
  const beforeStart = !!start && !!selected && selected < start;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(selected)
    && Number.isFinite(Date.parse(`${selected}T00:00:00Z`))
    && new Date(`${selected}T00:00:00Z`).toISOString().slice(0, 10) === selected;
  const label = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const presets = today ? [
    { label: '明日', day: daysAfter(today, 1) },
    { label: '明後日', day: daysAfter(today, 2) },
    { label: '来週', day: jstDay(nextWeek(today)) },
    { label: '来月', day: jstDay(nextMonth(today)) },
  ] : [];
  return <Popover open={open} onOpenChange={value => {
    if (saving) return;
    if (value) { setSelected(current); setToday(new Date().toISOString()); setFailed(false); setCalendarOpen(false); }
    setOpen(value);
  }}>
    <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={disabled} aria-label={`期限変更: ${title}`}><CalendarClock className="size-3.5" aria-hidden="true" />期限変更</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(320px,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto" aria-label={`期限変更: ${title}`}>
      <p className="text-sm font-medium">期限を変更</p>
      {today && <div className="flex flex-wrap gap-2">
        {presets.map(preset => <Button key={preset.label} size="sm" variant="outline" className="px-2 aria-pressed:border-primary/40 aria-pressed:bg-primary/10" aria-pressed={selected === preset.day} disabled={saving} onClick={() => { setSelected(preset.day); setCalendarOpen(false); }}>{preset.label}</Button>)}
        <Button type="button" size="icon-sm" variant="outline" disabled={saving} aria-label="カレンダーから日付を選ぶ" title="カレンダーから日付を選ぶ" aria-expanded={calendarOpen} aria-controls={calendarId} onClick={() => setCalendarOpen(value => !value)}><CalendarDays className="size-4" aria-hidden="true" /></Button>
      </div>}
      {calendarOpen && <div id={calendarId} role="region" aria-label="期限のカレンダー" className="flex justify-center border-t pt-3">
        <Calendar mode="single" required selected={valid ? parseISO(selected) : undefined} defaultMonth={valid ? parseISO(selected) : today ? parseISO(jstDay(today)) : undefined}
          today={today ? parseISO(jstDay(today)) : undefined} labels={{ labelDayButton: day => format(day, 'yyyy年M月d日') }}
          disabled={saving || (start ? { before: parseISO(start) } : false)} className="p-0"
          onSelect={day => { setSelected(format(day, 'yyyy-MM-dd')); setCalendarOpen(false); }} />
      </div>}
      {beforeStart && <p role="alert" className="text-xs text-rose-700">開始日（{label(start)}）以降の日付を選んでください。</p>}
      {failed && <p role="alert" className="text-xs text-rose-700">保存できませんでした。入力した日付は保持しています。</p>}
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>戻る</Button><Button size="sm" disabled={disabled || saving || !valid || beforeStart || selected === current} onClick={async () => {
        setSaving(true); setFailed(false);
        try { if (await onSave(selected) === false) setFailed(true); else setOpen(false); }
        catch { setFailed(true); }
        finally { setSaving(false); }
      }}>{saving ? '保存中…' : '期限を変更'}</Button></div>
    </PopoverContent>
  </Popover>;
}
