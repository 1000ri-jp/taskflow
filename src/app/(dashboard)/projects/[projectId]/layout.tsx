'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Columns3, ChartNoAxesColumnIncreasing, GanttChart, Settings, History, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { useProject } from '@/hooks/useProjects';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { ProjectMembers } from '@/components/project/ProjectMembers';
import { useProjectTaskViewNavigation } from '@/hooks/useProjectTaskViewNavigation';
import { TaskViewSwitcher } from '@/components/board/TaskViewSwitcher';
import { ProjectLinks } from '@/components/board/ProjectLinks';
import { projectViewHref } from '@/lib/board/projectNavigation';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const { project: loadedProject, isLoading, error, update } = useProject(projectId);
  // A route change may briefly retain the previous subscription's project.
  const project = loadedProject?.id === projectId ? loadedProject : null;
  const memberProfiles = useMeetingMembers(project ? [{ memberIds: project.memberIds }] : [], !!project);
  const { view, primaryView, changeView, setCurrentViewAsDefault, canSave, persistenceFailed } = useProjectTaskViewNavigation(projectId);

  useEffect(() => {
    if (project && !error && canSave && pathname === `/projects/${projectId}/board` && view === 'gantt') changeView('gantt');
  }, [project, error, canSave, pathname, projectId, view, changeView]);

  if (!project && !error && (isLoading || loadedProject)) {
    return (
      <div role="status" className="flex min-h-[400px] items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">プロジェクトを読み込み中です。</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <div role={error ? 'alert' : 'status'} className="text-center">
          <h2 className="text-lg font-semibold">{error ? 'プロジェクトを表示できません' : 'プロジェクトが見つかりません'}</h2>
          {error && <p className="mt-2 text-sm text-muted-foreground">情報の取得に失敗しました。時間をおいて開き直してください。</p>}
        </div>
        <Button asChild className="mt-4">
          <Link href="/projects">プロジェクト一覧に戻る</Link>
        </Button>
      </div>
    );
  }

  const currentTab = pathname.split('/').pop();
  const navParams = new URLSearchParams(searchParams.toString());
  const tabs = [
    { name: 'カンバン', description: 'リストごとにタスクをカードで表示します。', view: 'board' as const, icon: Columns3, active: currentTab === 'board' && view === 'board' },
    { name: 'カンバン進捗', description: '未着手・着手・待機・完了・アーカイブを一覧で確認します。', view: 'progress' as const, icon: ChartNoAxesColumnIncreasing, active: currentTab === 'board' && view === 'progress' },
    { name: 'カレンダー', description: 'タスクの開始日・期限と、節目をカレンダーで確認します。', view: 'calendar' as const, icon: CalendarDays, active: currentTab === 'board' && view === 'calendar' },
    { name: 'ガントチャート', description: '作業の期間や重なり、前後関係を確認します。', view: 'gantt' as const, icon: GanttChart, active: currentTab === 'gantt' },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error ? <p role="alert" className="mb-3 shrink-0 rounded-lg border px-3 py-2 text-sm">プロジェクト情報の取得・更新に失敗しました。最後に取得できた内容を表示しています。</p>
        : isLoading && <p role="status" className="mb-3 shrink-0 text-sm text-muted-foreground">プロジェクトを更新中です。前回取得した内容を表示しています。</p>}
      {/* Twitter/X Style Header */}
      <div className="relative mb-4 flex-shrink-0">
        {/* Back Button - Absolute positioned */}
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="absolute left-2 top-2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background/90"
        >
          <Link href="/projects" aria-label="プロジェクト一覧に戻る" title="プロジェクト一覧に戻る">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>

        {/* Header Image or Colored Banner */}
        <div
          data-testid="project-header-banner"
          className="relative aspect-[10/1] max-h-[120px] w-full overflow-hidden rounded-lg sm:max-h-[130px]"
          style={{
            backgroundColor: project.headerImageUrl ? undefined : `${project.color}30`,
          }}
        >
          {project.headerImageUrl && (
            <Image
              src={project.headerImageUrl}
              alt={`${project.name} header`}
              fill
              sizes="100vw"
              className="object-cover"
            />
          )}
        </div>

        {/* Avatar - Overlapping */}
        <div className="absolute -bottom-6 left-3 sm:-bottom-7 sm:left-4 lg:-bottom-8">
          <div className="rounded-full border-2 sm:border-4 border-background bg-background">
            {project.iconUrl ? (
              <div className="relative h-12 w-12 overflow-hidden rounded-full sm:h-14 sm:w-14 lg:h-16 lg:w-16">
                <Image
                  src={project.iconUrl}
                  alt={project.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div
                className="flex h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 items-center justify-center rounded-full text-xl sm:text-2xl"
                style={{ backgroundColor: `${project.color}40` }}
              >
                {project.icon}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Project Info - Below Avatar */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pl-[72px] sm:pl-20 lg:pl-24">
        <div className="flex min-w-0 max-w-full items-center gap-1">
          <h1 className="min-w-0 break-words text-xl font-bold">{project.name}</h1>
          <ControlHint label="設定" description="プロジェクトの基本情報やメンバーを設定します。">
            <Link href={`/projects/${projectId}/settings`} aria-label="プロジェクト設定" aria-current={currentTab === 'settings' ? 'page' : undefined}
              className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring', currentTab === 'settings' ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
          </ControlHint>
        </div>
        {project.description && (
          <p className="min-w-0 text-sm text-muted-foreground line-clamp-1">
            {project.description}
          </p>
        )}
        <div className="min-w-0 sm:ml-4" aria-busy={memberProfiles.isLoading}>
          <ProjectMembers memberIds={project.memberIds} members={memberProfiles.users} />
          {memberProfiles.hasError && <p role="status" className="mt-1 text-xs text-muted-foreground">メンバー情報を取得できません。<button type="button" className="ml-1 underline" onClick={memberProfiles.refresh}>再取得</button></p>}
        </div>
        <ProjectLinks key={projectId} urls={project.urls ?? []} onUpdate={async urls => { await update({ urls }); }} />
      </div>

      <div className="mb-4 flex-shrink-0 border-b">
        <nav aria-label="プロジェクトの表示" className="-mb-px flex flex-wrap items-center gap-x-1 gap-y-2">
          {tabs.map(tab => <ControlHint key={tab.name} label={tab.name} description={tab.description}><Link href={projectViewHref(projectId, tab.view, navParams, primaryView)} aria-current={tab.active ? 'page' : undefined} aria-label={tab.name}
            className={cn('flex h-10 w-10 items-center justify-center border-b-2 focus-visible:outline-2 focus-visible:outline-ring', tab.active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <tab.icon className="h-4 w-4" />
          </Link></ControlHint>)}
          <ControlHint label="アクティビティ" description="プロジェクトの変更履歴を確認します。">
            <Link href={`/projects/${projectId}/activity`} aria-label="アクティビティ" aria-current={currentTab === 'activity' ? 'page' : undefined}
              className={cn('flex h-10 w-10 items-center justify-center border-b-2 focus-visible:outline-2 focus-visible:outline-ring', currentTab === 'activity' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <History className="h-4 w-4" />
            </Link>
          </ControlHint>
          {(currentTab === 'board' || currentTab === 'gantt') && <div className="ml-auto"><TaskViewSwitcher view={currentTab === 'gantt' ? 'gantt' : view} primaryView={primaryView} onChange={changeView} onSetDefault={setCurrentViewAsDefault} canSave={canSave} persistenceFailed={persistenceFailed} /></div>}
        </nav>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
