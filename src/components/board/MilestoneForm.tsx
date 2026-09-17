'use client';
import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Milestone, Task } from '@/types';
import type { MilestoneInput } from '@/hooks/useProjectMilestones';

export function MilestoneForm({ milestone, tasks, onSave, onCancel }: { milestone?: Milestone; tasks: Task[]; onSave: (data: MilestoneInput) => Promise<unknown>; onCancel: () => void }) {
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [kind, setKind] = useState(milestone?.kind ?? (milestone ? '' : 'date'));
  const [date, setDate] = useState<Date | undefined>(milestone?.dueDate ?? undefined);
  const [condition, setCondition] = useState(milestone?.achievementCondition ?? '');
  const [required, setRequired] = useState(milestone?.requiredTaskIds ?? []);
  const [status, setStatus] = useState(milestone?.status ?? 'planned');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); if (busy) return;
    if (kind === 'achievement' && (required.length || status === 'achieved') && !condition.trim()) { setError('何がそろえば達成か、条件を入力してください。'); return; }
    setBusy(true); setError('');
    try { await onSave({ title: title.trim(), description: description.trim(), dueDate: date ?? null,
      ...(kind ? { kind: kind as 'date' | 'achievement' } : {}),
      achievementCondition: kind === 'achievement' ? condition.trim() : '', requiredTaskIds: kind === 'achievement' ? required : [],
      status: kind === 'date' ? status === 'cancelled' ? 'cancelled' : 'planned' : required.length && status === 'achieved' ? 'planned' : status }); }
    catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした。'); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block space-y-1 text-sm">名前<Input required value={title} onChange={e => setTitle(e.target.value)} maxLength={200} /></label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label>種類<select aria-label="節目の種類" className="ml-2 h-8 rounded border bg-background px-2" value={kind} onChange={e => setKind(e.target.value)}>{!kind && <option value="">従来の節目</option>}<option value="date">日付の節目</option><option value="achievement">達成の節目</option></select></label>
        <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm">{kind === 'achievement' ? '目標日' : '日付'}：{date ? format(date, 'yyyy/M/d') : '未設定'}</Button></PopoverTrigger><PopoverContent className="w-auto p-2"><Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={date} /><Button type="button" size="sm" variant="ghost" onClick={() => setDate(undefined)}>日付を外す</Button></PopoverContent></Popover>
      </div>
      <label className="block space-y-1 text-sm">説明（任意）<Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /></label>
      {kind === 'achievement' && <>
        <label className="block space-y-1 text-sm">達成条件<Textarea rows={2} value={condition} onChange={e => setCondition(e.target.value)} placeholder="例：確認済みの印刷用PDFを入稿する" maxLength={2000} /></label>
        <details className="text-xs"><summary className="cursor-pointer">達成に必要な仕事を指定（{required.length}件）</summary><p className="my-2 text-muted-foreground">選んだ仕事がすべて完了すると達成と表示します。未指定の場合は、条件を確認して手動で達成にします。</p>
          <div className="max-h-40 overflow-y-auto divide-y rounded border">{tasks.filter(t => !t.isArchived && !t.isAbandoned).map(task => <label key={task.id} className="flex items-center gap-2 p-2"><input type="checkbox" checked={required.includes(task.id)} onChange={e => setRequired(ids => e.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} />{task.title}</label>)}</div>
          {required.filter(id => !tasks.some(t => t.id === id && !t.isArchived && !t.isAbandoned)).map(id => <label key={id} className="flex gap-2 p-2 text-amber-700"><input type="checkbox" checked onChange={() => setRequired(ids => ids.filter(value => value !== id))} />取得できない、または中止した条件の仕事</label>)}
        </details>
      </>}
      <label className="flex items-center gap-2 text-sm">{kind === 'date' ? '開催' : '状態'}<select aria-label="節目の状態" className="h-8 rounded border bg-background px-2"  value={required.length && status === 'achieved' ? 'planned' : status} onChange={e => setStatus(e.target.value as Milestone['status'])}><option value="planned">{kind === 'date' ? '予定どおり' : '未達成'}</option>{kind !== 'date' && <><option value="in_progress">進行中</option>{!required.length && <option value="achieved">達成</option>}</>}<option value="cancelled">中止</option></select></label>
    </fieldset>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>キャンセル</Button><Button type="submit" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存'}</Button></div>
  </form>;
}
