'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BoardView } from '@/components/board/BoardView';
import { BoardFilterBar, type BoardFilters } from '@/components/board/BoardFilterBar';
import { ProjectUrlsBar } from '@/components/board/ProjectUrlsBar';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { useBoard } from '@/hooks/useBoard';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { AlternateTaskViews } from '@/components/board/AlternateTaskViews';
import { taskMatchesBoardFilters } from '@/lib/board/filters';
import { useProjectTaskViewNavigation } from '@/hooks/useProjectTaskViewNavigation';
import type { ProjectUrl, Task } from '@/types';
import { recalculateDates } from '@/lib/utils/task';

export default function BoardPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get('task');
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { lists, tasks, labels, isLoading, error, editTask, removeTask, duplicateTask, addTask } = useBoard(projectId);
  const { project, update: updateProject } = useProject(projectId);
  const { view, canSave: viewSettingsHydrated } = useProjectTaskViewNavigation(projectId);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({
    keyword: '',
    labelIds: new Set(),
    dueFilter: 'all',
    showCompleted: true,
  });

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) || null
    : null;
  const visibleTasks = tasks.filter(task => task.projectId === projectId && !task.isArchived && taskMatchesBoardFilters(task, filters));

  useEffect(() => {
    setSelectedTaskId(taskIdFromUrl);
  }, [taskIdFromUrl]);

  const updateTaskUrl = useCallback(
    (taskId: string | null) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.delete('comment');
      if (taskId) {
        nextSearchParams.set('task', taskId);
      } else {
        nextSearchParams.delete('task');
      }

      const query = nextSearchParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleTaskClick = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    updateTaskUrl(taskId);
  }, [updateTaskUrl]);

  const handleCloseModal = useCallback(() => {
    if (selectedTaskId) {
      void queryClient.invalidateQueries({ queryKey: ['outline-checklists', user?.id ?? '', projectId, selectedTaskId] });
    }
    setSelectedTaskId(null);
    updateTaskUrl(null);
  }, [updateTaskUrl, queryClient, selectedTaskId, user?.id, projectId]);

  const handleUpdateTask = useCallback(
    (data: Parameters<typeof editTask>[1]) => {
      if (selectedTaskId) {
        editTask(selectedTaskId, data);
      }
    },
    [selectedTaskId, editTask]
  );

  const handleCalendarDateChange = useCallback(async (task: Task, kind: '開始' | '期限' | '開始・期限', date: Date) => {
    const changes = kind === '開始' ? { startDate: date } : kind === '期限' ? { dueDate: date } : { startDate: date, dueDate: date };
    const recalculated = recalculateDates(task, changes);
    await editTask(task.id, {
      startDate: recalculated.startDate,
      dueDate: recalculated.dueDate,
      durationDays: recalculated.durationDays,
      isDueDateFixed: recalculated.isDueDateFixed,
    });
  }, [editTask]);

  const handleDeleteTask = useCallback(() => {
    if (selectedTaskId) {
      removeTask(selectedTaskId);
      setSelectedTaskId(null);
      updateTaskUrl(null);
    }
  }, [selectedTaskId, removeTask, updateTaskUrl]);

  const handleCalendarAddTask = useCallback(async (listId: string, title: string, dueDate: Date) => {
    if (!user?.id) return;
    await addTask(listId, title, user.id, 'bottom', { dueDate });
  }, [addTask, user?.id]);

  const handleDuplicateTask = useCallback(async () => {
    if (selectedTaskId && user) {
      const newTaskId = await duplicateTask(selectedTaskId, user.id);
      if (newTaskId) {
        setSelectedTaskId(newTaskId); // Open the new task
        updateTaskUrl(newTaskId);
      }
    }
  }, [selectedTaskId, user, duplicateTask, updateTaskUrl]);

  // URL handlers
  const handleAddUrl = useCallback(
    async (url: ProjectUrl) => {
      const currentUrls = project?.urls || [];
      await updateProject({ urls: [...currentUrls, url] });
    },
    [project?.urls, updateProject]
  );

  const handleEditUrl = useCallback(
    async (urlId: string, data: Partial<ProjectUrl>) => {
      const currentUrls = project?.urls || [];
      const updatedUrls = currentUrls.map((u) =>
        u.id === urlId ? { ...u, ...data } : u
      );
      await updateProject({ urls: updatedUrls });
    },
    [project?.urls, updateProject]
  );

  const handleRemoveUrl = useCallback(
    async (urlId: string) => {
      const currentUrls = project?.urls || [];
      const updatedUrls = currentUrls.filter((u) => u.id !== urlId);
      await updateProject({ urls: updatedUrls });
    },
    [project?.urls, updateProject]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0">
        <ProjectUrlsBar
          urls={project?.urls || []}
          onAddUrl={handleAddUrl}
          onEditUrl={handleEditUrl}
          onRemoveUrl={handleRemoveUrl}
        />
      </div>
      <div className="flex-shrink-0">
        <BoardFilterBar
          projectId={projectId}
          filters={filters}
          labels={labels}
          tasks={tasks}
          lists={lists}
          onFiltersChange={setFilters}
          onTaskClick={handleTaskClick}
          showCardSettings={view === 'board'}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!viewSettingsHydrated ? <p role="status" className="p-4 text-sm text-muted-foreground">表示設定を読み込み中…</p> : view === 'board' ? <BoardView projectId={projectId} onTaskClick={handleTaskClick} filters={filters} /> : error ? <p role="alert" className="p-4 text-sm text-destructive">タスクを取得できませんでした。接続・権限を確認し、ページを再読み込みしてください。</p> : isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">タスクを読み込み中…</p> : <AlternateTaskViews key={`${projectId}:${view}`} view={view} projectId={projectId} viewerId={user?.id ?? ''} projectMemberIds={project?.memberIds ?? []} tasks={visibleTasks} lists={lists} onTaskClick={handleTaskClick} onDateChange={handleCalendarDateChange} onAddTask={handleCalendarAddTask} />}
      </div>
      <TaskDetailModal
        highlightCommentId={searchParams.get('comment')}
        task={selectedTask}
        projectId={projectId}
        lists={lists}
        labels={labels}
        allTasks={tasks}
        isOpen={!!selectedTaskId}
        onClose={handleCloseModal}
        onUpdate={handleUpdateTask}
        onDelete={handleDeleteTask}
        onDuplicate={handleDuplicateTask}
      />
    </div>
  );
}
