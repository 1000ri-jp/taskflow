'use client';

import { resolveTaskAssignees } from '@/lib/task/assigneeDefaults';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { organizationLabels, type OrganizationContext, type OrganizationDraft } from '@/lib/task/organizationTypes';
import type { Task } from '@/types';

export type OrganizationTaskOption = Pick<Task, 'id' | 'title'> & Partial<Task>;
const dateText = (value: Date | string | null | undefined) => value instanceof Date ? value.toLocaleDateString('ja-JP') : value || '未設定';
const short = (value: string) => { const text = Array.from(value.replace(/\s+/g, ' ').trim()); return text.length > 120 ? `${text.slice(0, 120).join('')}…` : text.join(''); };
export function draftTitle(draft: OrganizationDraft, tasks: OrganizationTaskOption[]) {
  return draft.title || tasks.find(task => task.id === (draft.targetTaskId || draft.taskIds[0]))?.title || '反映する仕事を指定';
}

/** These lines show only saved values and the explicit proposed changes. */
export function DraftComparison({ draft: d, tasks, context }: { draft: OrganizationDraft; tasks: OrganizationTaskOption[]; context: OrganizationContext }) {
  const target = tasks.find(task => task.id === (d.targetTaskId || d.taskIds[0]));
  const isNew = ['create', 'new_parent'].includes(d.kind);
  const changes: { label: string; before: string; after: string }[] = [];
  if (d.title !== undefined) changes.push({ label: '名前', before: isNew ? '新規' : target?.title ?? '変更確認で表示', after: d.title });
  if (d.description !== undefined) changes.push({ label: isNew ? '説明' : d.descriptionMode === 'replace' ? '説明を置換' : '説明に追記', before: isNew ? '新規' : target?.description === undefined ? target ? '既存の説明は変更確認で表示' : '新規' : target.description || '説明なし', after: d.description || '説明なし' });
  const proposedAssignees = isNew ? resolveTaskAssignees({ explicit: d.assigneeIds, parent: d.kind === 'create' && target ? { assigneeIds: target.assigneeIds ?? [] } : null, defaultAssigneeId: context.defaultAssigneeId, memberIds: context.members.map(member => member.id) }) : d.assigneeIds;
  if (proposedAssignees !== undefined) {
    const names = (ids?: string[]) => ids === undefined ? '変更確認で表示' : ids.map(id => context.members.find(member => member.id === id)?.displayName || '名前未取得').join('・') || '未設定';
    changes.push({ label: '担当', before: isNew ? '新規' : names(target?.assigneeIds), after: names(proposedAssignees) });
  }
  if (d.dueDate !== undefined) changes.push({ label: '期限', before: isNew ? '新規' : target?.dueDate === undefined ? '変更確認で表示' : dateText(target.dueDate), after: dateText(d.dueDate) });
  if (d.checklist?.length) changes.push({ label: '手順を追加', before: '既存の手順を保持', after: d.checklist.join(' / ') });
  if (['complete', 'cancel', 'hold', 'wait', 'resume'].includes(d.kind)) changes.push({ label: '状態', before: target?.isCompleted === undefined ? '変更確認で表示' : target.isCompleted ? '完了' : target.isAbandoned ? '中止' : target.workState?.status === 'hold' ? '保留' : target.workState?.status === 'wait' ? '待ち' : '未完了', after: organizationLabels[d.kind] });
  if (!changes.length) changes.push({ label: '仕事の関係', before: d.taskIds.map(id => tasks.find(task => task.id === id)?.title || '名前未取得').join('・') || '対象を指定', after: organizationLabels[d.kind] });
  return <dl className="space-y-1 text-xs">{changes.map((change, index) => <div key={index} className="grid gap-x-2 sm:grid-cols-[6rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{change.label}</dt><dd className="min-w-0 break-words"><span className="text-muted-foreground">{short(change.before)}</span><span aria-hidden="true"> → </span><span className="sr-only">から</span>{short(change.after)}</dd></div>)}</dl>;
}

export function OrganizationDraftEditor({ draft: d, tasks, context, disabled, onChange }: { draft: OrganizationDraft; tasks: OrganizationTaskOption[]; context: OrganizationContext; disabled: boolean; onChange: (next: OrganizationDraft) => void }) {
  const parent = d.kind === 'create' ? tasks.find(task => task.id === (d.targetTaskId ?? d.taskIds[0])) : undefined;
  const selectedAssignees = resolveTaskAssignees({ explicit: d.assigneeIds, parent: parent ? { assigneeIds: parent.assigneeIds ?? [] } : null, defaultAssigneeId: ['create', 'new_parent'].includes(d.kind) ? context.defaultAssigneeId : null, memberIds: context.members.map(member => member.id) });
  const isNew = ['create', 'new_parent'].includes(d.kind);
  const edit = (patch: Partial<OrganizationDraft>) => onChange({ ...d, ...patch });
  const omit = (key: keyof OrganizationDraft) => { const next = { ...d }; delete next[key]; onChange(next); };
  const selectTarget = (id: string) => {
    const next = { ...d, ...(d.kind === 'create' ? { taskIds: [] } : {}) };
    if (id) next.targetTaskId = id; else delete next.targetTaskId;
    onChange(next);
  };
  return <details className="text-xs"><summary className="cursor-pointer py-1 text-primary">内容を修正する</summary><fieldset disabled={disabled} className="mt-2 space-y-3 rounded-lg border p-3">
    <label className="block">扱い<select className="mt-1 block w-full rounded border bg-background px-2 py-2 text-sm" value={d.kind} onChange={event => edit({ kind: event.target.value as OrganizationDraft['kind'] })}>{Object.entries(organizationLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
    <label className="block">{d.kind === 'merge' ? '統合して残す仕事' : d.kind === 'parent_child' ? '親にする仕事' : d.kind === 'dependency' ? '前提を待つ仕事' : '反映先・親（新規なら任意）'}<select className="mt-1 block w-full rounded border bg-background px-2 py-2 text-sm" value={d.targetTaskId ?? (d.kind === 'create' ? d.taskIds[0] ?? '' : '')} onChange={event => selectTarget(event.target.value)}><option value="">指定なし</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
    {['parent_child', 'new_parent', 'related', 'dependency', 'merge'].includes(d.kind) && <fieldset className="max-h-48 space-y-1 overflow-y-auto rounded border p-2"><legend className="px-1">{d.kind === 'dependency' ? '先に完了する仕事' : '整理する仕事'}</legend>{tasks.map(task => <label key={task.id} className="flex items-start gap-2"><input type="checkbox" checked={d.taskIds.includes(task.id)} onChange={event => edit({ taskIds: event.target.checked ? [...new Set([...d.taskIds, task.id])] : d.taskIds.filter(id => id !== task.id) })} /><span>{task.title}</span></label>)}</fieldset>}
    {['update', 'create', 'new_parent', 'checklist'].includes(d.kind) && <label className="block">{d.kind === 'update' ? '名前の変更（空欄なら保持）' : '新しい名前'}<Input className="mt-1" value={d.title ?? ''} maxLength={500} onChange={event => event.target.value ? edit({ title: event.target.value }) : omit('title')} /></label>}
    {['update', 'create', 'new_parent'].includes(d.kind) && <>
      {d.kind === 'update' && <label className="block">説明の反映方法<select className="ml-2 rounded border bg-background p-1" value={d.descriptionMode ?? 'append'} onChange={event => edit({ descriptionMode: event.target.value as 'append' | 'replace' })}><option value="append">追記する</option><option value="replace">全文を置き換える</option></select></label>}
      <label className="block">追記・新しい仕事の内容（完了条件もここへ）<Textarea className="mt-1" rows={4} value={d.description ?? ''} maxLength={8000} onChange={event => edit({ description: event.target.value })} /></label>
      <div className="flex flex-wrap items-end gap-2"><label className="block">期限（任意）<Input className="mt-1 w-auto" type="date" value={d.dueDate ?? ''} onChange={event => event.target.value ? edit({ dueDate: event.target.value }) : omit('dueDate')} /></label><Button type="button" size="sm" variant="ghost" onClick={() => edit({ dueDate: null })}>期限を外す</Button>{d.dueDate !== undefined && <Button type="button" size="sm" variant="ghost" onClick={() => omit('dueDate')}>期限を変更しない</Button>}</div>
      {d.dueDate === null && <p className="text-amber-800">反映すると期限を外します。</p>}
      {['create', 'new_parent'].includes(d.kind) && <label className="block">登録先の列<select className="mt-1 block w-full rounded border bg-background px-2 py-2 text-sm" value={d.listId ?? ''} onChange={event => event.target.value ? edit({ listId: event.target.value }) : omit('listId')}><option value="">既存の反映先と同じ列・先頭の列</option>{context.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>}
      <details><summary className="min-h-8 cursor-pointer py-1">担当：{selectedAssignees.map(id => context.members.find(member => member.id === id)?.displayName || '名前未取得').join('・') || (isNew || d.assigneeIds !== undefined ? '担当未設定' : '変更しない')}（変更）</summary><p className="my-2 text-muted-foreground">{parent ? '親タスクの担当者を初期値にしています。個別に変更できます。' : d.kind === 'create' ? 'プロジェクトの主担当を初期値にしています。親タスクを選ぶと、その担当者を引き継ぎます。' : isNew ? '新しい親タスクの担当を指定できます。'  : '指定しなければ既存の担当を保持します。人ごとの購入等は別々のサブタスクにします。'}</p>{context.members.map(member => <label key={member.id} className="mt-1 flex items-center gap-2"><input type="checkbox" checked={selectedAssignees.includes(member.id)} onChange={event => edit({ assigneeIds: event.target.checked ? [...new Set([...selectedAssignees, member.id])] : selectedAssignees.filter(id => id !== member.id) })} />{member.displayName}</label>)}<Button type="button" variant="ghost" size="sm" onClick={() => edit({ assigneeIds: [] })}>担当未設定にする</Button>{d.assigneeIds !== undefined && <Button type="button" variant="ghost" size="sm" onClick={() => omit('assigneeIds')}>{parent ? '親の担当者に戻す' : isNew ? 'プロジェクトの初期値に戻す' : '担当を変更しない'}</Button>}</details>
    </>}
    {d.kind === 'checklist' && <label className="block">作業手順（1行に1項目）<Textarea className="mt-1" value={d.checklist?.join('\n') ?? ''} rows={4} onChange={event => edit({ checklist: event.target.value.split('\n').filter(Boolean) })} /></label>}
    {['hold', 'wait'].includes(d.kind) && <div className="space-y-2"><label className="block">待つ・止める理由<Input className="mt-1" value={d.workState?.reason ?? ''} onChange={event => edit({ workState: { resumeCondition: '', reviewAt: null, ...d.workState, reason: event.target.value } })} /></label><label className="block">再開・見直しの条件<Input className="mt-1" value={d.workState?.resumeCondition ?? ''} onChange={event => edit({ workState: { reason: '', reviewAt: null, ...d.workState, resumeCondition: event.target.value } })} /></label><label className="block">見直す日（任意）<Input className="mt-1 w-auto" type="date" value={d.workState?.reviewAt?.slice(0, 10) ?? ''} onChange={event => edit({ workState: { reason: '', resumeCondition: '', ...d.workState, reviewAt: event.target.value || null } })} /></label></div>}
  </fieldset></details>;
}
