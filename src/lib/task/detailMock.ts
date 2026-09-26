'use client';
import { mutateOrganizationMock, readOrganizationMock, type OrganizationMock } from './organizationMock';
import { validateCommentSubmission, reviewTaskId, type CommentSubmission } from './commentSubmission';
import { moveChecklistItem } from '@/lib/utils/checklist';
import { getTaskSubtasks } from '@/lib/task/subtasks';
import { assertChecklistItemScope, mutateChecklistItems } from '@/lib/utils/checklist-item';
import type { TaskReviewRequest } from './reviews';
import type { Attachment, Checklist, Comment, Task } from '@/types';
export type DetailMockAction = { kind: 'addChecklist'; title: string } | { kind: 'editChecklist'; id: string; data: Partial<Checklist> } | { kind: 'removeChecklist'; id: string }
  | { kind: 'addItem'; id: string; text: string; itemId?: string } | { kind: 'toggleItem'; id: string; itemId: string; isChecked?: boolean } | { kind: 'removeItem'; id: string; itemId: string }
  | ({ kind: 'setItemDeadline'; id: string; itemId: string } & import('@/lib/utils/checklist-item').ChecklistDeadline)
  | { kind: 'setItemDueDate'; id: string; itemId: string; dueDate: string | null }
  | { kind: 'editItemText'; id: string; itemId: string; text: string; expectedText: string }
  | { kind: 'moveItem'; id: string; itemId: string; targetId: string }
  | { kind: 'moveSubtasks'; expectedIds: string[]; orderedIds: string[] }
  | { kind: 'addComment'; content: string; authorId: string; authorLabel?: string; mentions: string[] }
  | { kind: 'editComment'; id: string; content: string } | { kind: 'removeComment'; id: string };
