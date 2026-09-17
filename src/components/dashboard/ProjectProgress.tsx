'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import Link from 'next/link';

interface ProjectProgressData {
  id: string;
  name: string;
  color: string;
  totalTasks: number;
  completedTasks: number;
  progress: number;
}

export function ProjectProgress() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<ProjectProgressData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isE2EMockAuthEnabled()) {
      Promise.resolve().then(() => {
        setProjects([]);
        setIsLoading(false);
      });
      return;
    }

    const fetchProjectProgress = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        // Get user's projects
        const projectsRef = collection(db, 'projects');
        const projectsQuery = query(
          projectsRef,
          where('memberIds', 'array-contains', user.id)
        );
        const projectsSnapshot = await getDocs(projectsQuery);

        const projectsData: ProjectProgressData[] = [];

        // For each project, calculate progress
        for (const projectDoc of projectsSnapshot.docs) {
          const projectData = projectDoc.data();
          const tasksRef = collection(db, 'projects', projectDoc.id, 'tasks');
          const tasksSnapshot = await getDocs(tasksRef);

          let totalTasks = 0;
          let completedTasks = 0;

          tasksSnapshot.docs.forEach((taskDoc) => {
            const taskData = taskDoc.data();
            if (!taskData.isAbandoned) {
              totalTasks++;
              if (taskData.isCompleted) {
                completedTasks++;
              }
            }
          });

          const progress = totalTasks > 0
            ? Math.round((completedTasks / totalTasks) * 100)
            : 0;

          projectsData.push({
            id: projectDoc.id,
            name: projectData.name,
            color: projectData.color || '#6366f1',
            totalTasks,
            completedTasks,
            progress,
          });
        }

        // Sort by progress (lowest first, so they're more visible)
        projectsData.sort((a, b) => {
          // Projects with tasks first
          if (a.totalTasks === 0 && b.totalTasks > 0) return 1;
          if (a.totalTasks > 0 && b.totalTasks === 0) return -1;
          // Then by progress
          return a.progress - b.progress;
        });

        setProjects(projectsData);
      } catch (error) {
        console.error('Failed to fetch project progress:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjectProgress();
  }, [user]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" />
            プロジェクト進捗
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-2 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" />
            プロジェクト進捗
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            プロジェクトがありません
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5" />
          プロジェクト進捗
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {projects.slice(0, 5).map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/board`}
              className="group block"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="text-sm font-medium group-hover:text-primary">
                    {project.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {project.completedTasks}/{project.totalTasks}
                  </span>
                  <span className="text-xs font-medium">{project.progress}%</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </div>
              <Progress
                value={project.progress}
                className="mt-2 h-2"
                style={{
                  ['--progress-background' as string]: project.color,
                }}
              />
            </Link>
          ))}
          {projects.length > 5 && (
            <p className="pt-1 text-center text-xs text-muted-foreground">
              他 {projects.length - 5} 件のプロジェクト
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
