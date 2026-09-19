'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useParams } from 'next/navigation';
import { Flag, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MilestoneForm } from '@/components/board/MilestoneForm';
import type { MilestoneInput } from '@/hooks/useProjectMilestones';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { createMilestone, deleteMilestone, subscribeToProjectMilestones, subscribeToProjectTasks, updateMilestone, updateTask } from '@/lib/firebase/firestore';
import { calculateMilestoneProgress, milestonePresentation } from '@/lib/milestones';
import type { Milestone, Task } from '@/types';


export default function ProjectMilestonesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { user } = useAuthStore();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    queueMicrotask(() => { if (active) { setIsLoading(true); setError(null); } });
    const stopMilestones = subscribeToProjectMilestones(projectId, (next) => { setMilestones(next); setIsLoading(false); }, () => { setError('マイルストーンを取得できませんでした。'); setIsLoading(false); });
    const stopTasks = subscribeToProjectTasks(projectId, setTasks, () => setError('タスクを取得できませんでした。'));
    return () => { active = false; stopMilestones(); stopTasks(); };
  }, [projectId]);

  const taskCounts = useMemo(() => new Map(milestones.map((milestone) => [milestone.id, calculateMilestoneProgress(milestone, tasks)])), [milestones, tasks]);
  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (milestone: Milestone) => { setEditing(milestone); setFormOpen(true); };
  const save = async (input: MilestoneInput) => {
    if (!user) throw new Error('ログインを確認してください。');
    const data = { ...input, status: input.status ?? 'planned' as const, achievedAt: input.status === 'achieved' ? editing?.achievedAt ?? new Date() : null };
    if (editing) await updateMilestone(projectId, editing.id, data);
    else await createMilestone(projectId, { ...data, order: Math.max(-1, ...milestones.map(item => item.order)) + 1, createdBy: user.id });
    setFormOpen(false);
  };
  const remove = async (milestone: Milestone) => {
    if (!window.confirm(`「${milestone.title}」を削除しますか？`)) return;
    try { await deleteMilestone(projectId, milestone.id); } catch { setError('マイルストーンを削除できませんでした。'); }
  };
  const bindTask = async (taskId: string, value: string) => {
    try { await updateTask(projectId, taskId, { milestoneId: value || null }); } catch { setError('タスクの紐付けを更新できませんでした。'); }
  };

  if (projectLoading) return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return <div className="space-y-5 p-1 sm:p-2">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Flag className="h-5 w-5" />マイルストーン</h2><p className="mt-1 text-sm text-muted-foreground">{project?.name}の節目と関連タスクを管理します。</p></div><Button type="button" onClick={openNew}><Plus className="mr-2 h-4 w-4" />マイルストーンを追加</Button></div>
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {formOpen && <div className="rounded-lg border bg-background p-4"><MilestoneForm key={editing?.id ?? 'new'} milestone={editing ?? undefined} tasks={tasks} onSave={save} onCancel={() => setFormOpen(false)} /></div>}
    {isLoading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p> : milestones.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">マイルストーンはまだありません。</p> : <div className="space-y-3">{milestones.map((milestone) => {
      const progress = taskCounts.get(milestone.id)!;
      return <article key={milestone.id} className="rounded-lg border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm" style={{ backgroundColor: project?.color ?? '#64748b' }}>{project?.icon ?? '📁'}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className="break-words font-semibold">{milestone.title}</h3>
              {milestone.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{milestone.description}</p>}
              <span className="whitespace-nowrap text-xs text-muted-foreground">{milestone.kind === 'date' ? '日付' : '目標日'}：{milestone.dueDate ? format(milestone.dueDate, 'yyyy/M/d') : '未設定'}</span>
              <span className="text-xs text-muted-foreground">{milestone.kind === 'date' ? '準備' : '進捗'}：{progress.isConfigured ? `${progress.completedTaskCount}/${progress.linkedTaskCount}件（${progress.progressPercent}%）` : '未設定'}</span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{milestone.kind ? milestonePresentation(milestone, tasks).label : '期限状態：'}{!milestone.kind && (progress.dueState === 'overdue' ? '期限超過' : progress.dueState === 'due_soon' ? '期限間近' : progress.dueState === 'on_track' ? '余裕あり' : '未設定')}</span>
            </div>
          </div>
          <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`${milestone.title}を編集`} onClick={() => openEdit(milestone)}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`${milestone.title}を削除`} onClick={() => void remove(milestone)}><Trash2 className="h-4 w-4" /></Button></div>
        </div>
      </article>;
    })}</div>}
    <section className="rounded-lg border bg-background p-4"><h3 className="font-semibold">タスクのマイルストーン</h3><p className="mt-1 text-xs text-muted-foreground">既存タスクを選択すると紐付けできます。未設定を選ぶと解除します。</p><div className="mt-3 space-y-2">{tasks.length ? tasks.map((task) => <label key={task.id} className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center"><span className="truncate">{task.title}</span><select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={task.milestoneId ?? ''} onChange={(event) => void bindTask(task.id, event.target.value)}><option value="">未設定</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label>) : <p className="text-sm text-muted-foreground">タスクはありません。</p>}</div></section>
  </div>;
}
