'use client';

import { acknowledgeArchive, hasAcknowledgedArchive } from '@/lib/archiveNotice';
import { useAuthStore } from '@/stores/authStore';
import { useEffect, useMemo, useState } from 'react';
import { startOfDay } from 'date-fns';
import { Plus, FolderKanban, Archive, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProjectCard } from '@/components/project/ProjectCard';
import { useProjects, useArchivedProjects } from '@/hooks/useProjects';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { buildProjectProgress } from '@/lib/project/progress';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useUIStore } from '@/stores/uiStore';
import { Loader2 } from 'lucide-react';

export default function ProjectsPage() {
  const userId = useAuthStore(state => state.user?.id);
  const { projects, isLoading, error, archive, remove } = useProjects();
  const { archivedProjects, isLoading: archivesLoading, error: archivesError, restore } = useArchivedProjects();
  const { allProjectTasks, projectTaskStatus, error: tasksError } = useMyTasks();
  const { openProjectModal } = useUIStore();
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const memberProfiles = useMeetingMembers([{ memberIds: [...projects, ...(showArchived ? archivedProjects : [])].flatMap(project => project.memberIds) }], !!userId && !isLoading && !error);
  const [today, setToday] = useState(() => startOfDay(new Date()).getTime());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(startOfDay(new Date()).getTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = search.trim().normalize('NFKC').toLowerCase();
  const matchesName = (name: string) => name.normalize('NFKC').toLowerCase().includes(query);
  const visibleProjects = projects.filter(project => matchesName(project.name));
  const visibleArchives = archivedProjects.filter(project => matchesName(project.name));
  const progressByProject = useMemo(
    () => buildProjectProgress(projects.map(project => project.id), allProjectTasks, new Date(today)),
    [projects, allProjectTasks, today]
  );

  const handleArchive = async (projectId: string) => {
    if (hasAcknowledgedArchive(userId, 'project') || confirm('このプロジェクトをアーカイブしますか？一覧から非表示になりますが、アーカイブ済みプロジェクトから復元できます。この確認は初回のみです（このブラウザ）。')) {
      await archive(projectId, true);
      acknowledgeArchive(userId, 'project');
    }
  };

  const handleRestore = async (projectId: string) => {
    await restore(projectId);
  };

  const handleDelete = async (projectId: string) => {
    if (confirm('このプロジェクトを削除しますか？この操作は取り消せません。')) {
      await remove(projectId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold">プロジェクト</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {isLoading ? '読み込み中…' : error ? '取得できません' : `${query ? `${visibleProjects.length} / ` : ''}${projects.length}件`}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md sm:min-w-64 sm:flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="プロジェクト名で検索" placeholder="プロジェクト名で検索…" value={search} onChange={event => setSearch(event.target.value)} className="pl-9 pr-10" />
            {search && <Button type="button" variant="ghost" size="icon" aria-label="検索をクリア" onClick={() => setSearch('')} className="absolute right-1 top-0.5 h-8 w-8"><X className="h-4 w-4" /></Button>}
          </div>
          <Button className="ml-auto shrink-0" onClick={() => openProjectModal()}>
            <Plus className="mr-2 h-4 w-4" />新規プロジェクト
          </Button>
        </div>
        {isE2EMockAuthEnabled() && <p className="text-xs text-amber-800 dark:text-amber-300">架空データの検証画面です。</p>}
        {memberProfiles.hasError && <p role="status" className="text-xs text-amber-800">メンバー情報を取得できません。<button type="button" className="ml-1 underline" onClick={memberProfiles.refresh}>再取得</button></p>}
      </div>

      {isLoading ? (
        <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />プロジェクトを読み込み中…</div>
      ) : error ? (
        <div role="alert" className="rounded-lg border p-5">
          <p>プロジェクトを取得できませんでした。接続や閲覧権限を確認して、再読み込みしてください。</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => window.location.reload()}>再読み込み</Button>
        </div>
      ) : query && visibleProjects.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">進行中のプロジェクトに一致するものはありません。</p>
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setSearch('')}>検索条件を解除</Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FolderKanban className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">
            プロジェクトがありません
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            新しいプロジェクトを作成して、タスク管理を始めましょう
          </p>
          <Button className="mt-4" onClick={() => openProjectModal()}>
            <Plus className="mr-2 h-4 w-4" />
            プロジェクトを作成
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              members={memberProfiles.users}
              taskProgress={projectTaskStatus.get(project.id)?.status === 'ready'
                ? { status: 'ready', progress: progressByProject.get(project.id)! }
                : { status: projectTaskStatus.get(project.id)?.status === 'error' || (!projectTaskStatus.has(project.id) && tasksError) ? 'error' : 'loading' }}
              onArchive={handleArchive}
            />
          ))}
        </div>
      )}

      {archivesLoading ? <p role="status" className="text-sm text-muted-foreground">アーカイブ済みプロジェクトを読み込み中…</p>
        : archivesError ? <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">アーカイブ済みプロジェクトを取得できませんでした。接続や閲覧権限を確認して、再読み込みしてください。</p>
        : archivedProjects.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="toggle-archived-projects"
            aria-expanded={showArchived}
          >
            {showArchived ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Archive className="h-4 w-4" />
            アーカイブ済みプロジェクト（{query ? `${visibleArchives.length} / ` : ''}{archivedProjects.length}）
          </button>

          {showArchived && (
            <div
              className="grid gap-3 opacity-75 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="archived-projects-section"
            >
              {visibleArchives.length === 0 && <p role="status" className="text-sm text-muted-foreground">検索に一致するアーカイブ済みプロジェクトはありません。</p>}
              {visibleArchives.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  members={memberProfiles.users}
                  onRestore={handleRestore}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
