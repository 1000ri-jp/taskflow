'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  createList,
  updateList,
  deleteList,
  subscribeToProjectLists,
  createTask,
  updateTask,
  deleteTask,
  getProjectTasks,
  subscribeToProjectTasks,
  subscribeToProjectLabels,
  subscribeToProjectTags,
  getTaskChecklists,
  createChecklist,
  createActivityLog,
} from '@/lib/firebase/firestore';
import { useAuthStore } from '@/stores/authStore';
import { useUndoStore } from '@/stores/undoStore';
import type { List, Task, Label, Tag } from '@/types';
import { calculateEffectiveStartDate, recalculateDates } from '@/lib/utils/task';

interface BoardState {
  lists: List[];
  tasks: Task[];
  labels: Label[];
  tags: Tag[];
  isLoading: boolean;
  error: Error | null;
}

export function useBoard(projectId: string | null) {
  const { firebaseUser, user: authUser } = useAuthStore();
  const [state, setState] = useState<BoardState>({
    lists: [],
    tasks: [],
    labels: [],
    tags: [],
    isLoading: true,
    error: null,
  });

  // Subscribe to lists, tasks, and labels
  useEffect(() => {
    if (!projectId) {
      Promise.resolve().then(() => {
        setState((prev) => ({ ...prev, isLoading: false }));
      });
      return;
    }

    Promise.resolve().then(() => {
      setState((prev) => ({ ...prev, isLoading: true }));
    });

    const unsubscribeLists = subscribeToProjectLists(projectId, (lists) => {
      setState((prev) => ({ ...prev, lists }));
    });

    const unsubscribeTasks = subscribeToProjectTasks(projectId, (tasks) => {
      setState((prev) => ({ ...prev, tasks, isLoading: false, error: null }));
    }, (error) => {
      setState((prev) => ({ ...prev, tasks: [], isLoading: false, error }));
    });

    const unsubscribeLabels = subscribeToProjectLabels(projectId, (labels) => {
      setState((prev) => ({ ...prev, labels }));
    });

    const unsubscribeTags = subscribeToProjectTags(projectId, (tags) => {
      setState((prev) => ({ ...prev, tags }));
    });

    return () => {
      unsubscribeLists();
      unsubscribeTasks();
      unsubscribeLabels();
      unsubscribeTags();
    };
  }, [projectId]);

  // Get tasks for a specific list
  const getTasksByListId = useCallback(
    (listId: string) => {
      return state.tasks
        .filter((task) => task.listId === listId)
        .sort((a, b) => a.order - b.order);
    },
    [state.tasks]
  );

  // Activity log helper (fire-and-forget)
  const logActivity = useCallback(
    (params: Parameters<typeof createActivityLog>[1]) => {
      if (!projectId) return;
      createActivityLog(projectId, params).catch(() => {});
    },
    [projectId]
  );

  const getActivityUser = useCallback(() => ({
    userId: firebaseUser?.uid || '',
    userName: authUser?.displayName || 'Unknown',
  }), [firebaseUser, authUser]);

  // Create list
  const addList = useCallback(
    async (name: string, color: string) => {
      if (!projectId) return;
      const maxOrder = Math.max(...state.lists.map((l) => l.order), -1);
      await createList(projectId, {
        name,
        color,
        order: maxOrder + 1,
        autoCompleteOnEnter: false,
        autoUncompleteOnExit: false,
        autoSetStartDateOnEnter: false,
      });
      logActivity({
        projectId,
        targetType: 'list',
        targetId: '',
        targetName: name,
        action: 'create',
        ...getActivityUser(),
      });
    },
    [projectId, state.lists, logActivity, getActivityUser]
  );

  // Update list
  const editList = useCallback(
    async (listId: string, data: { name?: string; color?: string; autoCompleteOnEnter?: boolean; autoUncompleteOnExit?: boolean; autoSetStartDateOnEnter?: boolean }) => {
      if (!projectId) return;
      await updateList(projectId, listId, data);
    },
    [projectId]
  );

  // Delete list (move tasks to target list first)
  const removeList = useCallback(
    async (listId: string, targetListId?: string) => {
      if (!projectId) return;

      // Get tasks in the list to be deleted
      const tasksToMove = state.tasks.filter((t) => t.listId === listId);
      const oldList = state.lists.find((l) => l.id === listId);
      const targetList = targetListId ? state.lists.find((l) => l.id === targetListId) : null;

      if (tasksToMove.length > 0 && targetListId) {
        // Get max order in target list
        const targetTasks = state.tasks.filter((t) => t.listId === targetListId);
        let maxOrder = Math.max(...targetTasks.map((t) => t.order), -1);

        // Move all tasks to target list with auto-complete logic
        const moveUpdates = tasksToMove.map((task) => {
          maxOrder += 1;
          const updateData: Partial<Task> = {
            listId: targetListId,
            order: maxOrder,
          };

          // Apply auto-complete logic
          if (targetList?.autoCompleteOnEnter && !task.isCompleted) {
            updateData.isCompleted = true;
            updateData.completedAt = new Date();
          } else if (oldList?.autoUncompleteOnExit && task.isCompleted) {
            updateData.isCompleted = false;
            updateData.completedAt = null;
          }

          // Apply auto-set-start-date logic
          if (targetList?.autoSetStartDateOnEnter && !task.startDate) {
            updateData.startDate = new Date();
          }

          return updateTask(projectId, task.id, updateData);
        });
        await Promise.all(moveUpdates);
      }

      // Delete the list
      await deleteList(projectId, listId);
    },
    [projectId, state.tasks, state.lists]
  );

  // Reorder lists
  const reorderLists = useCallback(
    async (reorderedLists: List[]) => {
      if (!projectId) return;
      const updates = reorderedLists.map((list, index) =>
        updateList(projectId, list.id, { order: index })
      );
      await Promise.all(updates);
    },
    [projectId]
  );

  // Create task
  const addTask = useCallback(
    async (listId: string, title: string, createdBy: string, position: 'top' | 'bottom' = 'bottom') => {
      if (!projectId) return;
      const tasksInList = state.tasks.filter((t) => t.listId === listId);
      const orders = tasksInList.map((t) => t.order);
      const order =
        position === 'top' ? Math.min(...orders, 1) - 1 : Math.max(...orders, -1) + 1;

      // Check if the target list has auto-complete enabled
      const targetList = state.lists.find((l) => l.id === listId);
      const shouldAutoComplete = targetList?.autoCompleteOnEnter ?? false;
      const shouldSetStartDate = targetList?.autoSetStartDateOnEnter ?? false;

      await createTask(projectId, {
        listId,
        title,
        description: '',
        order,
        assigneeIds: [],
        labelIds: [],
        tagIds: [],
        dependsOnTaskIds: [],
        priority: null,
        startDate: shouldSetStartDate ? new Date() : null,
        dueDate: null,
        durationDays: null,
        isDueDateFixed: false,
        isCompleted: shouldAutoComplete,
        completedAt: shouldAutoComplete ? new Date() : null,
        isAbandoned: false,
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        createdBy,
      });
      logActivity({
        projectId,
        targetType: 'task',
        targetId: '',
        targetName: title,
        action: 'create',
        ...getActivityUser(),
      });
    },
    [projectId, state.tasks, state.lists, logActivity, getActivityUser]
  );

  // Cascade date updates to dependent tasks
  const cascadeDependentDates = useCallback(
    async function cascadeDependentDatesImpl(changedTaskId: string, allTasks: Task[]) {
      if (!projectId) return;

      // Find tasks that depend on the changed task
      const dependentTasks = allTasks.filter(
        (t) => t.dependsOnTaskIds?.includes(changedTaskId)
      );

      for (const depTask of dependentTasks) {
        const effectiveStart = calculateEffectiveStartDate(depTask, allTasks);
        if (!effectiveStart) continue;

        const result = recalculateDates(depTask, { startDate: effectiveStart });

        // Only update if dates actually changed
        const startChanged = depTask.startDate?.getTime() !== effectiveStart.getTime();
        const dueChanged = depTask.dueDate?.getTime() !== result.dueDate?.getTime();

        if (startChanged || dueChanged) {
          const updateData: Partial<Task> = {};
          if (startChanged) updateData.startDate = effectiveStart;
          if (dueChanged) updateData.dueDate = result.dueDate;
          if (result.durationDays !== depTask.durationDays) updateData.durationDays = result.durationDays;

          await updateTask(projectId, depTask.id, updateData);

          // Recursively cascade to tasks that depend on this task
          const updatedDepTask = { ...depTask, ...updateData };
          const updatedAllTasks = allTasks.map((t) =>
            t.id === depTask.id ? updatedDepTask : t
          );
          await cascadeDependentDatesImpl(depTask.id, updatedAllTasks);
        }
      }
    },
    [projectId]
  );

  // Update task
  const editTask = useCallback(
    async (
      taskId: string,
      data: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>
    ) => {
      if (!projectId) return;

      // Capture old values for undo (only for significant changes)
      const task = state.tasks.find((t) => t.id === taskId);
      const isSignificant =
        'isCompleted' in data || 'priority' in data ||
        'startDate' in data || 'dueDate' in data ||
        'title' in data || 'isAbandoned' in data;

      if (task && isSignificant) {
        const oldData: Partial<Task> = {};
        for (const key of Object.keys(data) as Array<keyof typeof data>) {
          (oldData as Record<string, unknown>)[key] = task[key as keyof Task];
        }
        const pid = projectId;
        let description = `「${task.title}」を編集`;
        if ('isCompleted' in data) {
          description = data.isCompleted
            ? `「${task.title}」を完了`
            : `「${task.title}」を未完了に戻す`;
        }
        useUndoStore.getState().pushAction({
          id: `edit-${taskId}-${Date.now()}`,
          description,
          undo: async () => {
            await updateTask(pid, taskId, oldData);
          },
          redo: async () => {
            await updateTask(pid, taskId, data);
          },
        });
      }

      await updateTask(projectId, taskId, data);

      // Cascade: if dates or completion changed, update dependent tasks
      const dateOrCompletionChanged =
        'startDate' in data || 'dueDate' in data ||
        'completedAt' in data || 'isCompleted' in data;

      if (dateOrCompletionChanged) {
        // Build updated task list with the just-changed task
        const updatedTasks = state.tasks.map((t) =>
          t.id === taskId ? { ...t, ...data } : t
        );
        cascadeDependentDates(taskId, updatedTasks).catch(console.error);
      }
    },
    [projectId, state.tasks, cascadeDependentDates]
  );

  // Delete task
  const removeTask = useCallback(
    async (taskId: string) => {
      if (!projectId) return;
      const task = state.tasks.find((t) => t.id === taskId);
      await deleteTask(projectId, taskId);
      if (task) {
        // Push undo action to recreate the task
        const pid = projectId;
        useUndoStore.getState().pushAction({
          id: `delete-${taskId}-${Date.now()}`,
          description: `「${task.title}」を削除`,
          undo: async () => {
            await createTask(pid, {
              listId: task.listId,
              title: task.title,
              description: task.description,
              order: task.order,
              assigneeIds: [...task.assigneeIds],
              labelIds: [...task.labelIds],
              tagIds: [...task.tagIds],
              dependsOnTaskIds: [...task.dependsOnTaskIds],
              priority: task.priority,
              startDate: task.startDate,
              dueDate: task.dueDate,
              durationDays: task.durationDays,
              isDueDateFixed: task.isDueDateFixed,
              isCompleted: task.isCompleted,
              completedAt: task.completedAt,
              isAbandoned: task.isAbandoned,
              isArchived: false,
              archivedAt: null,
              archivedBy: null,
              createdBy: task.createdBy,
            });
          },
          redo: async () => {
            // Re-delete: find the task by title+listId since ID changed after undo
            const currentTasks = await getProjectTasks(pid);
            const match = currentTasks.find(
              (t) => t.title === task.title && t.listId === task.listId
            );
            if (match) await deleteTask(pid, match.id);
          },
        });

        logActivity({
          projectId,
          targetType: 'task',
          targetId: taskId,
          targetName: task.title,
          action: 'delete',
          ...getActivityUser(),
        });
      }
    },
    [projectId, state.tasks, logActivity, getActivityUser]
  );

  // Move task to different list
  const moveTask = useCallback(
    async (taskId: string, newListId: string, newOrder: number) => {
      if (!projectId) return;

      // Find the task and lists
      const task = state.tasks.find((t) => t.id === taskId);
      const oldList = task ? state.lists.find((l) => l.id === task.listId) : null;
      const newList = state.lists.find((l) => l.id === newListId);

      // Capture old state for undo
      const oldListId = task?.listId;
      const oldOrder = task?.order;
      const oldIsCompleted = task?.isCompleted;
      const oldCompletedAt = task?.completedAt;
      const oldStartDate = task?.startDate;

      // Prepare update data
      const updateData: Partial<Task> = {
        listId: newListId,
        order: newOrder,
      };

      // Only apply auto-complete logic when moving to a different list
      if (task && task.listId !== newListId) {
        // Check if new list auto-completes tasks
        if (newList?.autoCompleteOnEnter && !task.isCompleted) {
          updateData.isCompleted = true;
          updateData.completedAt = new Date();
        }
        // Check if old list auto-uncompletes tasks on exit
        else if (oldList?.autoUncompleteOnExit && task.isCompleted) {
          updateData.isCompleted = false;
          updateData.completedAt = null;
        }
        // Set start date on enter (only if not already set)
        if (newList?.autoSetStartDateOnEnter && !task.startDate) {
          updateData.startDate = new Date();
        }
      }

      await updateTask(projectId, taskId, updateData);

      // Push undo action for cross-list moves
      if (task && task.listId !== newListId && oldListId !== undefined && oldOrder !== undefined) {
        const pid = projectId;
        const oldListName = oldList?.name || '';
        const newListName = newList?.name || '';
        useUndoStore.getState().pushAction({
          id: `move-${taskId}-${Date.now()}`,
          description: `「${task.title}」を${oldListName}→${newListName}`,
          undo: async () => {
            await updateTask(pid, taskId, {
              listId: oldListId,
              order: oldOrder,
              isCompleted: oldIsCompleted,
              completedAt: oldCompletedAt,
              startDate: oldStartDate,
            });
          },
          redo: async () => {
            await updateTask(pid, taskId, updateData);
          },
        });
      }

      // Log only cross-list moves
      if (task && task.listId !== newListId) {
        const oldListName = oldList?.name || '';
        const newListName = newList?.name || '';
        logActivity({
          projectId,
          targetType: 'task',
          targetId: taskId,
          targetName: task.title,
          action: 'move',
          ...getActivityUser(),
          changes: [{ field: 'リスト', oldValue: oldListName, newValue: newListName }],
        });
      }
    },
    [projectId, state.tasks, state.lists, logActivity, getActivityUser]
  );

  // Reorder tasks within a list
  const reorderTasks = useCallback(
    async (listId: string, taskIds: string[]) => {
      if (!projectId) return;
      const updates = taskIds.map((taskId, index) =>
        updateTask(projectId, taskId, { order: index })
      );
      await Promise.all(updates);
    },
    [projectId]
  );

  // Duplicate task
  const duplicateTask = useCallback(
    async (taskId: string, createdBy: string): Promise<string | null> => {
      if (!projectId) return null;

      // Find the original task
      const originalTask = state.tasks.find((t) => t.id === taskId);
      if (!originalTask) return null;

      // Calculate new order (add at end of list)
      const tasksInList = state.tasks.filter((t) => t.listId === originalTask.listId);
      const maxOrder = Math.max(...tasksInList.map((t) => t.order), -1);

      // Create the duplicated task
      const newTaskId = await createTask(projectId, {
        listId: originalTask.listId,
        title: `コピー - ${originalTask.title}`,
        description: originalTask.description,
        order: maxOrder + 1,
        assigneeIds: [...originalTask.assigneeIds],
        labelIds: [...originalTask.labelIds],
        tagIds: [...originalTask.tagIds],
        dependsOnTaskIds: [], // Don't copy dependencies
        priority: originalTask.priority,
        startDate: originalTask.startDate,
        dueDate: originalTask.dueDate,
        durationDays: originalTask.durationDays,
        isDueDateFixed: originalTask.isDueDateFixed,
        isCompleted: false, // New task starts as incomplete
        completedAt: null,
        isAbandoned: false,
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        createdBy,
      });

      // Copy checklists with items unchecked
      try {
        const checklists = await getTaskChecklists(projectId, taskId);
        for (const checklist of checklists) {
          await createChecklist(projectId, newTaskId, {
            title: checklist.title,
            order: checklist.order,
            items: checklist.items.map((item) => ({
              ...item,
              isChecked: false, // Uncheck all items
            })),
          });
        }
      } catch (error) {
        console.error('Failed to copy checklists:', error);
      }

      return newTaskId;
    },
    [projectId, state.tasks]
  );

  return {
    lists: state.lists,
    tasks: state.tasks,
    labels: state.labels,
    tags: state.tags,
    isLoading: state.isLoading,
    error: state.error,
    getTasksByListId,
    addList,
    editList,
    removeList,
    reorderLists,
    addTask,
    editTask,
    removeTask,
    moveTask,
    reorderTasks,
    duplicateTask,
  };
}
