'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { startOfDay } from 'date-fns';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  LayoutDashboard,
  FolderKanban,
  Plus,
  Settings,
  ChevronLeft,
  GripVertical,
  AlertCircle,
  Bell,
  Clock3,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useUIStore } from '@/stores/uiStore';
import { useProjects } from '@/hooks/useProjects';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuthStore } from '@/stores/authStore';
import { buildProjectProgress } from '@/lib/project/progress';
import type { Project } from '@/types';
import { dashboardHref, useDashboardViewStore } from '@/stores/dashboardViewStore';

const navigation = [
  { name: 'ダッシュボード', href: '/', icon: LayoutDashboard },
  { name: 'プロジェクト', href: '/projects', icon: FolderKanban },
];

// Sortable project item component
function SortableProjectItem({
  project,
  isActive,
  isCollapsed,
  disabled,
  overdueCount,
  unreadCount,
  onNavigate,
}: {
  project: Project;
  isActive: boolean;
  isCollapsed: boolean;
  disabled: boolean;
  overdueCount: number;
  unreadCount: number;
  onNavigate: () => void;
}) {
  const attentionId = useId();
  const attention = [overdueCount > 0 && `プロジェクト全体の期限切れ ${overdueCount}件`, unreadCount > 0 && `自分への未読通知 ${unreadCount}件`].filter(Boolean).join('、');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center rounded-lg text-sm transition-colors',
        isActive
          ? 'bg-muted font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'opacity-50',
        isCollapsed ? 'justify-center px-2 py-2' : 'px-1 py-1'
      )}
    >
      {!isCollapsed && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          disabled={disabled}
          aria-label={`${project.name}を並べ替え`}
          title="自分の並び順を変更します。他のメンバーには影響しません。"
          className="flex-shrink-0 cursor-grab rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 active:cursor-grabbing disabled:cursor-default"
        >
          <GripVertical className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      <Link
        href={`/projects/${encodeURIComponent(project.id)}/board`}
        title={attention ? `${project.name} — ${attention}` : project.name}
        aria-label={project.name}
        aria-describedby={attention ? attentionId : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'tf-navigation-link flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-ring',
          isCollapsed ? 'justify-center' : 'px-1 py-1'
        )}
        >
        <div className="relative shrink-0">
        {project.iconUrl ? (
          <Image
            src={project.iconUrl}
            alt=""
            width={isCollapsed ? 32 : 24}
            height={isCollapsed ? 32 : 24}
            className={cn('h-6 w-6 shrink-0 rounded object-cover', isCollapsed && 'h-8 w-8')}
          />
        ) : (
          <div
            className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm', isCollapsed && 'h-8 w-8 text-base')}
            style={{ backgroundColor: project.color }}
            aria-hidden="true"
          >
            {project.icon || '📁'}
          </div>
        )}
        {isCollapsed && attention && <span aria-hidden="true" className="absolute -right-1 -top-1 flex gap-0.5">
          {overdueCount > 0 && <span className="size-2.5 rounded-full border-2 border-background bg-rose-600" />}
          {unreadCount > 0 && <span className="size-2.5 rounded-full border-2 border-background bg-sky-600" />}
        </span>}
        </div>
        {!isCollapsed && <>
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          {attention && <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-medium leading-none tabular-nums">
            {overdueCount > 0 && <span title={`期限切れ ${overdueCount}件`} className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-1 text-rose-700 dark:bg-rose-950 dark:text-rose-200"><Clock3 className="size-3" />{overdueCount > 99 ? '99+' : overdueCount}</span>}
            {unreadCount > 0 && <span title={`未読通知 ${unreadCount}件`} className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-1 text-sky-700 dark:bg-sky-950 dark:text-sky-200"><Bell className="size-3" />{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </span>}
        </>}
        {attention && <span id={attentionId} className="sr-only">{attention}</span>}
      </Link>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { isSidebarOpen, isSidebarCollapsed, setSidebarOpen, setSidebarCollapsed, openProjectModal } = useUIStore();
  const { projects, isLoading, error, reorder } = useProjects();
  const { allProjectTasks, projectTaskStatus } = useMyTasks();
  const { notifications, isLoading: notificationsLoading, error: notificationsError } = useNotifications();
  const userId = useAuthStore(state => state.user?.id);
  const [today, setToday] = useState(() => startOfDay(new Date()).getTime());
  useEffect(() => {
    const refreshDay = () => setToday(startOfDay(new Date()).getTime());
    const timer = window.setInterval(refreshDay, 60_000);
    window.addEventListener('focus', refreshDay);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshDay); };
  }, []);
  const progressByProject = useMemo(() => buildProjectProgress(projects.map(project => project.id), allProjectTasks, new Date(today)), [projects, allProjectTasks, today]);
  const unreadByProject = useMemo(() => {
    const counts = new Map<string, number>();
    if (!userId || notificationsLoading || notificationsError) return counts;
    for (const notice of notifications) {
      if (!notice.isRead && notice.userId === userId) counts.set(notice.projectId, (counts.get(notice.projectId) ?? 0) + 1);
    }
    return counts;
  }, [notifications, notificationsLoading, notificationsError, userId]);
  const dashboardView = useDashboardViewStore(state => state.view);
  const closeOnMobile = () => { if (window.matchMedia('(max-width: 1023px)').matches) setSidebarOpen(false); };
  const projectStatus = error
    ? projects.length ? '一覧の取得・更新に失敗しました。最後に取得できたプロジェクトを表示しています。' : 'プロジェクトを取得できませんでした。'
    : isLoading
      ? projects.length ? 'プロジェクトを更新中です。前回取得した一覧を表示しています。' : 'プロジェクトを読み込み中です。'
      : projects.length === 0 ? '参加中のプロジェクトはありません。' : null;
  const StatusIcon = error ? AlertCircle : isLoading ? Loader2 : FolderKanban;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    if (isLoading || error) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const newOrder = arrayMove(projects, oldIndex, newIndex);
      try { await reorder(newOrder.map((p) => p.id)); }
      catch { /* useProjects exposes the failure in the project list status. */ }
    }
  };

  if (!isSidebarOpen) return null;

  return (
    <>
      {/* モバイル用オーバーレイ */}
      <div
        className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={cn(
          'tf-sidebar fixed inset-y-0 left-0 z-40 flex min-h-0 flex-col border-r bg-background transition-all duration-300 lg:static lg:h-full',
          isSidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          {!isSidebarCollapsed && (
            <span className="font-semibold">メニュー</span>
          )}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={isSidebarCollapsed ? 'メニューを広げる' : 'メニューを縮める'}
              onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
              className={cn(isSidebarCollapsed && 'mx-auto', 'hidden lg:flex')}
            >
              <ChevronLeft
                className={cn(
                  'h-4 w-4 transition-transform',
                  isSidebarCollapsed && 'rotate-180'
                )}
              />
            </Button>
            {/* モバイル用閉じるボタン */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(false)}
              aria-label="メニューを閉じる"
              className="lg:hidden"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-4">
        <nav aria-label="メインメニュー" className="flex flex-col gap-1">
          {navigation.map((item) => {
            const isDashboard = item.href === '/';
            const isActive = isDashboard ? ['/', '/classic', '/my-dashboard', '/neo'].includes(pathname) : pathname === item.href;
            return (
              <Link
                key={item.name}
                href={isDashboard ? dashboardHref(dashboardView) : item.href}
                title={item.name}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                onClick={closeOnMobile}
                className={cn(
                  'tf-navigation-link flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isSidebarCollapsed && 'h-12 w-full justify-center px-2 py-0'
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', isSidebarCollapsed && 'h-6 w-6')} aria-hidden="true" />
                {!isSidebarCollapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        <Separator className="my-4" />

        <div className="space-y-2">
          <div className="flex items-center justify-between px-3">
            {!isSidebarCollapsed && (
              <span className="text-xs font-medium uppercase text-muted-foreground">
                参加中のプロジェクト
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="プロジェクトを作成"
              title="プロジェクトを作成"
              onClick={() => openProjectModal()}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {projectStatus && <div role={error ? 'alert' : 'status'} title={projectStatus} className={cn('flex gap-2 px-3 py-2 text-xs text-muted-foreground', isSidebarCollapsed && 'justify-center')}>
            <StatusIcon className={cn('h-4 w-4 shrink-0', isLoading && !error && 'animate-spin')} aria-hidden="true" />
            <p className={isSidebarCollapsed ? 'sr-only' : undefined}>{projectStatus}</p>
          </div>}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={projects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <nav aria-label="参加中のプロジェクト" className="flex flex-col gap-1" aria-busy={isLoading}>
                {projects.map((project) => {
                  const projectPath = `/projects/${encodeURIComponent(project.id)}`;
                  const isActive = pathname === projectPath || pathname.startsWith(`${projectPath}/`);
                  return (
                    <SortableProjectItem
                      key={project.id}
                      project={project}
                      isActive={isActive}
                      isCollapsed={isSidebarCollapsed}
                      disabled={isLoading || !!error}
                      overdueCount={userId && projectTaskStatus.get(project.id)?.status === 'ready' ? progressByProject.get(project.id)?.overdue ?? 0 : 0}
                      unreadCount={unreadByProject.get(project.id) ?? 0}
                      onNavigate={closeOnMobile}
                    />
                  );
                })}
              </nav>
            </SortableContext>
          </DndContext>
        </div>
      </ScrollArea>

        <div className="flex-shrink-0 border-t p-2">
          <Link
            href="/settings"
            aria-label="設定"
            title="設定"
            onClick={closeOnMobile}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
              isSidebarCollapsed && 'h-12 w-full justify-center px-2 py-0'
            )}
          >
            <Settings className={cn('h-4 w-4 shrink-0', isSidebarCollapsed && 'h-6 w-6')} aria-hidden="true" />
            {!isSidebarCollapsed && <span>設定</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
