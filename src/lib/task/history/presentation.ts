import { expandTaskReviews } from '../reviews';
import { reviewOutcome } from '../workflow';
import type { Checklist, Comment, Task } from '@/types';
import type { HistoryEntry } from './types';

const namesFor = (ids: string[], names: Record<string, string>) => ids.length ? ids.map(id => names[id] || '担当者名は未取得').join('・') : '担当未設定';
export function taskSituation(task: Task, tasks: Task[], names: Record<string, string>, checklists: Checklist[]) {
  tasks = expandTaskReviews(tasks).filter(t => t.projectId === task.projectId);
  const dependencies = task.dependsOnTaskIds.map(id => tasks.find(t => t.id === id));
  const missing = dependencies.some(t => !t || t.isArchived);
  const blocked = dependencies.filter((t): t is Task => !!t && !t.isCompleted);
  const children = tasks.filter(t => t.parentTaskId === task.id && !t.isArchived);
  const subtasks = children.filter(t => t.taskKind !== 'review_request');
  const pending = subtasks.filter(t => !t.isCompleted && !t.isAbandoned);
  const reviews = children.filter(t => t.taskKind === 'review_request' && !t.isCompleted && !t.isAbandoned);
  let situation = task.workProgress === 'started' ? '着手' : task.taskKind === 'decision' ? '判断待ち' : '未着手';
  const assigned = (assigneeIds: string[], text: string) => ({ assigneeIds, text });
  const plain = (text: string) => ({ assigneeIds: null, text });
  let nextSteps: { assigneeIds: string[] | null; text: string }[] = [assigned(task.assigneeIds, task.taskKind === 'review_request' ? '内容を確認して返答' : task.title)];
  if (task.isArchived) { situation = 'アーカイブ済み'; nextSteps = [plain('予定された次の作業なし')]; }
  else if (task.isAbandoned) { situation = '中止'; nextSteps = [plain('予定された次の作業なし')]; }
  else if (task.isCompleted) {
    situation = task.taskKind === 'review_request' && task.review ? '確認OK' : '完了';
    const follow = task.review?.nextTaskId ? tasks.find(t => t.id === task.review?.nextTaskId) : null;
    nextSteps = [task.review?.nextTaskId ? follow ? assigned(follow.assigneeIds, `${follow.title}${follow.isCompleted ? '（完了）' : ''}`) : plain('確認後の仕事の情報は未取得') : plain('このタスクの次の作業なし')];
  }
  else if (task.taskKind === 'review_request' && reviewOutcome(task) === 'changes_requested') {
    situation = '修正待ち'; const parent = tasks.find(t => t.id === task.parentTaskId);
    nextSteps = [parent ? assigned(parent.assigneeIds, '修正して再確認を依頼') : plain('確認対象の仕事は未取得')];
  }
  else if (task.taskKind === 'review_request') {
    situation = '確認待ち'; nextSteps = [assigned(task.assigneeIds.filter(id => !task.review?.responses[id]), '内容を確認して返答')];
  }
  else if (task.workState) {
    situation = task.workState.status === 'hold' ? '保留' : '待ち';
    nextSteps = [plain(task.workState.resumeCondition || '再開する条件を確認')];
  }
  else if (missing) { situation = '前提タスクの一部を確認できません'; nextSteps = [plain('前提の状態を確認後、次の担当を判断')]; }
  else if (blocked.length) {
    situation = `前提の完了待ち（${blocked.length}件）`;
    nextSteps = blocked.map(t => assigned(t.assigneeIds, `${t.title}${t.isAbandoned ? '（中止。前提の見直しが必要）' : ''}`));
  } else if (reviews.length) {
    const fixes = reviews.filter(t => reviewOutcome(t) === 'changes_requested');
    situation = fixes.length ? `修正が必要（${fixes.length}件）` : `返答・確認待ち（${reviews.length}件）`;
    nextSteps = fixes.length ? [assigned(task.assigneeIds, '修正して再確認を依頼')] : reviews.map(t => assigned(t.assigneeIds.filter(id => !t.review?.responses[id]), t.title));
  } else if (!pending.length && children.some(t => t.taskKind === 'review_request' && t.review && t.isCompleted && !t.isAbandoned)) {
    const approved = children.filter(t => t.taskKind === 'review_request' && t.review && t.isCompleted && !t.isAbandoned);
    situation = '確認OK';
    const follows = approved.flatMap(r => r.review?.nextTaskId ? [tasks.find(t => t.id === r.review?.nextTaskId)] : []);
    nextSteps = follows.length ? follows.map(t => t ? assigned(t.assigneeIds, `${t.title}${t.isCompleted ? '（完了）' : ''}`) : plain('確認後の仕事は未取得')) : [assigned(task.assigneeIds, '完了条件を確認して仕上げる')];
  } else if (pending.length) {
    situation = `サブタスク ${subtasks.filter(t => t.isCompleted).length}/${subtasks.length}件完了`;
    nextSteps = pending.slice(0, 3).map(t => assigned(t.assigneeIds, t.title));
    if (pending.length > 3) nextSteps[nextSteps.length - 1].text += ` ほか${pending.length - 3}件`;
  }
  const next = nextSteps.map(step => step.assigneeIds === null ? step.text : `${namesFor(step.assigneeIds, names)}：${step.text}`).join('／');
  const items = checklists.flatMap(c => c.items);
  return { situation, next, nextSteps, checklist: items.length ? `手順 ${items.filter(i => i.isChecked).length}/${items.length}件完了` : null };
}
export function commentHistoryEntries(comments: Comment[], names: Record<string, string>): HistoryEntry[] {
  return comments.map(c => ({ id: `comment:${c.id}`, kind: 'comment', title: c.purpose === 'review_request' ? '確認を依頼' : 'コメント', text: c.content,
    actor: c.authorLabel || names[c.authorId] || '投稿者名は未取得', at: Number.isFinite(c.createdAt?.getTime()) ? c.createdAt.toISOString() : null,
    recordedAt: c.updatedAt?.getTime() !== c.createdAt?.getTime() && Number.isFinite(c.updatedAt?.getTime()) ? c.updatedAt.toISOString() : undefined,
    url: `#task-comment-${c.id}`, private: false }));
}
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return [...new Map(entries.map(e => [e.id, e])).values()].sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0) || a.id.localeCompare(b.id));
}
export function safeHistoryUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^#task-comment-[^\s]+$/.test(url)) return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null; }
  catch { return null; }
}
export const changeLabel = (field: string) => ({ title: 'タイトル', description: '説明', listId: '分類', assigneeIds: '担当', dueDate: '期限', startDate: '開始日', status: '状態', isCompleted: '完了', parentTaskId: '親タスク', dependsOnTaskIds: '前提', relatedTaskIds: '関連', automation: '自動確認', completionPolicy: '完了条件', workEvent: '仕事の記録', completionCriteria: '完了条件', primaryAssigneeId: '主担当', milestoneId: '節目', comment: 'コメント', purchaseReport: '購入報告', organization: '整理内容', taskKind: '仕事の種類', labelIds: 'ラベル', tagIds: 'タグ', workProgress: '作業状態', priority: '優先度', isArchived: 'アーカイブ', isAbandoned: '中止', durationDays: '必要日数', isDueDateFixed: '期限の固定', order: '表示順', workState: '待ち・保留', recurrence: '繰り返し', completedAt: '完了日', review: '確認依頼', reviewRequests: '確認依頼' }[field] || (/[ぁ-んァ-ヶ一-龯]/.test(field) ? field : '変更内容'));
export function changeValue(field: string, value: string): string {
  if (!value) return '設定なし';
  if (field === 'isCompleted') return value === 'true' ? '完了' : value === 'false' ? '未完了' : value;
  if (field === 'status') {
    try { const s = JSON.parse(value); if (s.isAbandoned === true) return '中止'; if (typeof s.isCompleted === 'boolean') return s.isCompleted ? '完了' : '未完了'; } catch { /* already a human-readable outcome */ }
  }
  return value;
}
