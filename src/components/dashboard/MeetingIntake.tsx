'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Project } from '@/types';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { TaskOrganizer } from '@/components/task/TaskOrganizer';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAISettings } from '@/hooks/useAISettings';
import { Button } from '@/components/ui/button';

type DialogProps = { open?: boolean; onOpenChange?: (open: boolean) => void; notice?: ReactNode };
type Props = DialogProps & { projects: Project[]; tasks: DashboardTask[]; disabled: boolean; launcherOnly?: boolean; presentation?: 'dialog' | 'popover'; trigger?: ReactNode };
const mockProjects = [
  { id: 'secretary-demo', name: '架空の制作プロジェクト' },
  { id: 'secretary-demo-office', name: '架空の総務プロジェクト' },
];

export function MeetingIntake(props: Props) {
  return isE2EMockAuthEnabled()
    ? <MeetingScope options={mockProjects} tasks={props.tasks} disabled={false} mock launcherOnly={props.launcherOnly} open={props.open} onOpenChange={props.onOpenChange} notice={props.notice} presentation={props.presentation} trigger={props.trigger} />
    : <ConnectedMeetingIntake {...props} />;
}

function ConnectedMeetingIntake({ projects, tasks, disabled, launcherOnly, open, onOpenChange, notice, presentation, trigger }: Props) {
  const { allowedProjectIds, projectAccessLoaded, projectAccessError, refreshProjectAccess } = useAISettings();
  const options = projects.filter(project => !project.isArchived && (allowedProjectIds === null || allowedProjectIds.includes(project.id)));
  const accessNotice = <>
    {!projectAccessLoaded && !projectAccessError && <p role="status" className="mt-2 text-xs text-muted-foreground">AIの照合対象を確認中…</p>}
    {projectAccessError && <div role="alert" className="mt-2 space-y-2 text-xs text-amber-800"><p>{projectAccessError}</p><Button size="sm" variant="outline" onClick={() => void refreshProjectAccess()}>照合対象を再取得</Button></div>}
  </>;
  return <>
    <MeetingScope options={options} tasks={tasks} disabled={disabled || !projectAccessLoaded || !!projectAccessError} launcherOnly={launcherOnly} open={open} onOpenChange={onOpenChange} notice={<>{notice}{open !== undefined && accessNotice}</>} presentation={presentation} trigger={trigger} />
    {open === undefined && accessNotice}
  </>;
}

function MeetingScope({ options, tasks, disabled, mock = false, launcherOnly = false, open, onOpenChange, notice, presentation = 'dialog', trigger }: DialogProps & { options: { id: string; name: string }[]; tasks: DashboardTask[]; disabled: boolean; mock?: boolean; launcherOnly?: boolean; presentation?: 'dialog' | 'popover'; trigger?: ReactNode }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const candidates = options.filter(project => !excluded.includes(project.id));
  const candidateIds = new Set(candidates.map(project => project.id));
  const organizer = <TaskOrganizer projects={candidates} tasks={tasks.filter(task => candidateIds.has(task.projectId))} source={{ kind: 'meeting', id: 'meeting-intake', title: '会議メモ', text: '', occurredAt: null }} label={launcherOnly ? '会議から整理' : '文字起こし・メモを取り込む'} disabled={disabled || candidates.length === 0} open={open} onOpenChange={onOpenChange} presentation={presentation} trigger={trigger} notice={<>{notice}{!disabled && !candidates.length && <p role="status" className="text-xs text-amber-800">照合できるプロジェクトがありません。AI設定で対象を確認してください。</p>}</>} />;
  if (launcherOnly) return organizer;
  return <section aria-label="会議・メモを取り込む" className="space-y-3 rounded-2xl border bg-background p-4">
    <div><h2 className="text-sm font-semibold">会議・メモから仕事を整理</h2><p className="mt-1 text-xs text-muted-foreground">複数プロジェクトの話が混ざったまま取り込めます。AIが既存タスクへの追記・進捗更新、新しい仕事、確認事項に仕分けます。</p></div>
    {organizer}
    <p className="text-xs text-muted-foreground">仕分け先と変更内容を確認・修正し、選んだ案だけを反映します。</p>
    {options.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">照合するプロジェクト（{candidates.length}件）</summary><div className="mt-2 divide-y rounded-lg border">{options.map(project => <label key={project.id} className="flex items-center gap-2 p-2"><input type="checkbox" checked={!excluded.includes(project.id)} disabled={disabled} onChange={event => setExcluded(values => event.target.checked ? values.filter(id => id !== project.id) : [...values, project.id])} />{project.name}</label>)}</div></details>}
    {!disabled && candidates.length === 0 && <p className="text-xs text-amber-800">{options.length ? '照合するプロジェクトを1つ以上選んでください。' : '照合できるプロジェクトがありません。AI設定で対象を確認してください。'}</p>}
    {!mock && <p className="text-xs text-muted-foreground"><Link href="/settings/ai" className="underline">AI設定</Link>で許可したプロジェクトを照合します。</p>}
    {mock && <p className="text-xs text-amber-800">架空のデータ・分析例です。保存・反映先はこのブラウザの架空データです。</p>}
  </section>;
}
