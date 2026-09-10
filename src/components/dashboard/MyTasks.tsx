'use client';

import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMyTasks } from '@/hooks/useMyTasks';
import { CheckSquare, Loader2, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTaskOverdue } from '@/lib/utils/task';

export function MyTasks() {
  const { tasks, isLoading, taskCount } = useMyTasks();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckSquare className="h-4 w-4" />
          マイタスク（{taskCount}件）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <CheckSquare className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              アサインされたタスクはありません
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[280px] pr-4">
            <div className="space-y-2">
              {tasks.map((task) => {
                const overdue = isTaskOverdue(task);
                return (
                  <Link
                    key={task.id}
                    href={`/projects/${task.projectId}/board?task=${task.id}`}
                    className="block"
                  >
                    <div className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                      {/* Project Icon */}
                      {task.projectIconUrl ? (
                        <Image
                          src={task.projectIconUrl}
                          alt={task.projectName}
                          width={24}
                          height={24}
                          className="h-6 w-6 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs"
                          style={{ backgroundColor: task.projectColor }}
                        >
                          {task.projectIcon}
                        </div>
                      )}

                      {/* Task Info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {task.projectName}
                        </p>
                        {task.parentTaskId && <p className="truncate text-xs text-muted-foreground">親タスク：{task.parentTitle ?? '親タスクあり'}</p>}
                      </div>

                      {/* Due Date & Priority */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {task.dueDate && (
                          <div
                            className={cn(
                              'flex items-center gap-1 text-xs',
                              overdue ? 'text-red-500' : 'text-muted-foreground'
                            )}
                          >
                            <Calendar className="h-3 w-3" />
                            {format(task.dueDate, 'M/d', { locale: ja })}
                          </div>
                        )}
                        {task.priority && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-5 px-1.5 text-[10px]',
                              task.priority === 'high' &&
                                'border-red-300 bg-red-50 text-red-700',
                              task.priority === 'medium' &&
                                'border-yellow-300 bg-yellow-50 text-yellow-700',
                              task.priority === 'low' &&
                                'border-gray-300 bg-gray-50 text-gray-700'
                            )}
                          >
                            {task.priority === 'high'
                              ? '高'
                              : task.priority === 'medium'
                                ? '中'
                                : '低'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
