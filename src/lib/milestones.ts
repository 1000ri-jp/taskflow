import { differenceInCalendarDays, startOfDay } from 'date-fns';
import type { Milestone, Task } from '@/types';

export type MilestoneDueState = 'unset' | 'overdue' | 'due_soon' | 'on_track';

export interface MilestoneProgress {
  milestoneId: string;
  linkedTaskCount: number;
  completedTaskCount: number;
  progressPercent: number;
  isConfigured: boolean;
  dueState: MilestoneDueState;
  daysUntilDue: number | null;
}

export function calculateMilestoneProgress(milestone: Milestone, tasks: readonly Task[], now: Date = new Date()): MilestoneProgress {
  const linkedTasks = tasks.filter((task) => !task.isArchived && task.milestoneId === milestone.id);
  const completedTaskCount = linkedTasks.filter((task) => task.isCompleted).length;
  const daysUntilDue = milestone.dueDate ? differenceInCalendarDays(startOfDay(milestone.dueDate), startOfDay(now)) : null;
  const dueState: MilestoneDueState = daysUntilDue === null ? 'unset' : daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'on_track';
  return {
    milestoneId: milestone.id,
    linkedTaskCount: linkedTasks.length,
    completedTaskCount,
    progressPercent: linkedTasks.length ? Math.round((completedTaskCount / linkedTasks.length) * 100) : 0,
    isConfigured: linkedTasks.length > 0,
    dueState,
    daysUntilDue,
  };
}

export function calculateMilestoneProgressList(milestones: readonly Milestone[], tasks: readonly Task[], now: Date = new Date()): MilestoneProgress[] {
  return milestones.map((milestone) => calculateMilestoneProgress(milestone, tasks, now));
}
