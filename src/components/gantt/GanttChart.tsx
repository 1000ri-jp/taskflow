'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { addDays, differenceInDays, startOfDay } from 'date-fns';
import { Calendar, Check, Filter, Eye, EyeOff, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  getDateRange,
  generateDateColumns,
  getColumnWidth,
  calculateTaskBar,
  getMonthHeaders,
  getTodayPosition,
  formatTaskDate,
  type ViewMode,
  type TaskBarResult,
} from '@/lib/utils/gantt';
import type { Task, List, Label, Milestone } from '@/types';
import { tasksInList, groupTaskFamilies } from '@/lib/board/taskHierarchy';
import {
  calculateEffectiveStartDate,
  getAllDependentTasks,
  getDependencyTasks,
  getEffectiveDates,
} from '@/lib/utils/task';

interface GanttChartProps {
  tasks: Task[];
  lists: List[];
  labels: Label[];
  listId?: string | null;
  milestones?: Milestone[];
  onMilestoneClick?: (id: string) => void;
  onTaskClick?: (taskId: string) => void;
  onTaskUpdate?: (taskId: string, data: Partial<Task>) => void;
}

const TASK_ROW_HEIGHT = 40;
const HEADER_HEIGHT = 60;
const SIDEBAR_WIDTH_DESKTOP = 280;
const SIDEBAR_WIDTH_MOBILE = 160;
const TOOLBAR_HEIGHT = 56;
const MIN_CHART_HEIGHT = 300;

