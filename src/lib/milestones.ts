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
  const linkedTasks = tasks.filter((task) => !task.isArchived && task.projectId === milestone.projectId && (task.milestoneId === milestone.id || milestone.requiredTaskIds?.includes(task.id)));
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

export function milestonePresentation(milestone: Milestone, tasks: readonly Task[], now = new Date()) {
  const progress = calculateMilestoneProgress(milestone, tasks, now);
  if (milestone.status === 'cancelled') return { label: '中止', achieved: false, unknown: false, progress };
  if (milestone.kind === 'date') {
    const days = progress.daysUntilDue;
    return { label: days === null ? '日付未設定' : days === 0 ? '当日' : days < 0 ? '日付経過' : `あと${days}日`, achieved: false, unknown: false, progress };
  }
  const required = milestone.requiredTaskIds ?? [];
  if (milestone.kind === 'achievement' && required.length) {
    const conditions = required.map(id => tasks.find(t => t.projectId === milestone.projectId && t.id === id));
    const unknown = conditions.some(t => !t || t.isArchived);
    const achieved = !!milestone.achievementCondition?.trim() && !unknown && conditions.every(t => t?.isCompleted && !t.isAbandoned);
    return { label: unknown ? '達成条件の一部が未確認' : achieved ? '達成' : '未達成', achieved, unknown, progress };
  }
  return { label: milestone.status === 'achieved' ? '達成' : milestone.kind === 'achievement' ? '未達成' : ({ planned: '予定', in_progress: '進行中' }[milestone.status] ?? '予定'), achieved: milestone.status === 'achieved', unknown: false, progress };
}
