'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Archive, ArchiveRestore, Trash2, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProjectMembers, type ProjectMemberProfile } from './ProjectMembers';
import { ControlHint } from '@/components/ui/control-hint';
import type { Project } from '@/types';
import type { ProjectProgressState } from '@/lib/project/progress';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';

interface ProjectCardProps {
  project: Project;
  members?: readonly ProjectMemberProfile[];
  taskCount?: number;
  taskProgress?: ProjectProgressState;
  onArchive?: (projectId: string) => void;
  onRestore?: (projectId: string) => void;
  onDelete?: (projectId: string) => void;
}

export function ProjectCard({
  project,
  members = [],
  taskCount,
  taskProgress,
  onArchive,
  onRestore,
  onDelete,
}: ProjectCardProps) {
  return (
    <Card className="group relative gap-3 overflow-hidden py-4 transition-shadow hover:shadow-md" data-testid="project-card">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: project.color }}
      />

      <CardHeader className="flex flex-row items-start justify-between space-y-0 px-4 pb-0">
        <Link
          href={`/projects/${project.id}/board`}
          className="flex min-w-0 items-center gap-3"
        >
          {project.iconUrl ? (
            <Image
              src={project.iconUrl}
              alt={project.name}
              width={40}
              height={40}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
              style={{ backgroundColor: `${project.color}20` }}
            >
              {project.icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="break-words font-semibold leading-none tracking-tight hover:underline">
              {project.name}
            </h3>
            {project.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>}
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`${project.name}の操作`}>
          <ControlHint label="設定"><Button asChild variant="ghost" size="icon" className="h-8 w-8"><Link href={`/projects/${project.id}/settings`} aria-label="設定"><Settings className="h-4 w-4" aria-hidden="true" /></Link></Button></ControlHint>
          {project.isArchived ? onRestore && <ControlHint label="復元"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`${project.name}を復元`} onClick={() => onRestore(project.id)}><ArchiveRestore className="h-4 w-4" aria-hidden="true" /></Button></ControlHint>
            : onArchive && <ControlHint label="アーカイブ"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`${project.name}をアーカイブ`} onClick={() => onArchive(project.id)}><Archive className="h-4 w-4" aria-hidden="true" /></Button></ControlHint>}
          {project.isArchived && onDelete && <ControlHint label="削除"><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-600" aria-label={`${project.name}を削除`} onClick={() => onDelete(project.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></ControlHint>}
        </div>
      </CardHeader>

      <CardContent className="px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <ProjectMembers memberIds={project.memberIds} members={members} />
          <p className="ml-auto text-right text-xs text-muted-foreground"><span className="sr-only">プロジェクト情報の</span>更新: {formatDistanceToNow(project.updatedAt, { addSuffix: true, locale: ja })}</p>
        </div>
        {!taskProgress && taskCount !== undefined && <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">{taskCount} タスク</p>}
        {taskProgress && (
          <div className="mt-2 border-t pt-2 text-sm" aria-label="タスクの進捗">
            {taskProgress.status === 'loading' ? (
              <p role="status" className="text-muted-foreground">タスクの進捗を読み込み中…</p>
            ) : taskProgress.status === 'error' ? (
              <p role="status" className="text-amber-800 dark:text-amber-300">タスクの進捗を取得できません</p>
            ) : taskProgress.progress.total === 0 ? (
              <p className="text-muted-foreground">0 タスク</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>完了 {taskProgress.progress.completed} / {taskProgress.progress.total}件</span>
                <span className="text-muted-foreground">未完了 {taskProgress.progress.remaining}件</span>
                {taskProgress.progress.overdue > 0 && <span className="text-amber-800 dark:text-amber-300">期限超過 {taskProgress.progress.overdue}件</span>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
