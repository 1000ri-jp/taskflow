'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useProject } from '@/hooks/useProjects';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { resolveTaskAssignees } from '@/lib/task/assigneeDefaults';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** All manual creation surfaces share preview, override, failure retention and submission. */
export function TaskCreationForm({ projectId, parent, listDefaultAssigneeId, onSubmit, onCancel, children, disabled = false,
  label = 'タスクの追加', titleLabel = 'タスク名', submitLabel = '追加' }: {
  projectId: string; parent?: { assigneeIds: string[] }; listDefaultAssigneeId?: string | null;
  onSubmit: (title: string, assigneeIds: string[]) => unknown | Promise<unknown>;
  onCancel: () => void; children?: ReactNode; disabled?: boolean;
  label?: string; titleLabel?: string; submitLabel?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const { project, isLoading, error: projectError } = useProject(projectId, attempt);
  const members = useMeetingMembers(project ? [project] : [], !!project);
  const [title, setTitle] = useState('');
  const [explicit, setExplicit] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const guard = useRef(false);
  const listDefaultIsMember = !!listDefaultAssigneeId && !!project?.memberIds.includes(listDefaultAssigneeId);
  const assigneeIds = resolveTaskAssignees({ explicit, parent, defaultAssigneeId: project?.defaultAssigneeId, listDefaultAssigneeId, memberIds: project?.memberIds });
  const ready = !isLoading && !!project && !projectError && !members.isLoading && !members.hasError;
  const names = assigneeIds.map(id => members.users.find(member => member.id === id)?.displayName || '名前未取得').join('・') || '担当未設定';
  const origin = explicit !== undefined ? '個別指定' : parent ? '親から引き継ぎ' : assigneeIds.length ? listDefaultIsMember && assigneeIds[0] === listDefaultAssigneeId ? 'リストの主担当' : 'プロジェクトの主担当' : '';
  async function submit() {
    if (guard.current || !ready || disabled || !title.trim()) return;
    guard.current = true; setBusy(true); setError('');
    try { await onSubmit(title.trim(), assigneeIds); onCancel(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '追加できませんでした。入力を保持しています。'); }
    finally { guard.current = false; setBusy(false); }
  }
  return <form aria-label={label} className="space-y-2 rounded-lg border bg-background p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-2">
      <Input autoFocus aria-label={titleLabel} placeholder={titleLabel === 'サブタスク名' ? titleLabel : 'タスク名を入力...'} value={title} maxLength={500} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} />
      {children}
      {ready ? <details className="text-sm"><summary className="min-h-8 cursor-pointer py-1 leading-5"><span>担当：{names}</span>{origin && <span className="ml-1 text-xs text-muted-foreground">（{origin}）</span>}</summary>
        <div className="space-y-1 py-1">{members.users.map(member => <label key={member.id} className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={assigneeIds.includes(member.id)} onChange={event => setExplicit(event.target.checked ? [...assigneeIds, member.id] : assigneeIds.filter(id => id !== member.id))} />{member.displayName}</label>)}
          <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setExplicit([])}>担当未設定にする</Button>{explicit !== undefined && <Button type="button" size="sm" variant="ghost" onClick={() => setExplicit(undefined)}>初期値に戻す</Button>}</div>
        </div>
      </details> : <p className="text-xs text-muted-foreground" role={projectError || members.hasError ? 'alert' : 'status'}>{projectError || members.hasError || !isLoading && !project ? '担当の初期値を取得できません。入力を保持しています。' : '担当の初期値を確認中…'}{(projectError || !isLoading && !project) && <Button type="button" size="sm" variant="ghost" onClick={() => setAttempt(value => value + 1)}>再取得</Button>}{members.hasError && <Button type="button" size="sm" variant="ghost" onClick={members.refresh}>再取得</Button>}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={!ready || disabled || !title.trim()}>{busy ? '追加中…' : submitLabel}</Button><Button type="button" size="sm" variant="ghost" onClick={onCancel}>キャンセル</Button></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
