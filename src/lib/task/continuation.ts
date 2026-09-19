import type { CommentAttachment, Task } from '@/types';
import { reviewOutcome } from './workflow';

const available = (task: Task) => !task.isArchived && !task.isAbandoned;
const newest = (a: Task, b: Task) => b.updatedAt.getTime() - a.updatedAt.getTime();
export function reviewCanResubmit(review: Task, tasks: readonly Task[], userId: string) {
  const parent = tasks.find(task => task.projectId === review.projectId && task.id === review.parentTaskId);
  return Boolean(parent && available(parent) && !parent.isCompleted && reviewOutcome(review) === 'changes_requested'
    && (parent.assigneeIds.includes(userId) || review.createdBy === userId));
}
export function continuationTasks<T extends Task>(tasks: readonly T[], userId: string): T[] {
  return tasks.filter(task => available(task) && !task.isCompleted && (task.assigneeIds.includes(userId)
    || task.taskKind === 'review_request' && reviewCanResubmit(task, tasks, userId)))
    .sort((a, b) => {
      const priority = (task: Task) => task.taskKind === 'review_request' ? reviewCanResubmit(task, tasks, userId) ? 0 : 1 : task.workProgress === 'started' ? 2 : 3;
      return priority(a) - priority(b) || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id);
    });
}
export function continuationContext(task: Task, tasks: readonly Task[], userId: string) {
  const projectTasks = tasks.filter(item => item.projectId === task.projectId);
  const reviews = projectTasks.filter(item => available(item) && item.taskKind === 'review_request' && item.parentTaskId === task.id).sort(newest);
  const review = task.taskKind === 'review_request' ? task : reviews.find(item => !item.isCompleted) ?? null;
  const parent = review ? projectTasks.find(item => item.id === review.parentTaskId) : task;
  const canReview = Boolean(review && parent && available(parent) && !parent.isCompleted && !review.isCompleted
    && reviewOutcome(review) === 'pending' && review.assigneeIds.includes(userId) && !review.review?.responses[userId]);
  const canResubmit = Boolean(review && reviewCanResubmit(review, projectTasks, userId));
  const handoffs = projectTasks.filter(item => available(item) && item.taskKind === 'review_request'
    && item.review?.nextTaskId === task.id && item.isCompleted && reviewOutcome(item) === 'approved').sort(newest);
  return { review, parent, canReview, canResubmit, handoffs, previousReview: reviews[0] ?? null };
}
export function safeMaterialUrl(value: string) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
export function uniqueMaterials(files: readonly CommentAttachment[]) {
  return [...new Map(files.filter(file => safeMaterialUrl(file.url)).map(file => [file.url, file])).values()];
}
