'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { getProjectTasks } from '@/lib/firebase/firestore';
import type { Project, Task } from '@/types';

export interface SearchResult {
  type: 'project' | 'task';
  id: string;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  projectColor: string;
  // Task-specific fields
  isCompleted?: boolean;
  priority?: string | null;
  listId?: string;
}

interface SearchSnapshot {
  projects: Project[];
  tasks: Map<string, Task[]>;
}

export function useGlobalSearch() {
  const { projects, isLoading: projectsLoading, error: projectsError } = useProjects();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cacheRef = useRef<SearchSnapshot | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    const trimmed = query.trim().toLowerCase();
    // Publish project results before awaiting cached or network task results.
    // A queued project update after a cache hit used to erase matching tasks.
    Promise.resolve().then(async () => {
      if (!active) return;
      setError(null);
      if (!trimmed) {
        cacheRef.current = null;
        setResults([]);
        setIsSearching(false);
        return;
      }
      const matchingProjects: SearchResult[] = projects
        .filter(project => project.name.toLowerCase().includes(trimmed) || (project.description ?? '').toLowerCase().includes(trimmed))
        .map(project => ({ type: 'project', id: project.id, title: project.name, description: project.description ?? '',
          projectId: project.id, projectName: project.name, projectIcon: project.icon, projectColor: project.color }));
      setResults(matchingProjects);
      setIsSearching(projectsLoading || !projectsError);
      if (projectsError) {
        setError('プロジェクトを取得できず、検索できませんでした。画面を開き直してください。');
        return;
      }
      if (projectsLoading) return;
      if (cacheRef.current?.projects !== projects) cacheRef.current = { projects, tasks: new Map() };
      const snapshot = cacheRef.current;
      const missing = projects.filter(project => !snapshot.tasks.has(project.id));
      const fetched = await Promise.allSettled(missing.map(async project => ({
        id: project.id, tasks: await getProjectTasks(project.id),
      })));
      // Closing, changing query/account, or unmounting invalidates late results.
      if (!active || cacheRef.current !== snapshot) return;
      let failed = 0;
      for (const result of fetched) {
        if (result.status === 'fulfilled') snapshot.tasks.set(result.value.id, result.value.tasks);
        else failed += 1;
      }
      const matchingTasks: SearchResult[] = [];
      for (const project of projects) {
        for (const task of snapshot.tasks.get(project.id) ?? []) {
          if (task.isArchived || !(task.title.toLowerCase().includes(trimmed) || (task.description ?? '').toLowerCase().includes(trimmed))) continue;
          matchingTasks.push({ type: 'task', id: task.id, title: task.title, description: task.description ?? '',
            projectId: project.id, projectName: project.name, projectIcon: project.icon, projectColor: project.color,
            isCompleted: task.isCompleted, priority: task.priority, listId: task.listId });
        }
      }
      matchingTasks.sort((a, b) => a.isCompleted !== b.isCompleted ? (a.isCompleted ? 1 : -1) : a.title.localeCompare(b.title));
      setResults([...matchingProjects, ...matchingTasks]);
      setError(failed ? `${failed}件のプロジェクトのタスクを取得できませんでした。取得できた範囲だけ表示しています。` : null);
      setIsSearching(false);
    }).catch(() => {
      if (!active) return;
      setError('検索できませんでした。もう一度取得してください。');
      setIsSearching(false);
    });
    return () => { active = false; };
  }, [query, projects, projectsLoading, projectsError, attempt]);

  return {
    query, setQuery, results, isSearching, error, retry: projectsError ? undefined : retry,
    projectResults: results.filter(result => result.type === 'project'),
    taskResults: results.filter(result => result.type === 'task'),
  };
}
