'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Calendar, CheckCircle2, Clock, Link2, MoveRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { getUsersByIds, getTaskAttachments } from '@/lib/firebase/firestore';
import type { Task, Label, Tag, User as UserType, Attachment, List } from '@/types';
import { isTaskOverdue, getEffectiveDates } from '@/lib/utils/task';
import { taskReviewState } from '@/lib/board/taskViews';
import { TaskFlowStateBadge } from './TaskViewFields';
import { useBoardDisplayStore } from '@/stores/boardDisplayStore';

interface TaskCardProps {
  projectId: string;
  task: Task;
  listName: string;
  listColor: string;
  labels: Label[];
  tags: Tag[];
  allTasks?: Task[]; // For dependency lookup
  onClick: () => void;
  lists?: List[];
  onMove?: (listId: string) => void;
  isDragging?: boolean;
  disableDragging?: boolean;
}

export function TaskCard({ projectId, task, listName, listColor, labels, tags, allTasks, onClick, lists = [], onMove, isDragging, disableDragging = false }: TaskCardProps) {
  const display = useBoardDisplayStore((state) => state.settings);
  const [assignees, setAssignees] = useState<UserType[]>([]);
  const [imageAttachments, setImageAttachments] = useState<Attachment[]>([]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id, disabled: disableDragging });

  // Fetch assignees
  useEffect(() => {
    let isMounted = true;
    if (task.assigneeIds.length === 0) {
      Promise.resolve().then(() => {
        if (isMounted) setAssignees([]);
      });
    } else {
      getUsersByIds(task.assigneeIds).then((users) => {
        if (isMounted) setAssignees(users);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [task.assigneeIds]);

  // Fetch image attachments
  useEffect(() => {
    if (projectId && task.id) {
      getTaskAttachments(projectId, task.id).then((attachments) => {
        // Filter only image attachments
        const images = attachments.filter((a) => a.type.startsWith('image/'));
        setImageAttachments(images);
      });
    }
  }, [projectId, task.id]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskLabels = labels.filter((label) => task.labelIds.includes(label.id));
  const taskTags = tags.filter((tag) => task.tagIds?.includes(tag.id));
  const today = startOfDay(new Date());
  const isOverdue = isTaskOverdue(task, today);
  const isStarted = !task.isCompleted && !isOverdue && Boolean(
    task.startDate && startOfDay(task.startDate).getTime() <= today.getTime()
  );

  // Calculate dependency info
  const dependentTasks = allTasks
    ? task.dependsOnTaskIds
        .map((id) => allTasks.find((t) => t.id === id))
        .filter((t): t is Task => t !== undefined)
    : [];

  // Get effective dates using shared helper
  const effectiveDates = allTasks ? getEffectiveDates(task, allTasks) : null;
  const predictedDates = effectiveDates?.isPredicted && effectiveDates.predictedStart && effectiveDates.predictedEnd
    ? { start: effectiveDates.predictedStart, end: effectiveDates.predictedEnd }
    : null;
  const isDeadlineOverdue = effectiveDates?.isDeadlineOverdue ?? false;
  const hasDependencies = dependentTasks.length > 0;
  const reviewState = allTasks ? taskReviewState(task, allTasks) : null;

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const moveTargets = lists.filter((list) => list.id !== task.listId);
  const hasDateRail = Boolean(task.startDate || task.dueDate);
  const hasVisibleMetadata = task.isCompleted || display.showListName ||
    (display.showAssignees && assignees.length > 0) ||
    (display.showTags && taskTags.length > 0) ||
    (display.showPriority && Boolean(task.priority));
  const hasHoverDetails = Boolean(
    task.description ||
    taskLabels.length > 0 ||
    taskTags.length > 0 ||
    task.completedAt ||
    hasDateRail ||
    task.durationDays ||
    hasDependencies ||
    isDeadlineOverdue ||
    predictedDates
  );

  const renderRailDate = (date: Date, isDueDate = false) => {
    const text = format(date, 'M/d', { locale: ja });

    return (
      <time
        dateTime={format(date, 'yyyy-MM-dd')}
        aria-label={`${isDueDate ? '期限' : '開始日'}：${format(date, 'yyyy年M月d日')}${isDueDate && isOverdue ? '（期限切れ）' : ''}`}
        className={cn(
          'whitespace-nowrap text-[15px] leading-none tabular-nums',
          isOverdue || isStarted ? 'font-bold' : 'font-normal'
        )}
      >
        {text}
      </time>
    );
  };

  const completionBadge = task.isCompleted && (
    <Badge
      data-testid="task-card-completion"
      title={task.completedAt ? `完了日：${format(task.completedAt, 'yyyy年M月d日', { locale: ja })}` : '完了日未記録'}
      className="h-5 shrink-0 gap-1 bg-emerald-100 px-1.5 text-[10px] text-emerald-800 hover:bg-emerald-100"
    >
      <CheckCircle2 className="h-3 w-3" />
      {task.completedAt ? (
        <>
          <time dateTime={format(task.completedAt, 'yyyy-MM-dd')}>
            {format(task.completedAt, 'M/d', { locale: ja })}
          </time>
          完了
        </>
      ) : '完了日未記録'}
    </Badge>
  );

  const card = (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-disabled={undefined}
      aria-roledescription={disableDragging ? undefined : attributes['aria-roledescription']}
      aria-describedby={disableDragging ? undefined : attributes['aria-describedby']}
      onKeyDown={(event) => {
        if (disableDragging && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        } else {
          listeners?.onKeyDown?.(event);
        }
      }}
      onClick={onClick}
      data-testid="task-card"
      data-completed={task.isCompleted ? 'true' : 'false'}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md',
        (isDragging || isSortableDragging) && 'opacity-50 shadow-lg',
        isDeadlineOverdue && 'border-red-500 border-2 bg-red-50',
        task.isCompleted && 'border-neutral-300 bg-emerald-50/50'
      )}
    >
      {/* Image Attachments - displayed at top like Jooto */}
      {imageAttachments.length > 0 && (
        <div className="relative">
          {imageAttachments.length === 1 ? (
            <div className="relative h-32 w-full overflow-hidden rounded-t-lg">
              <Image
                src={imageAttachments[0].url}
                alt={imageAttachments[0].name}
                fill
                sizes="(max-width: 768px) 100vw, 384px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-0.5">
              {imageAttachments.slice(0, 4).map((attachment, index) => (
                <div key={attachment.id} className="relative h-16">
                  <Image
                    src={attachment.url}
                    alt={attachment.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 192px"
                    className={cn(
                      'object-cover',
                      index === 0 && 'rounded-tl-lg',
                      index === 1 && 'rounded-tr-lg'
                    )}
                  />
                  {index === 3 && imageAttachments.length > 4 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm font-medium">
                      +{imageAttachments.length - 4}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex">
        {hasDateRail && (
          <aside
            data-testid="task-card-date-rail"
            data-date-status={isOverdue ? 'overdue' : isStarted ? 'started' : 'neutral'}
            title={isOverdue ? '期限切れ' : isStarted ? '開始期間内' : undefined}
            className={cn(
              'flex w-14 shrink-0 flex-col items-center justify-center gap-1.5 border-r px-1 py-2',
              isOverdue ? 'border-red-200 bg-red-50 text-red-700'
                : isStarted ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                  : 'border-blue-200 bg-blue-50 text-slate-600'
            )}
          >
            {task.startDate && renderRailDate(task.startDate)}
            {task.startDate && task.dueDate && (
              <span className="text-sm font-normal leading-none opacity-60" aria-hidden="true">
                〜
              </span>
            )}
            {task.dueDate && renderRailDate(task.dueDate, true)}
          </aside>
        )}

        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-start gap-2">
            <p
              className={cn(
                'line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-950',
                task.isCompleted && 'text-slate-500 line-through'
              )}
            >
              {task.title}
            </p>
            {reviewState && <TaskFlowStateBadge label={reviewState.label} completed={reviewState.completed} />}
          </div>
          {task.parentTaskId && <p className="mt-1 truncate text-[10px] text-blue-700">子タスク · {allTasks?.find(parent => parent.id === task.parentTaskId)?.title ?? '親タスクあり'}</p>}

          {hasVisibleMetadata && (
            <div data-testid="task-card-metadata" className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {display.showAssignees && assignees.length > 0 && (
                  <div data-testid="task-card-assignees" className="flex -space-x-1.5">
                    {assignees.slice(0, 4).map((assignee) => (
                      <Avatar key={assignee.id} className="h-6 w-6 border-2 border-white">
                        <AvatarImage src={assignee.photoURL || ''} alt={assignee.displayName} />
                        <AvatarFallback className="text-[9px]">
                          {getInitials(assignee.displayName)}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {assignees.length > 4 && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-muted text-[9px] font-medium">
                        +{assignees.length - 4}
                      </div>
                    )}
                  </div>
                )}
                {completionBadge}
                {display.showTags && taskTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    data-testid="task-card-tag"
                    title={tag.name}
                    className="h-5 max-w-full min-w-0 px-1.5 text-[10px] text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    <span className="truncate">{tag.name}</span>
                  </Badge>
                ))}
              </div>

              <div className="flex min-w-0 items-center justify-end gap-1">
                {display.showPriority && task.priority && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 shrink-0 px-1.5 text-[10px]',
                      task.priority === 'high' && 'border-red-300 bg-red-50 text-red-700',
                      task.priority === 'medium' && 'border-yellow-300 bg-yellow-50 text-yellow-700',
                      task.priority === 'low' && 'border-gray-300 bg-gray-50 text-gray-700'
                    )}
                  >
                    {task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}
                  </Badge>
                )}
                {display.showListName && (
                  <Badge
                    variant="outline"
                    className="h-5 max-w-[92px] shrink px-1.5 text-[9px] font-semibold"
                    style={{
                      borderColor: listColor,
                      color: listColor,
                      backgroundColor: `${listColor}18`,
                    }}
                  >
                    <span className="truncate">{listName}</span>
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const cardWithDetails = !hasHoverDetails || isDragging || isSortableDragging ? card : (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="w-72 max-w-[calc(100vw-2rem)] space-y-2 px-3 py-2.5 text-left text-xs text-balance">
        <p className="font-semibold">詳細</p>

        {task.description && <p className="whitespace-pre-wrap text-background/85">{task.description}</p>}

        {(taskLabels.length > 0 || taskTags.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {taskLabels.map((label) => (
              <Badge
                key={label.id}
                className="h-5 px-1.5 text-[10px] text-white"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </Badge>
            ))}
            {taskTags.map((tag) => (
              <Badge
                key={tag.id}
                className="h-5 px-2 text-[10px] text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        <div className="space-y-1 text-background/85">
          {hasDateRail && (
            <p className="flex items-center gap-1">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>
                {task.startDate && format(task.startDate, 'yyyy年M月d日', { locale: ja })}
                {task.startDate && task.dueDate && ' 〜 '}
                {task.dueDate && format(task.dueDate, 'yyyy年M月d日', { locale: ja })}
              </span>
            </p>
          )}
          {task.isCompleted && task.completedAt && (
            <p className="flex items-center gap-1 text-green-300">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span>完了: {format(task.completedAt, 'yyyy年M月d日', { locale: ja })}</span>
            </p>
          )}
          {task.durationDays && (
            <p className="flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" />
              <span>必要期間: {task.durationDays}日</span>
            </p>
          )}
          {isDeadlineOverdue && (
            <p className="flex items-center gap-1 text-red-300">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>依存タスクの遅延により期限超過</span>
            </p>
          )}
          {predictedDates && !task.startDate && !task.dueDate && (
            <p className="flex items-center gap-1 text-amber-200">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>
                予測: {format(predictedDates.start, 'M/d', { locale: ja })}〜{format(predictedDates.end, 'M/d', { locale: ja })}
              </span>
            </p>
          )}
        </div>

        {hasDependencies && (
          <div className="space-y-1 border-t border-background/20 pt-2 text-background/85">
            <p className="flex items-center gap-1 font-medium text-background">
              <Link2 className="h-3 w-3" />依存タスク
            </p>
            {dependentTasks.map((dep) => (
              <p key={dep.id} className="flex items-center gap-1 pl-4">
                {dep.isCompleted ? (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-green-300" />
                ) : (
                  <span className="h-3 w-3 shrink-0 rounded-full border border-background/50" />
                )}
                <span className={cn('truncate', dep.isCompleted && 'line-through opacity-70')}>
                  {dep.title}
                </span>
              </p>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );

  if (!onMove || moveTargets.length === 0 || isDragging || isSortableDragging) {
    return cardWithDetails;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="contents">{cardWithDetails}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <MoveRight className="mr-2 h-4 w-4" />
            移動
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {moveTargets.map((list) => (
              <ContextMenuItem key={list.id} onSelect={() => onMove(list.id)}>
                {list.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
