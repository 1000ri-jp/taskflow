'use client';

import { useCallback, useState } from 'react';
import { ProjectListFilter } from '@/components/board/ProjectListFilter';
import { ProjectMilestones } from '@/components/board/ProjectMilestones';
import { useProjectMilestones } from '@/hooks/useProjectMilestones';
import { useParams, usePathname, useSearchParams, useRouter } from 'next/navigation';
import { GanttChart } from '@/components/gantt';
import { useParentTaskLocation } from '@/hooks/useParentTaskLocation';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { useBoard } from '@/hooks/useBoard';
import { useAuthStore } from '@/stores/authStore';

export default function GanttPage() {
  const [dateError, setDateError] = useState<string | null>(null);
  const params = useParams();
  const projectId = params.projectId as string;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const milestoneState = useProjectMilestones(projectId);
  const { user } = useAuthStore();
  const { lists, tasks, allTasks = tasks, labels, isLoading, error, editTask, removeTask, duplicateTask, addTask, moveTask, changeTaskParent } = useBoard(projectId);

  const selectedTaskId = searchParams.get('task');
  const setSelectedTaskId = useCallback((id: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('comment');
    if (id) next.set('task', id); else next.delete('task');
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const location = useParentTaskLocation(allTasks, projectId, selectedTaskId, isLoading);
  const selectedTask = location.task;
  const editableTaskId = selectedTask?.id ?? null;

  const handleTaskClick = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, [setSelectedTaskId]);

  const handleCloseModal = useCallback(() => {
    setSelectedTaskId(null);
  }, [setSelectedTaskId]);

  const handleUpdateTask = useCallback(
    (data: Parameters<typeof editTask>[1]) => {
      if (editableTaskId) {
        return editTask(editableTaskId, data);
      }
    },
    [editableTaskId, editTask]
  );

  const handleDeleteTask = useCallback(() => {
    if (editableTaskId) {
      removeTask(editableTaskId);
      setSelectedTaskId(null);
    }
  }, [editableTaskId, removeTask, setSelectedTaskId]);

  const handleMoveTask = useCallback(async (taskId: string, targetListId: string) => {
    const task = tasks.find(item => item.id === taskId && item.projectId === projectId && !item.isArchived);
    const list = lists.find(item => item.id === targetListId && item.projectId === projectId);
    if (!task || !list || !user?.id) throw new Error('移動先またはタスクを確認できません');
    if (task.listId === list.id) return;
    const order = Math.max(-1, ...tasks.filter(item => item.listId === list.id).map(item => item.order)) + 1;
    await moveTask(task.id, list.id, order);
  }, [tasks, lists, projectId, user?.id, moveTask]);

  const handleDuplicateTask = useCallback(async () => {
    if (editableTaskId && user) {
      const newTaskId = await duplicateTask(editableTaskId, user.id);
      if (newTaskId) {
        setSelectedTaskId(newTaskId);
      }
    }
  }, [editableTaskId, user, duplicateTask, setSelectedTaskId]);

  // Handler for Gantt chart drag updates
  const handleGanttTaskUpdate = useCallback(
    (taskId: string, data: Parameters<typeof editTask>[1]) => {
      setDateError(null);
      editTask(taskId, data).catch(error => setDateError(error instanceof Error ? error.message : '日程を保存できませんでした。'));
    },
    [editTask]
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <ProjectListFilter lists={lists} />
        <ProjectMilestones projectId={projectId} tasks={tasks} {...milestoneState} onSelect={milestoneState.setSelectedId} onTaskClick={handleTaskClick} />
      </div>
      {dateError && <p role="alert" className="px-3 py-2 text-sm text-destructive">{dateError}</p>}
      {error ? <p role="alert" className="p-4 text-sm text-destructive">タスクを取得できませんでした。接続・権限を確認してください。</p> : isLoading ? <p role="status" className="p-4 text-sm">タスクを読み込み中…</p> : <GanttChart
        listId={searchParams.get('list')}
        milestones={milestoneState.milestones}
        onMilestoneClick={milestoneState.setSelectedId}
        tasks={tasks}
        lists={lists}
        labels={labels}
        onTaskClick={handleTaskClick}
        onTaskUpdate={handleGanttTaskUpdate}
      />}
      {location.missing && <div role="alert" className="m-3 rounded border p-3 text-sm">指定された仕事または親タスクを取得できません。削除・閲覧権限・接続状況を確認してください。<button type="button" className="ml-2 underline" onClick={handleCloseModal}>閉じる</button></div>}
      <TaskDetailModal
        highlightCommentId={searchParams.get('comment') ?? location.commentId}
        highlightSubtaskId={location.subtaskId}
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
