'use client';

import { useState, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { assigneeLabel, taskDateLabel } from '@/lib/board/taskViews';
import { taskSituation } from '@/lib/task/history/presentation';
import type { List, Task } from '@/types';

interface TaskQuickPreviewProps {
  task: Task;
  allTasks: Task[];
  lists: List[];
  names: Record<string, string>;
  children: ReactElement;
}

export function TaskQuickPreview({ task, allTasks, lists, names, children }: TaskQuickPreviewProps) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={350}>
    <TooltipTrigger asChild onDragStart={() => setOpen(false)}>{children}</TooltipTrigger>
    {open && <TooltipContent data-testid="task-quick-preview" side="top" align="start" sideOffset={8} collisionPadding={12}
      onClick={event => event.stopPropagation()}
      className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(32rem,calc(100vh-2rem))] overflow-y-auto break-words p-3 text-left text-xs leading-relaxed shadow-lg">
      <PreviewContent task={task} allTasks={allTasks} lists={lists} names={names} />
    </TooltipContent>}
  </Tooltip>;
}

function PreviewContent({ task, allTasks, lists, names }: Omit<TaskQuickPreviewProps, 'children'>) {
  const projectTasks = allTasks.filter(candidate => candidate.projectId === task.projectId);
  const parent = projectTasks.find(candidate => candidate.id === task.parentTaskId);
  const { situation, next } = taskSituation(task, projectTasks, names, []);
  return <div className="space-y-2.5">
    <div>
      <p className="text-background/65">{lists.find(list => list.id === task.listId)?.name ?? '分類不明'}</p>
      <p className="text-sm font-semibold">{task.title || '名称未設定のタスク'}</p>
    </div>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {task.parentTaskId && <><dt className="text-background/65">親タスク</dt><dd>{parent ? parent.title.trim() || '名称未設定の親タスク' : '親タスクを表示できません'}</dd></>}
      <dt className="text-background/65">担当者</dt><dd>{task.assigneeIds.length ? assigneeLabel(task.assigneeIds, names) : '未設定'}</dd>
      <dt className="text-background/65">状況</dt><dd>{situation}</dd>
      <dt className="text-background/65">開始日</dt><dd>{taskDateLabel(task.startDate)}</dd>
      <dt className="text-background/65">期限</dt><dd>{taskDateLabel(task.dueDate)}</dd>
      {task.isCompleted && task.completedAt && <><dt className="text-background/65">完了日</dt><dd>{taskDateLabel(task.completedAt)}</dd></>}
      {task.priority && <><dt className="text-background/65">優先度</dt><dd>{{ high: '高', medium: '中', low: '低' }[task.priority]}</dd></>}
    </dl>
    {!task.isCompleted && !task.isAbandoned && situation !== '未着手' && situation !== '着手' && <p><span className="text-background/65">次に： </span>{next}</p>}
    {task.description.trim() && <p className="line-clamp-4 whitespace-pre-wrap border-t border-background/20 pt-2 text-background/85">{task.description}</p>}
    <p className="border-t border-background/20 pt-2 text-[10px] text-background/65">クリックで詳細を開く</p>
  </div>;
}
