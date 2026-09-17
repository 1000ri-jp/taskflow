'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { GroupedTaskView } from '@/components/board/GroupedTaskView';
import { ProjectListFilter } from '@/components/board/ProjectListFilter';
import { ProjectMilestones } from '@/components/board/ProjectMilestones';
import { useProjectMilestones } from '@/hooks/useProjectMilestones';
import { tasksInList } from '@/lib/board/taskHierarchy';
import { BoardView } from '@/components/board/BoardView';
import { BoardFilterBar, type BoardFilters } from '@/components/board/BoardFilterBar';
import { useParentTaskLocation } from '@/hooks/useParentTaskLocation';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { useBoard } from '@/hooks/useBoard';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { AlternateTaskViews } from '@/components/board/AlternateTaskViews';
import { taskMatchesBoardFilters } from '@/lib/board/filters';
import { useProjectTaskViewNavigation } from '@/hooks/useProjectTaskViewNavigation';
import type { Task } from '@/types';
import { recalculateDates } from '@/lib/utils/task';

export default function BoardPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get('task');
  const listId = searchParams.get('list');
  const milestoneState = useProjectMilestones(projectId);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { lists, tasks, allTasks = tasks, labels, tags = [], isLoading, error, editTask, removeTask, duplicateTask, addTask, moveTask, changeTaskParent } = useBoard(projectId);
  const { project, members, isLoading: projectLoading, error: projectError } = useProject(projectId);
  const canEditTasks = !!user && !projectLoading && !projectError && project?.id === projectId && !project.isArchived
    && project.memberIds.includes(user.id)
    && (project.ownerId === user.id || members.some(member => member.userId === user.id && (member.role === 'admin' || member.role === 'editor')));
  const { view, canSave: viewSettingsHydrated } = useProjectTaskViewNavigation(projectId);

  const [groupBy, setGroupBy] = useState<'list'|'stage'|'assignee'|'purpose'>('list');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({
    keyword: '',
    labelIds: new Set(),
    dueFilter: 'all',
    showCompleted: true,
  });

  const location = useParentTaskLocation(allTasks, projectId, selectedTaskId, isLoading);
  const selectedTask = location.task;
  const editableTaskId = selectedTask?.id ?? null;
  const listTasks = tasksInList(tasks, listId);
  const visibleTasks = (view === 'progress'
    ? [...listTasks, ...allTasks.filter(task => task.isArchived && (!listId || task.listId === listId))]
    : listTasks).filter(task => task.projectId === projectId && taskMatchesBoardFilters(task, filters));

  useEffect(() => {
    setSelectedTaskId(taskIdFromUrl);
  }, [taskIdFromUrl]);

  const updateTaskUrl = useCallback(
    (taskId: string | null) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.delete('comment');
      nextSearchParams.delete('history');
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
      if (editableTaskId) {
        return editTask(editableTaskId, data);
      }
    },
    [editableTaskId, editTask]
  );

  const handleCalendarDateChange = useCallback(async (task: Task, kind: '開始' | '期限' | '開始・期限', date: Date) => {
    const currentTask = tasks.find(item => item.id === task.id && item.projectId === projectId && !item.isArchived);
    if (!canEditTasks || task.projectId !== projectId || !currentTask || !Number.isFinite(date.getTime())) {
      throw new Error('タスクまたは日付を変更する権限を確認できません');
    }
    const changes = kind === '開始' ? { startDate: date } : kind === '期限' ? { dueDate: date } : { startDate: date, dueDate: date };
    const recalculated = recalculateDates(currentTask, changes);
    await editTask(currentTask.id, {
      startDate: recalculated.startDate,
      dueDate: recalculated.dueDate,
      durationDays: recalculated.durationDays,
      isDueDateFixed: recalculated.isDueDateFixed,
    });
  }, [canEditTasks, tasks, projectId, editTask]);

  const handleDeleteTask = useCallback(() => {
    if (editableTaskId) {
      removeTask(editableTaskId);
      setSelectedTaskId(null);
      updateTaskUrl(null);
    }
  }, [editableTaskId, removeTask, updateTaskUrl]);

  const handleMoveTask = useCallback(async (taskId: string, targetListId: string) => {
    const task = tasks.find(item => item.id === taskId && item.projectId === projectId && !item.isArchived);
    const list = lists.find(item => item.id === targetListId && item.projectId === projectId);
    if (!task || !list || !user?.id) throw new Error('移動先またはタスクを確認できません');
    if (task.listId === list.id) return;
    const order = Math.max(-1, ...tasks.filter(item => item.listId === list.id).map(item => item.order)) + 1;
    await moveTask(task.id, list.id, order);
  }, [tasks, lists, projectId, user?.id, moveTask]);

  const handleCalendarAddTask = useCallback(async (listId: string, title: string, dueDate: Date, assigneeIds?: string[]) => {
    if (!user?.id) throw new Error('ログイン状態を確認してください。入力は保持しています。');
    await addTask(listId, title, user.id, 'bottom', { dueDate, assigneeIds });
  }, [addTask, user?.id]);

  const handleDuplicateTask = useCallback(async () => {
    if (editableTaskId && user) {
      const newTaskId = await duplicateTask(editableTaskId, user.id);
      if (newTaskId) {
        setSelectedTaskId(newTaskId); // Open the new task
        updateTaskUrl(newTaskId);
      }
    }
  }, [editableTaskId, user, duplicateTask, updateTaskUrl]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0">
        <BoardFilterBar
          projectId={projectId}
          filters={filters}
          labels={labels}
          tasks={tasks}
          lists={lists}
          onFiltersChange={setFilters}
          onTaskClick={handleTaskClick}
          showCardSettings={view === 'board' || view === 'progress'}
          endControls={<div className="flex min-w-0 items-center gap-2">
            {['board','outline','table'].includes(view) && <select aria-label="仕事の並べ方" className="h-8 max-w-36 rounded border bg-background px-2 text-xs" value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)}><option value="list">リスト別</option><option value="stage">状況別</option><option value="assignee">担当者別</option><option value="purpose">目的・節目別</option></select>}
            <ProjectListFilter lists={lists} />
          </div>}
          extraControls={<ProjectMilestones iconOnly projectId={projectId} tasks={tasks} {...milestoneState} onSelect={milestoneState.setSelectedId} onTaskClick={handleTaskClick} />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groupBy !== 'list' && ['board','outline','table'].includes(view) && viewSettingsHydrated ? error ? <p role="alert" className="p-3">タスクを取得できませんでした。</p> : isLoading ? <p role="status" className="p-3">読み込み中…</p> : <GroupedTaskView tasks={visibleTasks} allTasks={allTasks} milestones={milestoneState.milestones} groupBy={groupBy} onTaskClick={handleTaskClick} /> : !viewSettingsHydrated || view === 'gantt' ? <p role="status" className="p-4 text-sm text-muted-foreground">表示設定を読み込み中…</p> : view === 'board' ? <BoardView projectId={projectId} onTaskClick={handleTaskClick} filters={filters} listId={listId} /> : error ? <p role="alert" className="p-4 text-sm text-destructive">タスクを取得できませんでした。接続・権限を確認し、ページを再読み込みしてください。</p> : isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">タスクを読み込み中…</p> : <AlternateTaskViews canEdit={canEditTasks} labels={labels} tags={tags} key={`${user?.id}:${projectId}:${view}`} view={view} projectId={projectId} viewerId={user?.id ?? ''} projectMemberIds={project?.memberIds ?? []} selectedListId={listId} tasks={visibleTasks} allTasks={allTasks} milestones={milestoneState.milestones} onMilestoneClick={milestoneState.setSelectedId} lists={lists} onTaskClick={handleTaskClick} onMoveTask={handleMoveTask} onDateChange={canEditTasks ? handleCalendarDateChange : undefined} onAddTask={handleCalendarAddTask} />}
      </div>
      {location.missing && <div role="alert" className="m-3 rounded border p-3 text-sm">指定された仕事または親タスクを取得できません。削除・閲覧権限・接続状況を確認してください。<button type="button" className="ml-2 underline" onClick={handleCloseModal}>閉じる</button></div>}
      <TaskDetailModal
        highlightCommentId={searchParams.get('comment') ?? location.commentId}
        highlightSubtaskId={location.subtaskId}
        openHistory={searchParams.get('history') === '1'}
        task={selectedTask}
        projectId={projectId}
        lists={lists}
        labels={labels}
        allTasks={allTasks}
        isOpen={!!selectedTaskId}
        onClose={handleCloseModal}
        onUpdate={handleUpdateTask}
        onMoveTask={handleMoveTask}
        onChangeParent={changeTaskParent}
        onAddSubtask={async (parent, title, assigneeIds) => {
          if (!user) throw new Error('ログインし直してください。');
          if (isLoading || error) throw new Error('タスクを読み込み直してからお試しください。');
          return addTask(parent.listId, title, user.id, 'bottom', { parentTaskId: parent.id, assigneeIds });
        }}
        onDeleteSubtask={user && !isLoading && !error ? removeTask : undefined}
        onDelete={handleDeleteTask}
        onDuplicate={handleDuplicateTask}
      />
    </div>
  );
}
