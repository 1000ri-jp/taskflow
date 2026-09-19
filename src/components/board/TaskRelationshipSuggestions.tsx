'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bot, GitBranch, Combine, Network, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { taskRowInteraction } from '@/components/ui/density';
import { ControlHint } from '@/components/ui/control-hint';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { requestTaskRelationships } from '@/lib/ai/taskRelationshipClient';
import type { TaskRelationshipReport } from '@/lib/ai/taskRelationshipTypes';
import type { Task } from '@/types';
import { organizationTaskVersion } from '@/lib/task/organizationTypes';
import { TaskOrganizer } from '@/components/task/TaskOrganizer';

const kinds = { related: { label: '関連', icon: Network }, parent_child: { label: '親子の候補', icon: GitBranch }, merge: { label: 'まとめる候補', icon: Combine } };

export function TaskRelationshipSuggestions({ projectId, tasks, disabled = false, onTaskClick }: {
  projectId: string; tasks: Task[]; disabled?: boolean; onTaskClick: (taskId: string) => void;
}) {
  const provider = useAISettingsStore(state => state.provider);
  const model = useAISettingsStore(state => state.getActiveModel());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report: TaskRelationshipReport; sourceKey: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingTask = useRef(false);
  const currentTasks = tasks.filter(task => task.projectId === projectId && !task.isArchived && !task.isAbandoned);
  const sourceKey = JSON.stringify(currentTasks.map(task => [task.id, task.title, task.description, task.parentTaskId, task.dependsOnTaskIds, task.assigneeIds, task.dueDate, task.startDate, task.taskKind, task.isCompleted, task.updatedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const stale = !!result && (disabled || result.sourceKey !== sourceKey);
  const report = result?.report;

  useEffect(() => () => request.current?.abort(), []);

  const find = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null); setResult(null);
    try {
      const next = await requestTaskRelationships(projectId, provider, model, controller.signal);
      if (!controller.signal.aborted) setResult({ report: next, sourceKey });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '候補を取得できませんでした。');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  const close = () => {
    request.current?.abort(); request.current = null;
    setBusy(false); setOpen(false);
  };

  return <>
    <ControlHint label="関連・まとめ候補を探す" description="このプロジェクトのタスクをAIが照合します。">
      <Button ref={trigger} variant="outline" size="icon-sm" aria-label="関連・まとめ候補を探す" disabled={disabled} onClick={() => { openingTask.current = false; setOpen(true); if (!result || stale) void find(); }}>
        <Bot className="size-5 text-primary" aria-hidden="true" />
      </Button>
    </ControlHint>
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); if (!openingTask.current) trigger.current?.focus(); }}>
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>関連・まとめ候補</DialogTitle>
          <DialogDescription>このプロジェクト内を照合します。変更する前の提案です。</DialogDescription>
        </DialogHeader>
        {busy && <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />タスクを照合しています…</div>}
        {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Link href="/settings/ai" className="text-xs text-primary underline">AI設定を開く</Link></div>}
        {report && <>
          <p className="text-xs text-muted-foreground">{report.taskCount}件を照合 · {new Date(report.checkedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</p>
          {stale && <p role="status" className="text-sm text-amber-800">タスクが更新されました。もう一度探してください。</p>}
          {!report.suggestions.length ? <p className="py-4 text-sm text-muted-foreground">今回の情報では、関連・まとめ候補は見つかりませんでした。</p> : <div className="space-y-3">
            {report.suggestions.map(suggestion => {
              const kind = kinds[suggestion.kind]; const Icon = kind.icon;
              return <article key={suggestion.id} aria-label={kind.label} className="min-w-0 rounded-xl border bg-card p-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary"><Icon className="size-4" aria-hidden="true" />{kind.label}</h3>
                <div className="space-y-1">{suggestion.tasks.map(task => <button key={task.id} type="button" disabled={disabled || !currentTasks.some(current => current.id === task.id)} onClick={() => { openingTask.current = true; close(); onTaskClick(task.id); }} className={taskRowInteraction + ' flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-sm font-medium disabled:text-muted-foreground disabled:hover:bg-transparent'}>
                  {suggestion.parentTaskId === task.id && <span className="shrink-0 text-xs text-muted-foreground">親</span>}<span className="min-w-0 flex-1 break-words">{task.title}</span><ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                </button>)}</div>
                <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{suggestion.reason}</p>
                <div className="mt-3"><TaskOrganizer projectId={projectId} tasks={currentTasks} disabled={stale || disabled} source={{kind:'existing',id:suggestion.id,version:organizationTaskVersion(currentTasks.filter(t=>suggestion.tasks.some(s=>s.id===t.id))),title:'既存タスクの整理',text:[...suggestion.tasks].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>{const row=currentTasks.find(task=>task.id===t.id);return `${row?.title??t.title}\n${row?.description??''}`;}).join('\n'),occurredAt:null}} initialDraft={{kind:suggestion.kind,taskIds:suggestion.tasks.map(t=>t.id),targetTaskId:suggestion.parentTaskId??suggestion.tasks[0].id,reason:suggestion.reason,quote:suggestion.evidence[0]?.quote??''}} label="変更を確認・採用"/></div>
                <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">根拠</summary><div className="mt-2 space-y-2">{suggestion.evidence.map((evidence, index) => <blockquote key={index} className="break-words border-l-2 pl-2"><span className="mb-1 block font-medium">{suggestion.tasks.find(task => task.id === evidence.taskId)?.title}</span>「{evidence.quote}」</blockquote>)}</div></details>
              </article>;
            })}
          </div>}
        </>}
        <div className="flex flex-wrap justify-end gap-2"><TaskOrganizer projectId={projectId} tasks={currentTasks} disabled={disabled} label="メモ・整理案を入力"/>
          <Button size="sm" variant="ghost" onClick={close}>閉じる</Button>
          <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => void find()}>{error ? 'もう一度試す' : 'もう一度探す'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
