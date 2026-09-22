'use client';

import { useEffect, useState } from 'react';
import { expandTaskReviews } from '@/lib/task/reviews';
import type { MyTask, ProjectTaskStatus } from './useMyTasks';
import type { Project } from '@/types';
import { MEETING_MOCK_PROJECTS, MULTI_PROGRESS_TASK_ID } from '@/lib/task/meetingMultiExample';

interface LabSnapshot { userId: string | null; projects: Project[]; tasks: MyTask[]; error: Error | null; projectTaskStatus: Map<string, ProjectTaskStatus> }
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const date = (value: unknown): Date | null => value instanceof Date && Number.isFinite(value.getTime()) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;

/** Read the explicitly created shared workbench. Never seed, reset or write browser state here. */
export function useOrganizationLabTasks(enabled: boolean, userId: string | null) {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe = () => {};
    void import('@/lib/task/organizationMock').then(({ organizationMockKey, readOrganizationMock }) => {
      if (!active) return;
      const read = () => {
        if (!active) return;
        const result: LabSnapshot = { userId, projects: [], tasks: [], error: null, projectTaskStatus: new Map() };
        for (const definition of MEETING_MOCK_PROJECTS) {
          const projectId = definition.id;
          try {
            // readOrganizationMock has an in-memory default; only a persisted explicit workbench is shown in Neo.
            if (userId && localStorage.getItem(organizationMockKey(projectId))) {
              const stored = readOrganizationMock(projectId);
              if (!stored.data || !stored.data.tasks || !Array.isArray(stored.data.memberIds)) throw new Error('隔離データの形式を確認できません。保存内容は変更していません。');
              if (stored.data.memberIds.includes(userId)) {
                const project: Project = { id: projectId, name: projectId === 'secretary-demo' && !stored.data.tasks[MULTI_PROGRESS_TASK_ID] ? '架空の制作・チケット準備' : definition.name, description: '隔離環境の共有作業台', color: '#64748b', icon: '🧪', ownerId: 'e2e-mock-user', defaultAssigneeId: stored.data.defaultAssigneeId ?? null, memberIds: stored.data.memberIds, isArchived: false, order: 0, createdAt: new Date(0), updatedAt: new Date(0) };
                result.projects.push(project);
                result.projectTaskStatus.set(projectId, { status: 'ready' });
                result.tasks.push(...Object.entries(stored.data.tasks).map(([id, raw]): MyTask => ({
                  ...raw, id, projectId, title: typeof raw.title === 'string' ? raw.title : '件名未取得', description: typeof raw.description === 'string' ? raw.description : '',
                  listId: typeof raw.listId === 'string' ? raw.listId : '', order: typeof raw.order === 'number' ? raw.order : 0,
                  assigneeIds: strings(raw.assigneeIds), labelIds: strings(raw.labelIds), tagIds: strings(raw.tagIds), dependsOnTaskIds: strings(raw.dependsOnTaskIds),
                  priority: raw.priority === 'high' || raw.priority === 'medium' || raw.priority === 'low' ? raw.priority : null,
                  startDate: date(raw.startDate), dueDate: date(raw.dueDate), durationDays: typeof raw.durationDays === 'number' ? raw.durationDays : null,
                  isDueDateFixed: raw.isDueDateFixed === true, isCompleted: raw.isCompleted === true, completedAt: date(raw.completedAt),
                  isAbandoned: raw.isAbandoned === true, isArchived: raw.isArchived === true, archivedAt: date(raw.archivedAt), archivedBy: typeof raw.archivedBy === 'string' ? raw.archivedBy : null,
                  createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '', createdAt: date(raw.createdAt) ?? new Date(0), updatedAt: date(raw.updatedAt) ?? new Date(0),
                  projectName: project.name, projectColor: project.color, projectIcon: project.icon,
                  parentTitle: typeof raw.parentTaskId === 'string' && typeof stored.data.tasks[raw.parentTaskId]?.title === 'string' ? stored.data.tasks[raw.parentTaskId].title as string : undefined,
                })));
              }
            }
          } catch (error) {
            const failure = error instanceof Error ? error : new Error('隔離データを取得できません。');
            result.error ??= failure; result.projectTaskStatus.set(projectId, { status: 'error', error: failure });
          }
        }
        result.tasks = expandTaskReviews(result.tasks);
        setSnapshot(result);
      };
      const onStorage = (event: StorageEvent) => { if (MEETING_MOCK_PROJECTS.some(project => event.key === organizationMockKey(project.id))) read(); };
      window.addEventListener('taskflow-work-updated', read);
      window.addEventListener('storage', onStorage);
      unsubscribe = () => { window.removeEventListener('taskflow-work-updated', read); window.removeEventListener('storage', onStorage); };
      read();
    }).catch(error => { if (active) setSnapshot({ userId, projects: [], tasks: [], projectTaskStatus: new Map(), error: error instanceof Error ? error : new Error('隔離データを取得できません。') }); });
    return () => { active = false; unsubscribe(); };
  }, [enabled, userId]);
  // Keep the last successful snapshot mounted while the desktop shell is
  // hidden. Re-showing the mini can then restore its content immediately;
  // the effect above still removes listeners while inactive.
  const current = snapshot?.userId === userId ? snapshot : null;
  const allProjectTasks = current?.tasks ?? [];
  const tasks = allProjectTasks.filter(task => !!userId && task.assigneeIds.includes(userId) && !task.isCompleted && !task.isArchived && !task.isAbandoned)
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  return { projects: current?.projects ?? [], allProjectTasks, tasks, taskCount: tasks.length, isLoading: enabled && !!userId && !current,
    error: current?.error ?? null, projectTaskStatus: current?.projectTaskStatus ?? new Map<string, ProjectTaskStatus>() };
}
