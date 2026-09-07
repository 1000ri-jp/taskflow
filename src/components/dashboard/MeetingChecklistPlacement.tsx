'use client';

import { useState } from 'react';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { accessibleChecklistTasks, checklistDestination, type ChecklistProject } from '@/lib/dashboard/meeting-checklists';
import { safeMeetingText } from '@/lib/dashboard/meeting-proposals';
import { useMeetingChecklistStore } from '@/stores/meetingChecklistStore';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function MeetingChecklistPlacement({ bundleId, title, tasks, projects, ready }: {
  bundleId: string; title: string; tasks: DashboardTask[]; projects: ChecklistProject[]; ready: boolean;
}) {
  const { placements, setPlacement } = useMeetingChecklistStore();
  const placement = placements[bundleId];
  const destination = checklistDestination(bundleId,tasks,projects,ready,placement);
  const [open,setOpen] = useState(false);
  const [selectedKey,setSelectedKey] = useState('');
  const [checklistTitle,setChecklistTitle] = useState(title);
  const [search,setSearch] = useState('');
  const [error,setError] = useState('');
  const accessible = ready ? accessibleChecklistTasks(tasks,projects) : [];
  const key = (task: DashboardTask) => JSON.stringify([task.projectId,task.id]);
  const filtered = accessible.filter(task => key(task) === selectedKey || (task.title + ' ' + task.projectName).toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <button type="button" className="rounded text-left text-[11px] text-blue-700 hover:underline focus-visible:ring-2" aria-label={title + 'の追加先を設定'} onClick={() => {
      setSelectedKey(destination.task ? key(destination.task) : '');
      setChecklistTitle(placement?.title ?? title); setSearch(''); setError(''); setOpen(true);
    }}>追加先を設定</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>チェックリストの追加先</DialogTitle><DialogDescription>既存の大タスクの中に追加する下書きです。実際のタスク・チェックリストの作成や移動は行いません。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          const task = accessible.find(t => key(t) === selectedKey);
          if (!task || !setPlacement(bundleId,{projectId:task.projectId,taskId:task.id,title:checklistTitle})) {
            setError('現在参照できる大タスクと、認証情報を含まないチェックリスト名を指定してください。'); return;
          }
          setOpen(false);
        }}>
          <label className="block space-y-1 text-sm"><span>大タスクを検索</span><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="タスク名・プロジェクト名" disabled={!ready}/></label>
          <label className="block space-y-1 text-sm"><span>追加先の大タスク</span>
            <select className="h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={selectedKey} onChange={e=>setSelectedKey(e.target.value)} disabled={!ready} required>
              <option value="">大タスクを選択</option>
              {filtered.map(task=><option key={key(task)} value={key(task)}>{safeMeetingText(task.projectName)} ／ {safeMeetingText(task.title)}{task.isCompleted ? '（完了済み）' : task.isAbandoned ? '（中止済み）' : ''}</option>)}
            </select>
          </label>
          {!ready && <p role="status" className="text-xs text-amber-800">実データを照合できるまで追加先の選択を保留しています。</p>}
          {destination.state === 'ambiguous' && <p className="text-xs text-amber-800">同じ名前の大タスクが複数あります。プロジェクトも確認してください。</p>}
          {accessible.some(t=>key(t)===selectedKey && (t.isCompleted || t.isAbandoned)) && <p className="text-xs text-amber-800">完了・中止済みの大タスクです。下書きの対応先としてのみ保存し、再開しません。</p>}
          <label className="block space-y-1 text-sm"><span>チェックリスト名</span><Input maxLength={160} required value={checklistTitle} onChange={e=>setChecklistTitle(e.target.value)}/></label>
          <p className="text-xs text-muted-foreground">既存作業との重複照合と、追加先の大タスクは別に管理します。未指定の担当・期限は補完しません。</p>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!ready || !selectedKey}>追加先を下書きに保存</Button><Button type="button" variant="outline" onClick={()=>setOpen(false)}>キャンセル</Button>
            {placement && <Button type="button" variant="ghost" onClick={()=>{setPlacement(bundleId);setOpen(false);}}>追加先の指定を解除</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
