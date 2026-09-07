import { differenceInCalendarDays, endOfMonth, format, isSameMonth, isValid, startOfDay } from 'date-fns';
import type { DashboardTask } from './brief';

export const MONTHLY_TARGET_LIMIT = 3;
export interface TargetRecommendation {
  task: DashboardTask;
  reason: string;
  isBlocked: boolean;
}
const validDate = (date: Date | null) => date && isValid(date) ? date : null;

// Local, deterministic prioritization only. This does not call an AI provider or write tasks.
export function recommendMonthlyTargets(tasks: DashboardTask[], projectId: string, now = new Date()): TargetRecommendation[] {
  const today = startOfDay(now);
  const monthEnd = endOfMonth(today);
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const taskMap = new Map(projectTasks.map((task) => [task.id, task]));
  const active = projectTasks.filter((task) => !task.isCompleted && !task.isArchived && !task.isAbandoned);
  const candidates = active.filter((task) => {
    const start = validDate(task.startDate);
    return !start || start <= monthEnd;
  });
  return candidates.map((task) => {
    const due = validDate(task.dueDate);
    const start = validDate(task.startDate);
    const days = due ? differenceInCalendarDays(due, today) : null;
    const isBlocked = (task.dependsOnTaskIds ?? []).some((id) => {
      const dependency = taskMap.get(id);
      return !dependency || !dependency.isCompleted || dependency.isAbandoned;
    });
    const dependents = active.filter((other) => other.id !== task.id && other.dependsOnTaskIds?.includes(task.id)).length;
    const reasons: string[] = [];
    let score = 0;
    if (days === 0) { score += 600; reasons.push('本日期限'); }
    else if (days !== null && days < 0) { score += 450 + Math.max(0, 30 + days); reasons.push(`期限を${-days}日超過`); }
    else if (days !== null && days <= 7) { score += 500 - days; reasons.push(`${days}日後が期限`); }
    else if (due && isSameMonth(due, today)) { score += 350 + Math.max(0, 31 - days!); reasons.push('今月が期限'); }
    else if (due) { score += 50; reasons.push(`${format(due, 'M/d')}が期限`); }
    if (task.priority === 'high') { score += 100; reasons.push('優先度が高い'); }
    else if (task.priority === 'medium') { score += 40; reasons.push('優先度は中'); }
    else if (task.priority === 'low') score += 10;
    if (dependents > 0) { score += Math.min(dependents, 3) * 20; reasons.push(`${dependents}件の前提タスク`); }
    if (start && startOfDay(start) <= today) { score += 35; reasons.push('開始日を迎えています'); }
    else if (start) { score -= 50; reasons.push(`${format(start, 'M/d')}開始予定`); }
    // Prefer actionable work; keep an explicit warning if only blocked candidates remain.
    if (isBlocked) { score -= 1000; reasons.unshift('前提タスクの完了待ち'); }
    if (reasons.length === 0) reasons.push('未完了タスクから候補を抽出');
    return { task, reason: reasons.slice(0, 2).join('・'), isBlocked, score, dueOrder: due?.getTime() ?? Infinity };
  }).sort((a, b) => b.score - a.score || a.dueOrder - b.dueOrder || a.task.id.localeCompare(b.task.id))
    .slice(0, MONTHLY_TARGET_LIMIT)
    .map(({ task, reason, isBlocked }) => ({ task, reason, isBlocked }));
}