function extract(state: OrganizationMock, taskId: string) {
  const prefix = `tasks/${taskId}/`;
  const children = <T>(kind: string) => Object.entries(state.data.children).filter(([path]) => path.startsWith(`${prefix}${kind}/`)).map(([path, value]) => ({ ...value, id: path.split('/').at(-1)!, taskId })) as T[];
  return { task: state.data.tasks[taskId] ? { ...state.data.tasks[taskId], id: taskId } as unknown as Task : null,
    checklists: children<Checklist>('checklists'), comments: children<Comment>('comments').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), attachments: children<Attachment>('attachments') };
}
export const readTaskDetailsMock = (projectId: string, taskId: string) => extract(readOrganizationMock(projectId), taskId);
export async function actTaskDetailsMock(projectId: string, taskId: string, action: DetailMockAction) {
  return mutateOrganizationMock(projectId, state => {
    if (!state.data.tasks[taskId]) throw new Error('隔離データにこのタスクがありません。');
    const children = state.data.children; const now = new Date();
    const checklistPath = 'id' in action ? `tasks/${taskId}/checklists/${action.id}` : '';
    const commentPath = 'id' in action ? `tasks/${taskId}/comments/${action.id}` : '';
    const checklist = children[checklistPath] as unknown as Checklist | undefined;
    if (action.kind === 'addChecklist') {
      children[`tasks/${taskId}/checklists/${crypto.randomUUID()}`] = { title: action.title, order: extract(state, taskId).checklists.length, items: [], createdAt: now };
    } else if (action.kind === 'editChecklist') {
      if (!checklist) throw new Error('チェックリストが見つかりません。');
      children[checklistPath] = { ...checklist, ...action.data };
    } else if (action.kind === 'removeChecklist') delete children[checklistPath];
    else if (['addItem', 'toggleItem', 'removeItem', 'moveItem', 'setItemDueDate', 'setItemDeadline', 'editItemText'].includes(action.kind)) {
      if (!checklist) throw new Error('チェックリストが見つかりません。');
      if (!('id' in action)) throw new Error('チェックリストを確認してください。');
      assertChecklistItemScope(projectId, taskId, action.id);
      const parent = state.data.tasks[taskId];
      if (parent.isArchived || parent.projectId !== undefined && parent.projectId !== projectId
        || checklist.taskId !== undefined && checklist.taskId !== taskId) throw new Error('タスクを開き直してください。');
      let items = checklist.items;
      if (!Array.isArray(items)) throw new Error('チェックリストを読み込めませんでした。');
      if (action.kind === 'editItemText') items = mutateChecklistItems(items, { kind: 'text', itemId: action.itemId, text: action.text, expectedText: action.expectedText });
      if (action.kind === 'addItem') items = mutateChecklistItems(items, { kind: 'add', item: { id: action.itemId ?? crypto.randomUUID(), text: action.text } });
      if (action.kind === 'toggleItem') items = mutateChecklistItems(items, { kind: 'toggle', itemId: action.itemId, isChecked: action.isChecked ?? !items.find(item => item.id === action.itemId)?.isChecked });
      if (action.kind === 'removeItem') items = mutateChecklistItems(items, { kind: 'remove', itemId: action.itemId });
      if (action.kind === 'setItemDeadline') {
        items = mutateChecklistItems(items, { ...action, kind: 'deadline' });
        if (action.deadlinePolicy === 'strict') parent.hasChecklistDeadlines = true;
      }
      if (action.kind === 'setItemDueDate') items = mutateChecklistItems(items, { kind: 'dueDate', itemId: action.itemId, dueDate: action.dueDate });
      if (action.kind === 'moveItem') {
        items = moveChecklistItem(items, action.itemId, action.targetId);
      }
      children[checklistPath] = { ...checklist, items };
    } else if (action.kind === 'addComment') children[`tasks/${taskId}/comments/${crypto.randomUUID()}`] = { content: action.content, authorId: action.authorId, authorLabel: action.authorLabel ?? '', mentions: action.mentions, createdAt: now, updatedAt: now };
    else if (action.kind === 'editComment') {
      if (!children[commentPath]) throw new Error('コメントが見つかりません。');
      children[commentPath] = { ...children[commentPath], content: action.content, updatedAt: now };
    } else if (action.kind === 'removeComment') delete children[commentPath];
    else if (action.kind === 'moveSubtasks') {
      const parent = state.data.tasks[taskId] as unknown as Task;
      const tasks = Object.entries(state.data.tasks).map(([id, data]) => ({ ...data, id }) as unknown as Task);
      const currentIds = getTaskSubtasks({ ...parent, id: taskId }, tasks).map(item => item.id);
      if (currentIds.length !== action.expectedIds.length || currentIds.some((id, index) => id !== action.expectedIds[index])) throw new Error('サブタスクが変更されています。タスクを開き直してから並べ替えてください。');
      if (action.orderedIds.length !== currentIds.length || new Set(action.orderedIds).size !== currentIds.length || currentIds.some(id => !action.orderedIds.includes(id))) throw new Error('サブタスクの順序を確認できません。');
      parent.subtaskOrderIds = [...action.orderedIds, ...(parent.subtaskOrderIds ?? []).filter(id => !currentIds.includes(id))];
    }
    return extract(state, taskId);
  });
}
export async function submitTaskCommentMock(input: CommentSubmission) {
  return mutateOrganizationMock(input.projectId, state => submitTaskCommentToMockState(state, input));
}
export function submitTaskCommentToMockState(state: OrganizationMock, input: CommentSubmission) {
  const recipients = validateCommentSubmission(input);
  if (input.attachments.length) throw new Error('隔離環境ではファイルを共有しません。');
    const receipt = state.activityLogs.find(log => log.id === `comment-${input.id}`);
    if (receipt) {
      if (receipt.userId !== input.authorId || receipt.sourceTaskId !== input.taskId) throw new Error('投稿の記録が一致しません。');
      return { commentId: input.id, reviewTaskId: receipt.reviewTaskId as string | null, alreadySubmitted: true };
    }
    const parent = state.data.tasks[input.taskId];
    if (input.expectedTaskVersion !== undefined && (!(parent?.updatedAt instanceof Date) || parent.updatedAt.toISOString() !== input.expectedTaskVersion)) throw Object.assign(new Error('仕事の情報が変わりました。確認内容を見直してください。'), { code: 'submission-rejected' });
    if (!parent || parent.parentTaskId || parent.isArchived || input.review && (parent.isCompleted || parent.isAbandoned)) throw new Error('投稿先のタスクを確認できません。');
    if (recipients.some(id => !state.data.memberIds.includes(id))) throw new Error('プロジェクト外の通知先が含まれています。');
    if (input.review?.nextTaskId) { const next = state.data.tasks[input.review.nextTaskId]; if (!next || next.isArchived || next.isAbandoned || next.isCompleted) throw new Error('確認後の仕事を選び直してください。'); }
    const now = new Date(); const childId = input.review ? reviewTaskId(input.id) : null;
    state.data.children[`tasks/${input.taskId}/comments/${input.id}`] = { taskId: input.taskId, content: input.content.trim() || `確認依頼：${input.review?.content ?? ''}`,
      authorId: input.authorId, authorLabel: input.authorName, purpose: input.purpose ?? 'memo', mentions: recipients, attachments: [], createdAt: now, updatedAt: now, ...(childId ? { reviewTaskId: childId } : {}) };
    if (input.review && childId) {
      const request: TaskReviewRequest = { commentId: input.id, assigneeIds: input.review.assigneeIds, dueDate: input.review.dueDate, createdBy: input.authorId, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        cycle: { ...(input.review.urgency ? { urgency: input.review.urgency } : {}), policy: input.review.policy ?? 'any', round: 1, request: input.review.content.trim(), attachments: [], requestedAt: now.toISOString(), responses: {}, nextTaskId: input.review.nextTaskId ?? null } };
      parent.reviewRequests = { ...(parent.reviewRequests as Record<string, TaskReviewRequest> ?? {}), [childId]: request }; parent.updatedAt = now;
    }
    state.activityLogs.push({ id: `comment-${input.id}`, targetType: 'task', targetId: childId ?? input.taskId, action: childId ? 'create' : 'update',
      userId: input.authorId, userName: input.authorName, sourceTaskId: input.taskId, reviewTaskId: childId, createdAt: now,
      changes: [{ field: 'comment', newValue: childId ? 'コメントと確認依頼を登録' : 'コメントを投稿' }] });
    return { commentId: input.id, reviewTaskId: childId, alreadySubmitted: false };
}
