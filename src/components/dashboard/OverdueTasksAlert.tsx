'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import { startOfDay, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import Link from 'next/link';
import { taskRowInteraction } from '@/components/ui/density';

interface OverdueTask {
  id: string;
  title: string;
  dueDate: Date;
  projectId: string;
  projectName: string;
}

export function OverdueTasksAlert() {
  const { user } = useAuthStore();
  const [overdueTasks, setOverdueTasks] = useState<OverdueTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isE2EMockAuthEnabled()) {
      Promise.resolve().then(() => {
        setOverdueTasks([]);
        setIsLoading(false);
      });
      return;
    }

    const fetchOverdueTasks = async () => {
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

        const today = startOfDay(new Date());
        const tasks: OverdueTask[] = [];

        // For each project, get overdue tasks assigned to user
        for (const projectDoc of projectsSnapshot.docs) {
          const projectData = projectDoc.data();
          const tasksRef = collection(db, 'projects', projectDoc.id, 'tasks');
          const tasksQuery = query(
            tasksRef,
            where('assigneeIds', 'array-contains', user.id),
            where('isCompleted', '==', false)
          );
          const tasksSnapshot = await getDocs(tasksQuery);

          tasksSnapshot.docs.forEach((taskDoc) => {
            const taskData = taskDoc.data();
            if (taskData.dueDate) {
              const dueDate = taskData.dueDate.toDate();
              if (dueDate < today) {
                tasks.push({
                  id: taskDoc.id,
                  title: taskData.title,
                  dueDate,
                  projectId: projectDoc.id,
                  projectName: projectData.name,
                });
              }
            }
          });
        }

        // Sort by due date (oldest first)
        tasks.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        setOverdueTasks(tasks);
      } catch (error) {
        console.error('Failed to fetch overdue tasks:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOverdueTasks();
  }, [user]);

  if (isLoading) {
    return null;
  }

  if (overdueTasks.length === 0) {
    return null;
  }

  return (
    <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
          期限切れのタスク
          <Badge variant="destructive" className="ml-2">
            {overdueTasks.length}件
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {overdueTasks.slice(0, 3).map((task) => (
            <Link
              key={task.id}
              href={`/projects/${task.projectId}/board`}
              className={taskRowInteraction + ' flex items-center justify-between rounded-md bg-white/50 px-3 py-2 dark:bg-black/20'}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.projectName} • {format(task.dueDate, 'M/d', { locale: ja })}期限
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </Link>
          ))}
          {overdueTasks.length > 3 && (
            <p className="pt-1 text-center text-xs text-muted-foreground">
              他 {overdueTasks.length - 3} 件の期限切れタスク
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
