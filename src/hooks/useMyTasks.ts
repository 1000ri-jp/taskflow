'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useProjects } from './useProjects';
import { subscribeToProjectTasks } from '@/lib/firebase/firestore';
import type { Task, Project } from '@/types';

export interface MyTask extends Task {
  parentTitle?: string;
  projectName: string;
  projectColor: string;
  projectIcon: string;
  projectIconUrl?: string;
}

export function useMyTasks() {
  const { user } = useAuthStore();
  const userId = user?.id;
  const { projects, isLoading: projectsLoading, error: projectsError } = useProjects();
  const scopeKey = JSON.stringify([userId, projects.map((project) => project.id).sort()]);
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    tasks: Map<string, Task[]>;
    settled: Set<string>;
    errors: Map<string, Error>;
  }>({ scopeKey: '', tasks: new Map(), settled: new Set(), errors: new Map() });
  const tasksByProject = useMemo(() => snapshot.scopeKey === scopeKey ? snapshot.tasks : new Map<string, Task[]>(), [snapshot, scopeKey]);

  // Subscribe to tasks for each project
  useEffect(() => {
    if (projectsLoading || projectsError || !userId) {
      return;
    }
    let active = true;
    const unsubscribes: (() => void)[] = [];
    const update = (projectId: string, tasks: Task[], error?: Error) => {
      if (!active) return;
      setSnapshot((previous) => {
        const current = previous.scopeKey === scopeKey ? previous : { tasks: new Map(), settled: new Set<string>(), errors: new Map<string, Error>() };
        const nextTasks = new Map(current.tasks).set(projectId, tasks);
        const errors = new Map(current.errors);
        if (error) errors.set(projectId, error);
        else errors.delete(projectId);
        return { scopeKey, tasks: nextTasks, settled: new Set(current.settled).add(projectId), errors };
      });
    };
    const [, projectIds] = JSON.parse(scopeKey) as [string, string[]];
    projectIds.forEach((projectId) => {
      const unsubscribe = subscribeToProjectTasks(projectId,
        (tasks) => update(projectId, tasks),
        (error) => update(projectId, [], error));
      unsubscribes.push(unsubscribe);
    });

    return () => {
      active = false;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [scopeKey, projectsLoading, projectsError, userId]);

  const allProjectTasks = useMemo(() => {
    if (!userId) return [];

    const projectMap = new Map<string, Project>();
    projects.forEach((p) => projectMap.set(p.id, p));

    const allTasks: MyTask[] = [];

    tasksByProject.forEach((tasks, projectId) => {
      const project = projectMap.get(projectId);
      if (!project) return;

      tasks.forEach((task) => {
        allTasks.push({
          ...task,
          parentTitle: tasks.find(parent => parent.id === task.parentTaskId)?.title,
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
  }, [tasksByProject, projects, userId]);

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

  return {
    tasks: myTasks,
    allProjectTasks,
    isLoading: Boolean(userId) && !projectsError && (projectsLoading || (projects.length > 0 && (snapshot.scopeKey !== scopeKey || snapshot.settled.size < projects.length))),
    error: projectsError ?? (snapshot.scopeKey === scopeKey ? snapshot.errors.values().next().value ?? null : null),
    taskCount: myTasks.length,
  };
}
