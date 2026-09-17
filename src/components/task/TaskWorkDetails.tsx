"use client";
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTaskWorkflow } from '@/hooks/useTaskWorkflow';
import { useProjectMilestones } from '@/hooks/useProjectMilestones';
import { ProjectMilestones } from '@/components/board/ProjectMilestones';
import type { Task } from '@/types';
export function TaskWorkDetails({ task, tasks, userId, names }: { task: Task; tasks: Task[]; userId: string; names: Record<string, string> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const milestones = useProjectMilestones(task.projectId);
  return <section className="my-2 space-y-1 text-xs" aria-label="完了条件・役割・節目">
    {task.completionCriteria && <p className="whitespace-pre-wrap break-words">完了条件：{task.completionCriteria}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{task.taskKind === 'review_request' ? '確認' : task.taskKind === 'decision' ? '判断' : '作業'}</span>
      {task.primaryAssigneeId && task.assigneeIds.includes(task.primaryAssigneeId) && <span>主担当：{names[task.primaryAssigneeId] ?? '名前は未取得'}</span>}
      {milestones.milestones.filter(m => m.id === task.milestoneId || m.requiredTaskIds?.includes(task.id)).map(m => <button key={m.id} type="button" className="text-blue-700 underline" onClick={() => milestones.setSelectedId(m.id)}>{m.title}</button>)}
      {task.milestoneId && !milestones.milestones.some(m => m.id === task.milestoneId) && <button type="button" className="text-muted-foreground underline" onClick={() => milestones.setSelectedId(task.milestoneId!)}>{milestones.isLoading ? '節目を読み込み中…' : '関連する節目は未取得'}</button>}
      {!task.isArchived && !task.isAbandoned && <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setEditing(!editing)}>完了条件・役割・節目を編集</Button>}
    </div>
    {editing && <WorkDetailsForm key={task.id} task={task} userId={userId} names={names} milestones={milestones} onClose={() => setEditing(false)} />}
    <div className="hidden"><ProjectMilestones {...milestones} tasks={tasks} projectId={task.projectId} onSelect={milestones.setSelectedId} onTaskClick={id => router.push(`/projects/${task.projectId}/board?task=${encodeURIComponent(id)}`)} /></div>
  </section>;
}
function WorkDetailsForm({ task, userId, names, milestones, onClose }: { task: Task; userId: string; names: Record<string,string>; milestones: ReturnType<typeof useProjectMilestones>; onClose: () => void }) {
  const flow = useTaskWorkflow(task, userId, 'details');
  const [criteria, setCriteria] = useState(task.completionCriteria ?? '');
  const [primary, setPrimary] = useState(task.assigneeIds.includes(task.primaryAssigneeId ?? '') ? task.primaryAssigneeId ?? '' : '');
  const [kind, setKind] = useState<'task'|'decision'>(task.taskKind === 'decision' ? 'decision' : 'task');
  const [milestoneId, setMilestoneId] = useState(task.milestoneId ?? '');
  return <form className="space-y-2 rounded border p-3" onSubmit={async e => { e.preventDefault(); if (await flow.run('configure', '', { completionCriteria: criteria, primaryAssigneeId: primary || null, taskKind: kind, milestoneId: milestoneId || null })) onClose(); }}>
    <fieldset disabled={flow.locked} className="space-y-2">
      <label className="block">完了条件（任意）<Textarea rows={2} maxLength={2000} value={criteria} onChange={e => setCriteria(e.target.value)} placeholder="何ができれば終わりか" /></label>
      <div className="flex flex-wrap gap-3">
        {task.taskKind !== 'review_request' && <label>仕事の種類<select className="ml-2 rounded border p-1" value={kind} onChange={e => setKind(e.target.value as 'task'|'decision')}><option value="task">作業</option><option value="decision">判断</option></select></label>}
        <label>主担当（任意）<select className="ml-2 rounded border p-1" value={primary} onChange={e => setPrimary(e.target.value)}><option value="">指定しない</option>{task.assigneeIds.map(id => <option key={id} value={id}>{names[id] ?? '名前は未取得'}</option>)}</select></label>
        <label>節目<select className="ml-2 rounded border p-1" disabled={milestones.isLoading || milestones.error} value={milestoneId} onChange={e => setMilestoneId(e.target.value)}><option value="">なし</option>{milestoneId && !milestones.milestones.some(m => m.id === milestoneId) && <option value={milestoneId}>取得できない節目</option>}{milestones.milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
      </div>
    </fieldset>
    {flow.error && <p role="alert" className="text-destructive">{flow.error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={flow.busy || !!flow.pending} onClick={onClose}>キャンセル</Button><Button type="submit" size="sm" disabled={flow.busy || !flow.ready}>{flow.pending ? '同じ操作を再試行' : '保存'}</Button></div>
  </form>;
}
