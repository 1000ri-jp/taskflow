'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useProjects } from './useProjects';
import { useOrganizationLabTasks } from './useOrganizationLabTasks';
import { subscribeToProjectLists, subscribeToProjectTasks } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Task, Project, List } from '@/types';

export interface MyTask extends Task {
  parentTitle?: string;
  listName?: string;
  listColor?: string;
  projectName: string;
  projectColor: string;
  projectIcon: string;
  projectIconUrl?: string;
}

export type ProjectTaskStatus =
  | { status: 'loading' | 'ready' }
  | { status: 'error'; error: Error };

export function useMyTasks(enabled = true) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const mockMode = isE2EMockAuthEnabled();
  const labTasks = useOrganizationLabTasks(mockMode && enabled, userId ?? null);
  const { projects, isLoading: projectsLoading, error: projectsError } = useProjects(enabled);
  const scopeKey = JSON.stringify([userId, projects.map((project) => project.id).sort()]);
  // A resumed subscription must receive its own first snapshot, even for the same projects.
  const subscription = useMemo(() => ({
    scopeKey,
    enabled: Boolean(userId) && !projectsLoading && !projectsError,
  }), [scopeKey, userId, projectsLoading, projectsError]);
  const [snapshot, setSnapshot] = useState<{
    subscription: typeof subscription | null;
    tasks: Map<string, Task[]>;
    settled: Set<string>;
    errors: Map<string, Error>;
  }>({ subscription: null, tasks: new Map(), settled: new Set(), errors: new Map() });
  const tasksByProject = useMemo(() => snapshot.subscription === subscription ? snapshot.tasks : new Map<string, Task[]>(), [snapshot, subscription]);
  const [listSnapshot, setListSnapshot] = useState<{
    subscription: typeof subscription | null;
    lists: Map<string, Map<string, Pick<List, 'name' | 'color'>>>;
  }>({ subscription: null, lists: new Map() });
  const listsByProject = useMemo(() => listSnapshot.subscription === subscription ? listSnapshot.lists : new Map<string, Map<string, Pick<List, 'name' | 'color'>>>(), [listSnapshot, subscription]);

  // Subscribe to tasks and list display metadata for each accessible project
  useEffect(() => {
    if (!enabled || isE2EMockAuthEnabled() || !subscription.enabled) {
      return;
    }
    let active = true;
    const unsubscribes: (() => void)[] = [];
    const update = (projectId: string, tasks: Task[], error?: Error) => {
      if (!active) return;
      setSnapshot((previous) => {
        const current = previous.subscription === subscription ? previous : { tasks: new Map(), settled: new Set<string>(), errors: new Map<string, Error>() };
        const nextTasks = new Map(current.tasks).set(projectId, tasks);
        const errors = new Map(current.errors);
        if (error) errors.set(projectId, error);
        else errors.delete(projectId);
        return { subscription, tasks: nextTasks, settled: new Set(current.settled).add(projectId), errors };
      });
    };
    const updateLists = (projectId: string, lists: List[]) => {
      if (!active) return;
      setListSnapshot((previous) => {
        if (!active) return previous;
        const byProject = new Map(previous.subscription === subscription ? previous.lists : []);
        byProject.set(projectId, new Map(lists.map(list => [list.id, { name: list.name, color: list.color }])));
        return { subscription, lists: byProject };
      });
    };
    const [, projectIds] = JSON.parse(subscription.scopeKey) as [string, string[]];
    projectIds.forEach((projectId) => {
      const unsubscribe = subscribeToProjectTasks(projectId,
        (tasks) => update(projectId, tasks),
        (error) => update(projectId, [], error));
      unsubscribes.push(unsubscribe);
      const unsubscribeLists = subscribeToProjectLists(projectId,
        (lists) => updateLists(projectId, lists),
        () => updateLists(projectId, []));
      unsubscribes.push(unsubscribeLists);
    });

    return () => {
      active = false;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [enabled, subscription]);

  const projectTaskStatus = useMemo(() => new Map<string, ProjectTaskStatus>(projects.map(project => {
    if (projectsError) return [project.id, { status: 'error', error: projectsError }];
    if (!subscription.enabled || snapshot.subscription !== subscription || !snapshot.settled.has(project.id)) {
      return [project.id, { status: 'loading' }];
    }
    const error = snapshot.errors.get(project.id);
    return [project.id, error ? { status: 'error', error } : { status: 'ready' }];
  })), [projects, projectsError, snapshot, subscription]);

  const allProjectTasks = useMemo(() => {
    if (!userId) return [];

    const projectMap = new Map<string, Project>();
    projects.forEach((p) => projectMap.set(p.id, p));

    const allTasks: MyTask[] = [];

    tasksByProject.forEach((tasks, projectId) => {
      const project = projectMap.get(projectId);
      if (!project) return;
      const titlesById = new Map(tasks.map(task => [task.id, task.title]));

      tasks.forEach((task) => {
        const list = listsByProject.get(projectId)?.get(task.listId);
        allTasks.push({
          ...task,
          parentTitle: task.parentTaskId ? titlesById.get(task.parentTaskId) : undefined,
          listName: list?.name,
          listColor: list?.color,
          // The subscribed collection is authoritative, including legacy or moved tasks.
          projectId,
          projectName: project.name,
          projectColor: project.color,
          projectIcon: project.icon,
          projectIconUrl: project.iconUrl,
        });
      });
    });

    return allTasks;
  }, [tasksByProject, listsByProject, projects, userId]);

  // Filter and sort tasks assigned to the current user.
  const myTasks = useMemo(() => {
    if (!userId) return [];

    // Sort by due date (overdue first, then upcoming, then no date)
    return allProjectTasks
      .filter((task) => task.assigneeIds.includes(userId) && !task.isCompleted && !task.isArchived && !task.isAbandoned)
      .sort((a, b) => {
      // Both have no due date
      if (!a.dueDate && !b.dueDate) return 0;
      // a has no due date, put at end
      if (!a.dueDate) return 1;
      // b has no due date, put at end
      if (!b.dueDate) return -1;
      // Sort by date
      return a.dueDate.getTime() - b.dueDate.getTime();
    });
  }, [allProjectTasks, userId]);

  if (mockMode) return labTasks;

  return {
    projects,
    tasks: myTasks,
    allProjectTasks,
    projectTaskStatus,
    isLoading: enabled && Boolean(userId) && !projectsError && (projectsLoading || (projects.length > 0 && (snapshot.subscription !== subscription || snapshot.settled.size < projects.length))),
    error: projectsError ?? (snapshot.subscription === subscription ? snapshot.errors.values().next().value ?? null : null),
    taskCount: myTasks.length,
  };
}
