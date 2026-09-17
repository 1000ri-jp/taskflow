'use client';

import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Loader2, MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { taskRowInteraction } from '@/components/ui/density';
import { getTaskComments } from '@/lib/firebase/firestore';
import type { Comment, List, Task } from '@/types';

interface CommentedTaskSummary {
  task: Task;
  comments: Comment[];
  latestComment: Comment;
}

interface CommentedTasksPopoverProps {
  projectId: string;
  tasks: Task[];
  lists: List[];
  onTaskClick: (taskId: string) => void;
  iconOnly?: boolean;
}

export function CommentedTasksPopover({
  projectId,
  tasks,
  lists,
  onTaskClick,
  iconOnly = false,
}: CommentedTasksPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<CommentedTaskSummary[]>([]);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const listsById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);

  const taskKey = useMemo(
    () => `${projectId}:${tasks.map((task) => task.id).sort().join(',')}`,
    [projectId, tasks]
  );

  const loadCommentedTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const results = await Promise.allSettled(
      tasks.map(async (task) => ({
        task,
        comments: await (isE2EMockAuthEnabled() ? import('@/lib/task/detailMock').then(({readTaskDetailsMock}) => readTaskDetailsMock(projectId, task.id).comments) : getTaskComments(projectId, task.id)),
      }))
    );

    const nextSummaries = results
      .filter(
        (result): result is PromiseFulfilledResult<{ task: Task; comments: Comment[] }> =>
          result.status === 'fulfilled' && result.value.comments.length > 0
      )
      .map(({ value }) => ({
        ...value,
        latestComment: value.comments[value.comments.length - 1],
      }))
      .sort(
        (a, b) => b.latestComment.createdAt.getTime() - a.latestComment.createdAt.getTime()
      );

    setSummaries(nextSummaries);
    setLoadedKey(taskKey);
    setIsLoading(false);

    if (results.some((result) => result.status === 'rejected') && nextSummaries.length === 0) {
      setError('コメントを読み込めませんでした。');
    }
  }, [projectId, taskKey, tasks]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && loadedKey !== taskKey && !isLoading) {
      void loadCommentedTasks();
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <ControlHint label="コメント" description="コメントがあるタスクをまとめて確認します。">
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={iconOnly ? 'relative h-8 w-8 p-0' : 'h-8'} aria-label="コメント">
          <MessageSquareText className={iconOnly ? 'h-4 w-4' : 'mr-1.5 h-3.5 w-3.5'} />
          {!iconOnly && 'コメント'}
          {loadedKey === taskKey && (
            <Badge variant="secondary" aria-hidden="true" className={iconOnly ? 'absolute -right-1 -top-1 h-3.5 min-w-3.5 justify-center px-0.5 text-[9px]' : 'ml-1 h-4 px-1 text-xs'}>
              {summaries.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      </ControlHint>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-semibold">コメント付きタスク</p>
          <p className="text-xs text-muted-foreground">確認するだけでタスクは変更されません</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              コメントを確認中
            </div>
          ) : error ? (
            <p className="px-4 py-8 text-center text-sm text-destructive">{error}</p>
          ) : summaries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              コメント付きタスクはありません
            </p>
          ) : (
            <div className="divide-y">
              {summaries.map(({ task: loadedTask, comments, latestComment }) => {
                // Use current props so list renames and task moves are reflected without reloading comments.
                const task = tasksById.get(loadedTask.id);
                if (!task) return null;
                const list = listsById.get(task.listId);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={taskRowInteraction + ' block w-full px-3 py-3 text-left'}
                    onClick={() => {
                      setIsOpen(false);
                      onTaskClick(task.id);
                    }}
                  >
                    <p className="mb-1 break-words text-xs text-muted-foreground">
                      列：{list?.name ?? '列名不明'}
                    </p>
                    <div className="flex items-start justify-between gap-3">
                      <span className="line-clamp-1 text-sm font-medium">{task.title}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {comments.length}件
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {latestComment.content}
                    </p>
                    <time className="mt-1 block text-[10px] text-muted-foreground">
                      {format(latestComment.createdAt, 'M/d H:mm', { locale: ja })}
                    </time>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