export function GanttChart({
  tasks,
  lists,
  labels,
  onTaskClick,
  onTaskUpdate,
  listId,
  milestones = [],
  onMilestoneClick,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarTasksRef = useRef<HTMLDivElement>(null);
  const timelineTasksRef = useRef<HTMLDivElement>(null);
  const isScrollSyncing = useRef(false);

  // Responsive sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DESKTOP);
  useEffect(() => {
    const updateWidth = () => {
      setSidebarWidth(window.innerWidth < 640 ? SIDEBAR_WIDTH_MOBILE : SIDEBAR_WIDTH_DESKTOP);
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Drag state for resizing/moving task bars
  type DragType = 'move' | 'resize-start' | 'resize-end';
  interface DragState {
    taskId: string;
    type: DragType;
    initialMouseX: number;
    initialBarStart: number;
    initialBarWidth: number;
    task: Task;
  }
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ left: number; width: number } | null>(null);
  const justDraggedRef = useRef(false); // Track if we just finished dragging to prevent click

  // Filter state
  const [showCompleted, setShowCompleted] = useState(true);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());

  // Get list colors map
  const listColors = useMemo(() => {
    const colors: Record<string, string> = {};
    lists.forEach((list) => {
      colors[list.id] = list.color;
    });
    return colors;
  }, [lists]);

  // Calculate date range and columns
  const datedMilestones = useMemo(() => milestones.filter(item => item.dueDate && item.status !== 'cancelled'), [milestones]);
  const columnWidth = getColumnWidth(viewMode);
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => getDateRange(tasks, viewMode, 7, datedMilestones.map(item => item.dueDate!)),
    [tasks, viewMode, datedMilestones]
  );
  const columns = useMemo(
    () => generateDateColumns(rangeStart, rangeEnd, viewMode),
    [rangeStart, rangeEnd, viewMode]
  );
  const monthHeaders = useMemo(
    () => getMonthHeaders(columns, viewMode),
    [columns, viewMode]
  );
  const totalWidth = columns.length * columnWidth;
  const todayPosition = getTodayPosition(rangeStart, viewMode, columnWidth);

  // Sort tasks with dependency grouping
  const sortedTasks = useMemo(() => {
    const listOrderMap = new Map(lists.map((l, i) => [l.id, i]));

    // Helper: get all root tasks (tasks that this task depends on, recursively)
    const getDepthAndRoot = (taskId: string, visited = new Set<string>()): { depth: number; rootId: string } => {
      if (visited.has(taskId)) return { depth: 0, rootId: taskId };
      visited.add(taskId);

      const task = tasks.find((t) => t.id === taskId);
      if (!task || !task.dependsOnTaskIds || task.dependsOnTaskIds.length === 0) {
        return { depth: 0, rootId: taskId };
      }

      // Find the deepest dependency chain
      let maxDepth = 0;
      let rootId = taskId;
      for (const depId of task.dependsOnTaskIds) {
        const depResult = getDepthAndRoot(depId, visited);
        if (depResult.depth + 1 > maxDepth) {
          maxDepth = depResult.depth + 1;
          rootId = depResult.rootId;
        }
      }
      return { depth: maxDepth, rootId };
    };

    // Calculate depth and root for each task
    const taskMeta = new Map<string, { depth: number; rootId: string; originalOrder: number }>();
    tasks.forEach((task, index) => {
      const { depth, rootId } = getDepthAndRoot(task.id);
      taskMeta.set(task.id, { depth, rootId, originalOrder: index });
    });

    // Get base order for a task (used for root tasks)
    const getBaseOrder = (taskId: string): number => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return 999999;
      const listOrder = listOrderMap.get(task.listId) ?? 0;
      return listOrder * 10000 + task.order;
    };

    // Sort: group by root task, then by depth within group
    return [...tasks].sort((a, b) => {
      const metaA = taskMeta.get(a.id)!;
      const metaB = taskMeta.get(b.id)!;

      // If they share the same root (same dependency chain), sort by depth
      if (metaA.rootId === metaB.rootId) {
        return metaA.depth - metaB.depth;
      }

      // Otherwise, sort by the root task's original order
      const rootOrderA = getBaseOrder(metaA.rootId);
      const rootOrderB = getBaseOrder(metaB.rootId);
      if (rootOrderA !== rootOrderB) return rootOrderA - rootOrderB;

      // Fallback to original order
      return metaA.originalOrder - metaB.originalOrder;
    });
  }, [tasks, lists]);

  // Apply filters to sorted tasks
  const filteredTasks = useMemo(() => {
    const scopedIds = new Set(tasksInList(tasks, listId ?? null).map(task => task.id));
    const matching = sortedTasks.filter((task) => {
      if (task.isArchived || !scopedIds.has(task.id)) return false;
      // Filter by completed status
      if (!showCompleted && task.isCompleted) return false;

      // Filter by list (if any lists are selected)
      if (listId === undefined && selectedListIds.size > 0 && !selectedListIds.has(task.listId)) return false;

      return true;
    });
    return groupTaskFamilies(matching, tasks).flatMap(family => [family.task, ...family.children]);
  }, [sortedTasks, showCompleted, selectedListIds, listId, tasks]);

  // Check if any filter is active
  const hasActiveFilter = !showCompleted || (listId === undefined && selectedListIds.size > 0);

  // Calculate task positions for dependency arrows (including predicted positions)
  const taskPositions = useMemo(() => {
    const positions: Record<string, {
      row: number;
      barStart: number;
      barEnd: number;
      bar: TaskBarResult;
      endDate: Date | null;
      startDate: Date | null;
      isPredicted: boolean;
      isDeadlineOverdue: boolean;
      effectiveDates: ReturnType<typeof getEffectiveDates>;
    }> = {};
    filteredTasks.forEach((task, index) => {
      const effectiveDates = getEffectiveDates(task, tasks);

      // Try to calculate bar from explicit dates first
      let bar = calculateTaskBar(task, rangeStart, viewMode, columnWidth);
      let isPredicted = false;
      let actualStartDate = task.startDate;
      let actualEndDate = task.isCompleted && task.completedAt ? task.completedAt : task.dueDate;

      // If no explicit bar but we have predicted dates, create a predicted bar
      if (!bar && effectiveDates.isPredicted && effectiveDates.predictedStart && effectiveDates.predictedEnd) {
        // Create a temporary task-like object for bar calculation
        const predictedTask = {
          ...task,
          startDate: effectiveDates.predictedStart,
          dueDate: effectiveDates.predictedEnd,
        };
        bar = calculateTaskBar(predictedTask, rangeStart, viewMode, columnWidth);
        isPredicted = true;
        actualStartDate = effectiveDates.predictedStart;
        actualEndDate = effectiveDates.predictedEnd;
      }

      if (bar) {
        positions[task.id] = {
          row: index,
          barStart: bar.start,
          barEnd: bar.start + bar.width,
          bar,
          endDate: actualEndDate,
          startDate: actualStartDate,
          isPredicted,
          isDeadlineOverdue: effectiveDates.isDeadlineOverdue,
          effectiveDates,
        };
      }
    });
    return positions;
  }, [filteredTasks, tasks, rangeStart, viewMode, columnWidth]);

  // Extract dependencies for arrow rendering (only for visible tasks)
  const dependencies = useMemo(() => {
    const filteredTaskIds = new Set(filteredTasks.map((t) => t.id));
    return filteredTasks.flatMap((task) =>
      (task.dependsOnTaskIds || [])
        .filter((depId) => filteredTaskIds.has(depId)) // Only show deps where both tasks are visible
        .map((depId) => {
          const depTask = tasks.find((t) => t.id === depId);
          return {
            from: depId,
            to: task.id,
            isCompleted: depTask?.isCompleted ?? false,
            fromTask: depTask,
            toTask: task,
          };
        })
    ).filter((dep) => taskPositions[dep.from] && taskPositions[dep.to]);
  }, [filteredTasks, tasks, taskPositions]);

  // Scroll to today on mount
  useEffect(() => {
    if (scrollRef.current && timelineTasksRef.current && todayPosition > 0) {
      const containerWidth = scrollRef.current.clientWidth;
      const scrollTo = todayPosition - containerWidth / 2;
      scrollRef.current.scrollLeft = Math.max(0, scrollTo);
      timelineTasksRef.current.scrollLeft = Math.max(0, scrollTo);
    }
  }, [todayPosition]);

  const handleScrollToToday = () => {
    if (scrollRef.current && timelineTasksRef.current) {
      const containerWidth = scrollRef.current.clientWidth;
      const scrollTo = todayPosition - containerWidth / 2;
      scrollRef.current.scrollTo({
        left: Math.max(0, scrollTo),
        behavior: 'smooth',
      });
      timelineTasksRef.current.scrollTo({
        left: Math.max(0, scrollTo),
        behavior: 'smooth',
      });
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Sync horizontal scroll with timeline tasks
    if (timelineTasksRef.current) {
      timelineTasksRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Sync vertical scroll between sidebar and timeline
  const handleSidebarScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollSyncing.current) return;
    isScrollSyncing.current = true;
    if (timelineTasksRef.current) {
      timelineTasksRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    requestAnimationFrame(() => {
      isScrollSyncing.current = false;
    });
  };

  const handleTimelineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollSyncing.current) return;
    isScrollSyncing.current = true;
    if (sidebarTasksRef.current) {
      sidebarTasksRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    requestAnimationFrame(() => {
      isScrollSyncing.current = false;
    });
  };

  // Convert pixel position to date
  const pixelToDate = useCallback((pixelX: number): Date => {
    let unitDivisor: number;
    switch (viewMode) {
      case 'day':
        unitDivisor = 1;
        break;
      case 'week':
        unitDivisor = 7;
        break;
      case 'month':
        unitDivisor = 30;
        break;
    }
    const daysFromStart = (pixelX / columnWidth) * unitDivisor;
    return addDays(startOfDay(rangeStart), Math.round(daysFromStart));
  }, [viewMode, columnWidth, rangeStart]);

  // Helper to extract clientX from both mouse and touch events
  const getClientX = (e: MouseEvent | TouchEvent): number => {
    if ('touches' in e) {
      return e.changedTouches[0]?.clientX ?? 0;
    }
    return e.clientX;
  };

  // Drag handlers (support both mouse and touch)
  const handleDragStart = useCallback((
    e: React.MouseEvent | React.TouchEvent,
    task: Task,
    type: DragType,
    barStart: number,
    barWidth: number
  ) => {
    // Don't allow dragging completed tasks
    if (task.isCompleted) return;

    e.preventDefault();
    e.stopPropagation();

    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;

    setDragState({
      taskId: task.id,
      type,
      initialMouseX: clientX,
      initialBarStart: barStart,
      initialBarWidth: barWidth,
      task,
    });
    setDragPreview({ left: barStart, width: barWidth });
  }, []);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState) return;

    // Prevent scroll while dragging on touch
    if ('touches' in e) e.preventDefault();

    const clientX = getClientX(e);
    const deltaX = clientX - dragState.initialMouseX;
    let newLeft = dragState.initialBarStart;
    let newWidth = dragState.initialBarWidth;

    switch (dragState.type) {
      case 'move':
        newLeft = dragState.initialBarStart + deltaX;
        break;
      case 'resize-start':
        newLeft = dragState.initialBarStart + deltaX;
        newWidth = dragState.initialBarWidth - deltaX;
        if (newWidth < columnWidth) {
          newWidth = columnWidth;
          newLeft = dragState.initialBarStart + dragState.initialBarWidth - columnWidth;
        }
        break;
      case 'resize-end':
        newWidth = dragState.initialBarWidth + deltaX;
        if (newWidth < columnWidth) {
          newWidth = columnWidth;
        }
        break;
    }

    setDragPreview({ left: newLeft, width: newWidth });
  }, [dragState, columnWidth]);

  const handleDragEnd = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState || !dragPreview || !onTaskUpdate) {
      setDragState(null);
      setDragPreview(null);
      return;
    }

    // Check if there was actual movement (more than 5px threshold)
    const clientX = getClientX(e);
    const movedDistance = Math.abs(clientX - dragState.initialMouseX);
    if (movedDistance < 5) {
      // No significant movement - treat as click, not drag
      setDragState(null);
      setDragPreview(null);
      return;
    }

    // Mark that we just dragged to prevent click
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 100);

    // Calculate new dates from preview position
    let newStartDate = pixelToDate(dragPreview.left);
    let newEndDate = pixelToDate(dragPreview.left + dragPreview.width);

    // Constraint: start date cannot be before dependency's end date
    if (dragState.type === 'resize-start' || dragState.type === 'move') {
      const dependencies = getDependencyTasks(dragState.task, tasks);
      if (dependencies.length > 0) {
        const latestDepEndDate = new Date(
          Math.max(...dependencies.map((d) => (d.dueDate ? d.dueDate.getTime() : 0)))
        );
        if (newStartDate < latestDepEndDate) {
          newStartDate = latestDepEndDate;
          // For move, also adjust end date to maintain duration
          if (dragState.type === 'move') {
            const originalDuration = dragState.task.dueDate && dragState.task.startDate
              ? differenceInDays(dragState.task.dueDate, dragState.task.startDate)
              : 0;
            newEndDate = addDays(newStartDate, originalDuration);
          }
        }
      }
    }

    // Update the main task
    const updates: Partial<Task> = {};

    if (dragState.type === 'move' || dragState.type === 'resize-start') {
      updates.startDate = newStartDate;
    }
    if (dragState.type === 'move' || dragState.type === 'resize-end') {
      updates.dueDate = newEndDate;
    }

    // Only update if dates actually changed
    const originalStart = dragState.task.startDate;
    const originalEnd = dragState.task.dueDate;

    const mainTaskChanged =
      (updates.startDate && (!originalStart || updates.startDate.getTime() !== originalStart.getTime())) ||
      (updates.dueDate && (!originalEnd || updates.dueDate.getTime() !== originalEnd.getTime()));

    if (mainTaskChanged) {
      onTaskUpdate(dragState.taskId, updates);

      // Cascade update to dependent tasks when end date changes
      if (updates.dueDate && (dragState.type === 'move' || dragState.type === 'resize-end')) {
        const dependentTasks = getAllDependentTasks(dragState.taskId, tasks);

        // Update each dependent task's dates
        for (const depTask of dependentTasks) {
          if (depTask.isCompleted) continue; // Skip completed tasks

          // Calculate effective start date for this dependent task
          // based on all its dependencies (including the one we just moved)
          const tempTasks = tasks.map((t) =>
            t.id === dragState.taskId
              ? { ...t, dueDate: updates.dueDate ?? t.dueDate }
              : t
          );
          const effectiveStart = calculateEffectiveStartDate(depTask, tempTasks);

          if (effectiveStart && depTask.startDate) {
            // Check if dates need to change
            const effectiveStartTime = effectiveStart.getTime();
            const currentStartTime = depTask.startDate.getTime();

            // Update if:
            // 1. New effective start is after current start (push forward)
            // 2. New effective start is before current start AND current start was
            //    constrained by the old dependency (pull backward to follow)
            const oldEffectiveStart = calculateEffectiveStartDate(depTask, tasks);
            const wasConstrained = oldEffectiveStart &&
              Math.abs(currentStartTime - oldEffectiveStart.getTime()) < 24 * 60 * 60 * 1000; // within 1 day

            if (effectiveStartTime > currentStartTime ||
                (effectiveStartTime < currentStartTime && wasConstrained)) {
              const depDuration = depTask.dueDate
                ? differenceInDays(depTask.dueDate, depTask.startDate)
                : 0;
              const depUpdates: Partial<Task> = {
                startDate: effectiveStart,
                dueDate: addDays(effectiveStart, depDuration),
              };
              onTaskUpdate(depTask.id, depUpdates);
            }
          }
        }
      }
    }

    setDragState(null);
    setDragPreview(null);
  }, [dragState, dragPreview, onTaskUpdate, pixelToDate, tasks]);

  // Add/remove global mouse and touch event listeners for drag
  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [dragState, handleDragMove, handleDragEnd]);

  // Calculate chart height based on content
  const chartContentHeight = Math.max(
    (filteredTasks.length + datedMilestones.length) * TASK_ROW_HEIGHT + HEADER_HEIGHT,
    MIN_CHART_HEIGHT
  );

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2 sm:p-3" style={{ minHeight: TOOLBAR_HEIGHT }}>
        <div className="flex items-center gap-2">
          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">日</SelectItem>
              <SelectItem value="week">週</SelectItem>
              <SelectItem value="month">月</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleScrollToToday}>
            <Calendar className="mr-2 h-4 w-4" />
            今日
          </Button>

          {/* Filter Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={hasActiveFilter ? 'default' : 'outline'}
                size="sm"
                className="relative"
              >
                <Filter className="mr-2 h-4 w-4" />
                フィルター
                {hasActiveFilter && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {(showCompleted ? 0 : 1) + selectedListIds.size}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <div className="space-y-4">
                {/* Completed tasks toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">完了タスクを表示</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setShowCompleted(!showCompleted)}
                  >
                    {showCompleted ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* List filter */}
                {listId === undefined && <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">リスト</span>
                    {selectedListIds.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setSelectedListIds(new Set())}
                      >
                        すべて表示
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {lists.map((list) => (
                      <label
                        key={list.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                      >
                        <Checkbox
                          checked={selectedListIds.size === 0 || selectedListIds.has(list.id)}
                          onCheckedChange={(checked) => {
                            const newSet = new Set(selectedListIds);
                            if (selectedListIds.size === 0) {
                              // First selection: show only this list
                              lists.forEach((l) => {
                                if (l.id !== list.id) newSet.add(l.id);
                              });
                              newSet.delete(list.id);
                              // Invert logic: selected means NOT in the set
                              setSelectedListIds(new Set([list.id]));
                            } else if (checked) {
                              newSet.add(list.id);
                              // If all lists selected, clear filter
                              if (newSet.size === lists.length) {
                                setSelectedListIds(new Set());
                              } else {
                                setSelectedListIds(newSet);
                              }
                            } else {
                              newSet.delete(list.id);
                              setSelectedListIds(newSet);
                            }
                          }}
                        />
                        <div
                          className="h-3 w-3 rounded"
                          style={{ backgroundColor: list.color }}
                        />
                        <span className="text-sm">{list.name}</span>
                      </label>
                    ))}
                  </div>
                </div>}

                {/* Clear all filters */}
                {hasActiveFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setShowCompleted(true);
                      setSelectedListIds(new Set());
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                    フィルターをクリア
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          {/* Legend */}
          <div className="flex items-center gap-3 text-sm">
            {lists.filter(list => filteredTasks.some(task => task.listId === list.id)).slice(0, 5).map((list) => (
              <div key={list.id} className="flex items-center gap-1">
                <div
                  className="h-3 w-3 rounded"
                  style={{ backgroundColor: list.color }}
                />
                <span className="text-muted-foreground">{list.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex overflow-hidden" style={{ height: chartContentHeight }}>
        {/* Fixed Sidebar */}
        <div
          className="flex flex-shrink-0 flex-col border-r bg-background"
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar Header */}
          <div
            className="flex-shrink-0 border-b bg-muted/50 px-3 font-medium"
            style={{ height: HEADER_HEIGHT }}
          >
            <div className="flex h-full items-center">タスク名</div>
          </div>

          {/* Sidebar Tasks */}
          <div
            ref={sidebarTasksRef}
            className="flex-1 overflow-y-auto"
            onScroll={handleSidebarScroll}
          >
            {filteredTasks.map((task) => {
              const taskLabels = labels.filter((l) =>
                task.labelIds.includes(l.id)
              );

              return (
                <div
                  key={task.id}
                  className="flex cursor-pointer items-center gap-2 border-b px-3 hover:bg-muted/50"
                  style={{ height: TASK_ROW_HEIGHT }}
                  onClick={() => onTaskClick?.(task.id)}
                >
                  <div
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: listColors[task.listId] }}
                  />
                  <div className="min-w-0 flex-1"><span className="block truncate text-[10px] text-muted-foreground" title={lists.find(list => list.id === task.listId)?.name}>{lists.find(list => list.id === task.listId)?.name ?? '分類不明'}{task.parentTaskId && ` · 親：${tasks.find(parent => parent.id === task.parentTaskId)?.title ?? '表示できません'}`}</span><span
                    className={cn(
                      'block truncate text-sm',
                      task.isCompleted && 'text-muted-foreground line-through'
                    )}
                  >
                    {task.parentTaskId && '↳ '}{task.title || '名称未設定のタスク'}
                  </span></div>
                  {taskLabels.slice(0, 2).map((label) => (
                    <Badge
                      key={label.id}
                      variant="outline"
                      className="h-5 px-1 text-xs"
                      style={{
                        borderColor: label.color,
                        color: label.color,
                      }}
                    >
                      {label.name}
                    </Badge>
                  ))}
                </div>
              );
            })}
            {datedMilestones.map(item => <button key={item.id} type="button" className="flex w-full items-center gap-2 border-b bg-violet-50/50 px-3 text-left text-xs text-violet-800 hover:bg-violet-100" style={{ height: TASK_ROW_HEIGHT }} onClick={() => onMilestoneClick?.(item.id)}><span>⚑</span><span className="min-w-0 truncate">{item.title}</span><span className="ml-auto shrink-0">{formatTaskDate(item.dueDate)}</span></button>)}
          </div>
        </div>

        {/* Scrollable Timeline */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header - Horizontal scroll only */}
          <div
            ref={scrollRef}
            className="flex-shrink-0 overflow-x-auto overflow-y-hidden"
            onScroll={handleScroll}
            style={{ height: HEADER_HEIGHT }}
          >
            <div style={{ width: totalWidth }} className="border-b bg-background">
              {/* Month Row */}
              <div className="flex border-b" style={{ height: 28 }}>
                {monthHeaders.map((header, i) => (
                  <div
                    key={i}
                    className="border-r px-2 text-xs font-medium"
                    style={{ width: header.span * columnWidth }}
                  >
                    {header.month}
                  </div>
                ))}
              </div>

              {/* Date Row */}
              <div className="flex" style={{ height: 32 }}>
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex flex-col items-center justify-center border-r text-xs',
                      col.isToday && 'bg-primary/10 font-bold text-primary',
                      col.isWeekend && !col.isToday && 'bg-muted/30'
                    )}
                    style={{ width: columnWidth }}
                  >
                    <span>{col.label}</span>
                    {col.subLabel && (
                      <span className="text-[10px] text-muted-foreground">
                        {col.subLabel}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Task Rows - Both horizontal and vertical scroll */}
          <div
            ref={timelineTasksRef}
            className="flex-1 overflow-auto"
            onScroll={(e) => {
              handleTimelineScroll(e);
              // Sync horizontal scroll with header
              if (scrollRef.current) {
                scrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          >
            <div style={{ width: totalWidth }} className="relative">
              {/* Grid Background */}
              <div className="absolute inset-0 flex">
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className={cn(
                      'border-r',
                      col.isWeekend && 'bg-muted/20'
                    )}
                    style={{ width: columnWidth }}
                  />
                ))}
              </div>

              {/* Today Line */}
              {todayPosition > 0 && todayPosition < totalWidth && (
                <div
                  className="absolute z-20 w-0.5 bg-red-500"
                  style={{
                    left: todayPosition,
                    top: 0,
                    bottom: 0,
                    height: filteredTasks.length * TASK_ROW_HEIGHT,
                  }}
                />
              )}

              {/* Dependency Arrows SVG */}
              <svg
                className="pointer-events-none absolute inset-0 z-5"
                style={{
                  width: totalWidth,
                  height: filteredTasks.length * TASK_ROW_HEIGHT,
                }}
              >
                <defs>
                  <marker
                    id="arrowhead-complete"
                    markerWidth="8"
                    markerHeight="6"
                    refX="8"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
                  </marker>
                  <marker
                    id="arrowhead-incomplete"
                    markerWidth="8"
                    markerHeight="6"
                    refX="8"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
                  </marker>
                </defs>
                {dependencies.map((dep, i) => {
                  const fromPos = taskPositions[dep.from];
                  const toPos = taskPositions[dep.to];
                  if (!fromPos || !toPos) return null;

                  const fromY = fromPos.row * TASK_ROW_HEIGHT + TASK_ROW_HEIGHT / 2;
                  const toY = toPos.row * TASK_ROW_HEIGHT + TASK_ROW_HEIGHT / 2;

                  // Use cell center positions for arrows
                  // For the end date cell: barEnd - half of columnWidth = center of last day
                  // For the start date cell: barStart + half of columnWidth = center of first day
                  const fromX = fromPos.barEnd - columnWidth / 2;
                  const toX = toPos.barStart + columnWidth / 2;

                  // Create path: from center of end date to center of start date
                  let pathD: string;
                  if (fromPos.row === toPos.row) {
                    // Same row: horizontal line
                    pathD = `M ${fromX} ${fromY} L ${toX - 4} ${toY}`;
                  } else if (fromX === toX) {
                    // Same cell (same date): straight vertical line
                    pathD = `M ${fromX} ${fromY} L ${fromX} ${toY - 4}`;
                  } else {
                    // Different cells: bracket shape
                    const midX = Math.max(fromX, toX) + 15;
                    pathD = `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX - 4} ${toY}`;
                  }

                  return (
                    <path
                      key={i}
                      d={pathD}
                      fill="none"
                      stroke={dep.isCompleted ? '#22c55e' : '#9ca3af'}
                      strokeWidth="1.5"
                      strokeDasharray={dep.isCompleted ? 'none' : '4 2'}
                      markerEnd={`url(#arrowhead-${dep.isCompleted ? 'complete' : 'incomplete'})`}
                    />
                  );
                })}
              </svg>

              {/* Task Bars */}
              {filteredTasks.map((task) => {
                const position = taskPositions[task.id];
                const bar = position?.bar;
                const isPredicted = position?.isPredicted ?? false;
                const isDeadlineOverdue = position?.isDeadlineOverdue ?? false;
                const effectiveDates = position?.effectiveDates;
                const isDragging = dragState?.taskId === task.id;
                const displayBar = isDragging && dragPreview
                  ? { ...bar!, start: dragPreview.left, width: dragPreview.width }
                  : bar;

                return (
                  <div
                    key={task.id}
                    className="relative border-b"
                    style={{ height: TASK_ROW_HEIGHT }}
                  >
                    {displayBar && (
                      <>
                        {/* Early completion: show planned end as dashed line */}
                        {bar?.isEarly && bar?.plannedEnd && !isDragging && (
                          <div
                            className="absolute top-2 z-5 h-6 border-r-2 border-dashed"
                            style={{
                              left: bar.start,
                              width: bar.plannedEnd - bar.start,
                              borderColor: listColors[task.listId] || '#6b7280',
                              opacity: 0.4,
                            }}
                          />
                        )}
                        {/* Main bar */}
                        <div
                          className={cn(
                            'group absolute top-2 z-10 flex h-6 items-center rounded text-xs text-white shadow-sm',
                            task.isCompleted
                              ? 'cursor-pointer'
                              : isPredicted
                                ? 'cursor-default'
                                : 'cursor-move',
                            isDragging && 'opacity-80 ring-2 ring-primary ring-offset-1',
                            isPredicted && 'border-2 border-dashed'
                          )}
                          style={{
                            left: displayBar.start,
                            width: Math.max(displayBar.width, 24),
                            backgroundColor: isDeadlineOverdue
                              ? '#dc2626' // 期限オーバーは赤
                              : bar?.isLate
                                ? '#ef4444' // 遅延は赤
                                : task.isCompleted
                                  ? '#22c55e' // 完了は緑
                                  : isPredicted
                                    ? 'transparent' // 予測バーは透明背景
                                    : listColors[task.listId] || '#6b7280',
                            borderColor: isPredicted
                              ? (isDeadlineOverdue ? '#dc2626' : listColors[task.listId] || '#6b7280')
                              : undefined,
                            color: isPredicted
                              ? (isDeadlineOverdue ? '#dc2626' : listColors[task.listId] || '#6b7280')
                              : undefined,
                          }}
                          onClick={() => !isDragging && !justDraggedRef.current && onTaskClick?.(task.id)}
                          onMouseDown={(e) => {
                            if (!task.isCompleted && !isPredicted && bar) {
                              handleDragStart(e, task, 'move', bar.start, bar.width);
                            }
                          }}
                          onTouchStart={(e) => {
                            if (!task.isCompleted && !isPredicted && bar) {
                              handleDragStart(e, task, 'move', bar.start, bar.width);
                            }
                          }}
                        >
                          {/* Left resize handle */}
                          {!task.isCompleted && !isPredicted && (
                            <div
                              className="absolute left-0 top-0 z-20 h-full w-3 cursor-ew-resize opacity-0 group-hover:opacity-100 touch:opacity-50"
                              style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                if (bar) handleDragStart(e, task, 'resize-start', bar.start, bar.width);
                              }}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                if (bar) handleDragStart(e, task, 'resize-start', bar.start, bar.width);
                              }}
                            />
                          )}

                          {/* Bar content */}
                          <div className="flex flex-1 items-center gap-1 overflow-hidden px-2">
                            {task.isCompleted && (
                              <Check className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="truncate">
                              {isPredicted ? (
                                <>
                                  予測: {effectiveDates?.predictedStart ? formatTaskDate(effectiveDates.predictedStart) : '-'} -{' '}
                                  {effectiveDates?.predictedEnd ? formatTaskDate(effectiveDates.predictedEnd) : '-'}
                                </>
                              ) : (
                                <>
                                  {formatTaskDate(task.startDate)} -{' '}
                                  {task.isCompleted && task.completedAt
                                    ? formatTaskDate(task.completedAt)
                                    : formatTaskDate(task.dueDate)}
                                </>
                              )}
                            </span>
                          </div>

                          {/* Right resize handle */}
                          {!task.isCompleted && !isPredicted && (
                            <div
                              className="absolute right-0 top-0 z-20 h-full w-3 cursor-ew-resize opacity-0 group-hover:opacity-100 touch:opacity-50"
                              style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                if (bar) handleDragStart(e, task, 'resize-end', bar.start, bar.width);
                              }}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                if (bar) handleDragStart(e, task, 'resize-end', bar.start, bar.width);
                              }}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {datedMilestones.map(item => {
                const date = item.dueDate!;
                let index = columns.findIndex((column, i) => date >= column.date && (!columns[i + 1] || date < columns[i + 1].date));
                if (index < 0) index = 0;
                return <div key={item.id} className="relative border-b bg-violet-50/30" style={{ height: TASK_ROW_HEIGHT }}>
                  <button type="button" aria-label={`${item.title}の節目 ${formatTaskDate(date)}`} title={`${item.title} · ${formatTaskDate(date)}${item.status === 'achieved' ? ' · 達成' : ''}`} className="absolute top-1.5 z-10 rounded bg-violet-100 px-1.5 py-1 text-sm text-violet-800 hover:bg-violet-200" style={{ left: index * columnWidth }} onClick={() => onMilestoneClick?.(item.id)}>⚑</button>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
