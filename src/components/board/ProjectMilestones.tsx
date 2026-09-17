'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { Milestone, Task } from '@/types';

import { MilestoneForm } from './MilestoneForm';
import { taskRowInteraction } from '@/components/ui/density';
import { milestonePresentation } from '@/lib/milestones';
import type { MilestoneInput } from '@/hooks/useProjectMilestones';

type AddMilestone = (data: MilestoneInput) => Promise<string>;
export function ProjectMilestones({ projectId, tasks, milestones, isLoading, error, selectedId, onSelect, onTaskClick, onAdd, onSave, iconOnly = false }: {
  projectId: string; tasks: Task[]; milestones: Milestone[]; isLoading: boolean; error: boolean;
  selectedId: string | null; onSelect: (id: string | null) => void; onTaskClick: (id: string) => void;
  onAdd?: AddMilestone; onSave?: (data: MilestoneInput, id?: string) => Promise<string>; iconOnly?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const selected = milestones.find(item => item.id === selectedId);
  const next = [...milestones].filter(item => !milestonePresentation(item, tasks).achieved && item.status !== 'cancelled' && !(item.kind === 'date' && item.dueDate && item.dueDate.getTime() < new Date().setHours(0, 0, 0, 0)))
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.order - b.order)[0];
  const linked = selected ? tasks.filter(task => !task.isArchived && (task.milestoneId === selected.id || selected.requiredTaskIds?.includes(task.id))) : [];
  return <div className="flex min-w-0 items-center gap-2 text-xs">
    <ControlHint label="節目・出展日" description={error ? '節目を取得できません。開いて状態を確認できます。' : isLoading ? '節目を読み込み中…' : next ? `次の節目：${next.title}。開くと詳細の確認や追加ができます。` : '出展日や準備完了などの節目を確認・追加します。'}>
      <Button type="button" size="sm" variant={iconOnly ? 'outline' : 'ghost'} className={iconOnly ? 'h-8 w-8 p-0' : 'h-8 shrink-0'} aria-label="節目・出展日" onClick={() => onSelect(next?.id ?? '__list__')}><Flag className={`h-4 w-4${error ? ' text-destructive' : ''}`} />{!iconOnly && '節目'}</Button>
    </ControlHint>
    {!iconOnly && (isLoading ? <span role="status" className="text-muted-foreground">読み込み中…</span> : error ? <span role="alert" className="text-destructive">節目を取得できません</span> : next ? <button type="button" className="min-w-0 truncate text-muted-foreground hover:underline" title={next.title} onClick={() => onSelect(next.id)}>{next.dueDate && `${format(next.dueDate, 'M/d')} · `}{next.title}</button> : null)}
    <Dialog open={selectedId !== null} onOpenChange={open => { if (!open) onSelect(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{selectedId === '__new__' ? '節目・出展日を追加' : selected?.title ?? 'プロジェクトの節目'}</DialogTitle><DialogDescription>出展日・公開日・準備完了などの大事な日を登録できます。準備作業はタスクにし、この節目に関連付けられます。節目はプロジェクト全体で共有します。</DialogDescription></DialogHeader>
        {isLoading ? <p role="status">読み込み中…</p> : error ? <p role="alert">節目を取得できませんでした。接続・権限を確認してください。</p> : selectedId === '__new__' && onAdd ? <MilestoneForm tasks={tasks} onSave={async data => onSelect(await onAdd(data))} onCancel={() => onSelect('__list__')} /> : selected && editingId === selected.id && onSave ? <MilestoneForm key={selected.id} milestone={selected} tasks={tasks} onSave={async data => { await onSave(data, selected.id); setEditingId(null); }} onCancel={() => setEditingId(null)} /> : selected ? <div className="space-y-4">
          <p className="text-sm">{milestonePresentation(selected, tasks).label} · {selected.dueDate ? `${selected.kind === 'date' ? '日付' : '目標日'} ${format(selected.dueDate, 'yyyy/M/d')}` : '期限未設定'}</p>
          <div><h3 className="mb-1 text-sm font-medium">達成条件・説明</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{selected.achievementCondition || selected.description || 'まだ設定されていません。'}</p></div>
          <div><h3 className="mb-2 text-sm font-medium">関連タスク · 完了 {linked.filter(task => task.isCompleted).length}/{linked.length}件</h3>
            {!linked.length && <p className="text-sm text-muted-foreground">関連タスクは未設定です。</p>}
            <div className="space-y-2">{[...linked].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted)).map(task => <button key={task.id} type="button" className={taskRowInteraction + ' flex w-full items-start justify-between gap-2 rounded border p-2 text-left text-sm'} onClick={() => { onSelect(null); onTaskClick(task.id); }}><span className={task.isCompleted ? 'line-through text-muted-foreground' : undefined}>{task.title || '名称未設定のタスク'}</span><span className="shrink-0 text-xs text-muted-foreground">{task.isCompleted ? '完了' : '未完了'}</span></button>)}</div>
          </div>
          <div className="flex gap-2">{onSave && <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(selected.id)}>節目を編集</Button>}<Button type="button" variant="ghost" size="sm" onClick={() => onSelect('__list__')}>節目の一覧へ</Button></div>
        </div> : <div className="space-y-2">
          {!milestones.length && <p className="text-sm text-muted-foreground">節目はまだありません。</p>}
          {milestones.map(item => <button key={item.id} type="button" className="flex w-full items-start justify-between gap-2 rounded border p-3 text-left text-sm hover:bg-muted" onClick={() => onSelect(item.id)}><span>{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{item.dueDate ? format(item.dueDate, 'M/d') : '期限未設定'} · {milestonePresentation(item, tasks).label}</span></button>)}
        </div>}
        {selectedId !== '__new__' && onAdd && <Button type="button" disabled={isLoading || error} onClick={() => onSelect('__new__')}><Plus className="h-4 w-4" />節目・出展日を追加</Button>}
        {selectedId !== '__new__' && <Button asChild variant="outline"><Link href={`/projects/${projectId}/milestones`} onClick={() => onSelect(null)}>すべての節目・編集</Link></Button>}
      </DialogContent>
    </Dialog>
  </div>;
}
