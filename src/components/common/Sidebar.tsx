'use client';

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
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useUIStore } from '@/stores/uiStore';
import { useProjects } from '@/hooks/useProjects';
import type { Project } from '@/types';

const navigation = [
  { name: 'ダッシュボード', href: '/', icon: LayoutDashboard },
  { name: 'ダッシュボードNeo。', href: '/my-dashboard', icon: Sparkles },
  { name: 'プロジェクト', href: '/projects', icon: FolderKanban },
];

// Sortable project item component
function SortableProjectItem({
  project,
  isActive,
  isCollapsed,
}: {
  project: Project;
  isActive: boolean;
  isCollapsed: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

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
          className="flex-shrink-0 cursor-grab p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
      <Link
        href={`/projects/${project.id}/board`}
        className={cn(
          'flex flex-1 items-center gap-2',
          isCollapsed ? 'justify-center' : 'px-1 py-1'
        )}
        >
        {project.iconUrl ? (
          <Image
            src={project.iconUrl}
            alt={project.name}
            width={isCollapsed ? 32 : 20}
            height={isCollapsed ? 32 : 20}
            className={cn('h-5 w-5 shrink-0 rounded object-cover', isCollapsed && 'h-8 w-8')}
          />
        ) : (
          <div
            className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs', isCollapsed && 'h-8 w-8 text-base')}
            style={{ backgroundColor: project.color }}
          >
            {project.icon}
          </div>
        )}
        {!isCollapsed && <span className="truncate">{project.name}</span>}
      </Link>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { isSidebarOpen, isSidebarCollapsed, setSidebarOpen, setSidebarCollapsed, openProjectModal } = useUIStore();
  const { projects, reorder } = useProjects();

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
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);
      const newOrder = arrayMove(projects, oldIndex, newIndex);
      await reorder(newOrder.map((p) => p.id));
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
          'fixed inset-y-0 left-0 z-40 flex min-h-0 flex-col border-r bg-background transition-all duration-300 lg:static lg:h-full',
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
              className="lg:hidden"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-4">
        <nav className="flex flex-col gap-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isSidebarCollapsed && 'h-12 w-full justify-center px-2 py-0'
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', isSidebarCollapsed && 'h-6 w-6')} />
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
                プロジェクト
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => openProjectModal()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={projects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <nav className="flex flex-col gap-1">
                {projects.map((project) => {
                  const isActive = pathname === `/projects/${project.id}/board`;
                  return (
                    <SortableProjectItem
                      key={project.id}
                      project={project}
                      isActive={isActive}
                      isCollapsed={isSidebarCollapsed}
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
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              isSidebarCollapsed && 'h-12 w-full justify-center px-2 py-0'
            )}
          >
            <Settings className={cn('h-4 w-4 shrink-0', isSidebarCollapsed && 'h-6 w-6')} />
            {!isSidebarCollapsed && <span>設定</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
