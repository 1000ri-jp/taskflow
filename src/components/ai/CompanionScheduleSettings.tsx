'use client';

import { useId, useState } from 'react';
import { Clock3, Play, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_COMPANION_SCHEDULE, type CompanionScheduleSettings as Schedule } from '@/lib/ai/companionSchedule';
import { previewCompanionGreeting, useCompanionScheduleSettings } from '@/hooks/useCompanionSchedule';

const dayOptions = [{ value: 'weekday', label: '平日' }, { value: 'weekend', label: '土日' }, { value: 'holiday', label: '祝日' }] as const;

export function CompanionScheduleSettings({ userId }: { userId: string }) {
  const { settings, saveSettings } = useCompanionScheduleSettings(userId);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const value = draft ?? settings;
  const targetDays: NonNullable<Schedule['targetDays']> = value.targetDays ?? ['weekday'];
  const dirty = JSON.stringify(value) !== JSON.stringify(settings);
  const edit = (next: Schedule) => { setDraft(next); setError(null); setSaved(false); };
  const updateEntry = (entryId: string, patch: Partial<Schedule['entries'][number]>) => {
    edit({ ...value, entries: value.entries.map(entry => entry.id === entryId ? { ...entry, ...patch } : entry) });
  };

  return <Card density="compact" id="companion-schedule">
    <CardHeader>
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" />モアイくんの声かけ</CardTitle>
        <Label htmlFor={id} className="sr-only">定時の声かけ</Label>
        <Switch id={id} checked={value.enabled} onCheckedChange={enabled => edit({ ...value, enabled })} />
      </div>
    </CardHeader>
    <CardContent>
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        try { saveSettings({ ...value, targetDays }); setDraft(null); setError(null); setSaved(true); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '声かけの設定を保存できませんでした。'); setSaved(false); }
      }}>
        <div role="group" aria-label="声かけの対象日" className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">対象日</span>
          {dayOptions.map(option => <Label key={option.value} htmlFor={`${id}-${option.value}`} className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs">
            <Checkbox id={`${id}-${option.value}`} checked={targetDays.includes(option.value)} onCheckedChange={checked => {
              const selected = new Set(targetDays);
              if (checked === true) selected.add(option.value); else selected.delete(option.value);
              edit({ ...value, targetDays: dayOptions.filter(day => selected.has(day.value)).map(day => day.value) });
            }} />{option.label}
          </Label>)}
        </div>
        <p className="text-xs text-muted-foreground">平日・土日は祝日を除きます。日本時間で、TaskFlowを開いている間に表示します。</p>
        <div className="rounded-md border p-1">
          {value.entries.map((entry, index) => <div key={entry.id} className="flex flex-wrap items-center gap-1.5 px-1 py-1.5">
            <Switch checked={entry.enabled} onCheckedChange={enabled => updateEntry(entry.id, { enabled })} aria-label={`声かけ${index + 1}を有効にする`} />
            <Input className="h-7 w-24 shrink-0 px-2" type="time" required step={60} value={entry.time} aria-label={`声かけ${index + 1}の時刻`} onChange={event => updateEntry(entry.id, { time: event.target.value })} />
            <Input className="h-7 min-w-36 flex-1 px-2" required maxLength={120} value={entry.message} aria-label={`声かけ${index + 1}のメッセージ`} onChange={event => updateEntry(entry.id, { message: event.target.value })} />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!entry.message.trim()} title="表示を試す" aria-label={`声かけ${index + 1}の表示を試す`} onClick={() => previewCompanionGreeting(userId, entry.message.trim())}><Play className="h-3.5 w-3.5" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="削除" aria-label={`声かけ${index + 1}を削除`} onClick={() => edit({ ...value, entries: value.entries.filter(item => item.id !== entry.id) })}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          </div>)}
          {value.entries.length === 0 && <p className="py-3 text-sm text-muted-foreground">声かけがありません。時刻とメッセージを追加してください。</p>}
        </div>
        <p className="text-xs text-muted-foreground">設定はこのブラウザ・アカウントに保存。▷で吹き出しを確認できます。</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={value.entries.length >= 12} onClick={() => edit({ ...value, entries: [...value.entries, { id: crypto.randomUUID(), time: '09:00', message: '', enabled: true }] })}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />声かけを追加</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => edit(structuredClone(DEFAULT_COMPANION_SCHEDULE))}>初期値に戻す</Button>
          {saved && <span role="status" className="text-xs text-muted-foreground">保存しました。</span>}
          <Button type="submit" className="ml-auto h-7 px-3 text-xs" aria-label="声かけの設定を保存" disabled={!dirty}>保存</Button>
        </div>
      </form>
    </CardContent>
  </Card>;
}
