import type { Task, Checklist } from '@/types';
import { continuationContext } from '@/lib/task/continuation';
import { taskVersion, reviewOutcome } from '@/lib/task/workflow';

export function workSupportContext(task: Task, tasks: readonly Task[], uid: string, purpose = '', checklists?: readonly Checklist[]) {
  const context = continuationContext(task, tasks, uid);
  const base = context.parent ?? task;
  const review = context.review ?? context.previousReview;
  const next = tasks.find(t => t.projectId === task.projectId && t.id === review?.review?.nextTaskId);
  const role = context.canResubmit ? '作業担当' : context.canReview || review?.assigneeIds.includes(uid) ? '確認担当' : base.taskKind === 'decision' || base.primaryAssigneeId === uid ? '主担当・判断担当' : base.assigneeIds.includes(uid) ? '作業担当' : '関係者';
  const intent = context.canReview ? '成果物を確認して返答する' : context.canResubmit ? '修正して再提出する' : task.isCompleted ? '引き継ぎの結果を確認する' : task.workState || base.workState ? '再開の条件を確認する' : context.review && !context.review.isCompleted ? '確認担当の返答を待つ' : context.handoffs.length ? '確認済みの仕事を受け取り進める' : base.workProgress === 'started' ? '作業を進めて確認を依頼する' : '依頼を受けて着手する';
  const summarize = (t: Task) => ({ id: t.id, title: t.title, version: taskVersion(t), description: t.description,
    completionCriteria: t.completionCriteria ?? '', dueDate: t.dueDate ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(t.dueDate) : null,
    assigneeIds: t.assigneeIds, primaryAssigneeId: t.primaryAssigneeId ?? null, completed: t.isCompleted, archived: t.isArchived, abandoned: t.isAbandoned,
    progress: t.workProgress ?? 'not_started', waiting: t.workState ?? null });
  const dependencies = [...new Set([...(base.dependsOnTaskIds ?? []), ...(task.dependsOnTaskIds ?? [])])].map(id => {
    const t = tasks.find(t => t.projectId === task.projectId && t.id === id);
    return t ? summarize(t) : { id, unavailable: true };
  });
  return { role, intent, purpose, checklistStatus: checklists ? 'ready' : 'not_requested', checklists: checklists?.map(list => ({ id: list.id, title: list.title, items: list.items.map(item => ({ id: item.id, text: item.text, isChecked: item.isChecked })) })) ?? [], work: summarize(base), selected: summarize(task), review: review ? {
    ...summarize(review), request: review.review?.request ?? review.description,
    outcome: reviewOutcome(review), policy: review.review?.policy ?? 'any', round: review.review?.round ?? 1,
    responses: review.review?.responses ?? {}, previousRound: review.review?.previousRound ?? null,
    correction: review.review?.correctedApproval ?? null,
    files: (review.review?.attachments ?? []).map(f => ({ name: f.name, type: f.type })),
    source: (review.review?.round ?? 1) > 1 ? '提出者の修正メモ' : '依頼者の確認内容',
  } : null, next: next ? summarize(next) : null, dependencies,
    materialScope: '依頼文・登録チェックリスト・確認回の返答・修正メモ・成果物のファイル名。PDF本文や画像、資料の差分は未取得。' };
}
export const workSupportVersion = (task: Task, tasks: readonly Task[], uid: string, purpose = '', checklists?: readonly Checklist[]) => JSON.stringify(workSupportContext(task, tasks, uid, purpose, checklists));
export interface WorkPreparation { text: string; role: string; intent: string; preparedAt: string; mock?: boolean }
