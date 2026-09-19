import type { Task } from '@/types';
import type { ReviewCycle } from './workflow';

/** Requests belong to their parent, keyed by the original comment. No new task document. */
export interface TaskReviewRequest {
  commentId: string; assigneeIds: string[]; dueDate: string | null;
  createdBy: string; createdAt: string; updatedAt: string; cycle: ReviewCycle;
}
export function reviewResult(task: Pick<Task, 'review' | 'assigneeIds'>): 'pending' | 'approved' | 'changes_requested' {
  if (!task.review) return 'pending';
  const people = [...new Set(task.assigneeIds)];
  const responses = people.map(id => task.review!.responses[id]).filter(Boolean);
  if (responses.some(r => r.outcome === 'changes_requested')) return 'changes_requested';
  const approved = responses.filter(r => r.outcome === 'approved').length;
  return approved > 0 && (task.review.policy === 'any' || approved === people.length) ? 'approved' : 'pending';
}
/** Compatibility projection reuses the existing reply planner and search. Never persisted as tasks. */
export function expandTaskReviews<T extends Task>(tasks: readonly T[]): T[] {
  const result = [...tasks]; const ids = new Set(tasks.map(t => t.projectId + '/' + t.id));
  for (const parent of tasks) for (const [id, request] of Object.entries(parent.reviewRequests ?? {})) {
    if (ids.has(parent.projectId + '/' + id)) continue;
    const isCompleted = reviewResult({ review: request.cycle, assigneeIds: request.assigneeIds }) === 'approved';
    result.push({ ...parent, id, reviewRecordId: id, reviewRequests: undefined, review: request.cycle,
      parentTaskId: parent.id, sourceCommentTaskId: parent.id, sourceCommentId: request.commentId, taskKind: 'review_request',
      title: '確認依頼：' + request.cycle.request.split(/\r?\n/)[0].slice(0,100), description: request.cycle.request,
      assigneeIds: request.assigneeIds, dueDate: request.dueDate ? new Date(request.dueDate + 'T00:00:00+09:00') : null,
      createdBy: request.createdBy, createdAt: new Date(request.createdAt), updatedAt: new Date(request.updatedAt),
      isCompleted, completedAt: isCompleted ? new Date(request.updatedAt) : null,
      startDate: null, durationDays: null, labelIds: [], tagIds: [], priority: null, automation: undefined,
      dependsOnTaskIds: [], completionPolicy: undefined, recurrence: null, workState: null, workProgress: undefined,
    });
    ids.add(parent.projectId + '/' + id);
  }
  return result;
}
export function parentReviews(parent: Task, tasks: readonly Task[]) {
  return expandTaskReviews(tasks).filter(t => t.projectId === parent.projectId && t.parentTaskId === parent.id && t.taskKind === 'review_request' && !t.isArchived && !t.isAbandoned);
}
export function requiresReviewResponse(task: Task, uid: string) {
  return !task.isArchived && !task.isAbandoned && !task.isCompleted && reviewResult(task) === 'pending' && task.assigneeIds.includes(uid) && !task.review?.responses[uid];
}
