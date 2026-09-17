'use client';

import { ProjectAssigneeBackfill } from './ProjectAssigneeBackfill';
import { useState } from 'react';
import { SettingField, settingSelect } from '@/components/ui/setting-field';
import { Button } from '@/components/ui/button';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import type { Project } from '@/types';

export function ProjectDefaultAssignee({ project, canEdit, onSave }: {
  project: Project; canEdit: boolean; onSave: (patch: { defaultAssigneeId: string | null }) => Promise<void>;
}) {
  const members = useMeetingMembers([project], true);
  const [selection, setSelection] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const value = selection ?? project.defaultAssigneeId ?? '';
  return <section aria-label="新規タスクの主担当" className="space-y-2">
    <SettingField id="project-default-assignee" label="主担当（新規タスクの初期値）" saveLabel="主担当を保存"
      description="プロジェクトの所有者・権限とは別の設定です。サブタスクは親の担当を引き継ぎ、既存タスクは変更しません。"
      busy={busy} disabled={!canEdit || selection === undefined || members.isLoading || members.hasError} error={error} message={message}
      onSave={async () => {
        setBusy(true); setError(''); setMessage('');
        try { await onSave({ defaultAssigneeId: value || null }); setSelection(undefined); setMessage('主担当を保存しました。次の新規タスクから使います。'); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '保存できませんでした。選択を保持しています。'); }
        finally { setBusy(false); }
      }}>
      <select id="project-default-assignee" className={settingSelect} value={value} disabled={!canEdit || busy || members.isLoading || members.hasError} onChange={event => { setSelection(event.target.value); setMessage(''); setError(''); }}>
        <option value="">担当未設定</option>{members.users.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        {value && !members.users.some(member => member.id === value) && <option value={value}>現在のメンバーではありません</option>}
      </select>
    </SettingField>
    {canEdit && project.defaultAssigneeId && project.memberIds.includes(project.defaultAssigneeId) && <ProjectAssigneeBackfill key={project.defaultAssigneeId} projectId={project.id} assigneeId={project.defaultAssigneeId} name={members.users.find(member => member.id === project.defaultAssigneeId)?.displayName || '主担当'} />}
    {members.hasError && <p role="alert" className="text-sm text-destructive">メンバーを取得できません。<Button type="button" size="sm" variant="ghost" onClick={members.refresh}>再取得</Button></p>}
  </section>;
}
