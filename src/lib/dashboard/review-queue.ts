import { addDays, differenceInCalendarDays, isSameDay, isValid, startOfDay } from 'date-fns';
import type { DashboardTask } from './brief';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';

export type ReviewAttentionLevel = 'now' | 'soon' | 'normal';
export type ReviewAttentionIcon = 'deadline' | 'blocked' | 'suggestion';

export interface ReviewAttention {
  level: ReviewAttentionLevel;
  icon: ReviewAttentionIcon;
  label: string;
  reason: string;
}

const levelOrder: Record<ReviewAttentionLevel, number> = { now: 0, soon: 1, normal: 2 };
function validDate(value: unknown): Date | null {
  if (value instanceof Date && isValid(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    const date = new Date(value);
    return isValid(date) ? date : null;
  }
  return null;
}

export function reviewTaskAttention(task: Pick<DashboardTask, 'dueDate' | 'review'>, now = new Date()): ReviewAttention {
  const due = validDate(task.dueDate);
  if (due) {
    const days = differenceInCalendarDays(startOfDay(due), startOfDay(now));
    if (days <= 0) return { level: 'now', icon: 'deadline', label: '今、確認が必要', reason: days < 0 ? '回答期限を過ぎています' : '今日が回答期限' };
    if (days <= 3) return { level: 'soon', icon: 'deadline', label: '近いうちに確認', reason: `${days}日後が回答期限` };
  }
  if (task.review?.nextTaskId) return { level: 'soon', icon: 'blocked', label: '近いうちに確認', reason: 'この判断で後続作業へ進みます' };
  return { level: 'normal', icon: 'suggestion', label: '通常の確認候補', reason: '都合のよいときに確認' };
}

function changedField(record: OrganizationPreview, name: string) {
  return record.changes.flatMap(change => change.fields ?? []).find(field => field.field === name && field.after != null && field.after !== '');
}

export function organizationAttention(record: OrganizationPreview, now = new Date()): ReviewAttention {
  const due = validDate(changedField(record, 'dueDate')?.after);
  if (due) {
    const days = differenceInCalendarDays(startOfDay(due), startOfDay(now));
    if (days <= 0) return { level: 'now', icon: 'deadline', label: '今、確認が必要', reason: days < 0 ? '変更後の期限を過ぎています' : '今日が回答期限' };
    if (days <= 3) return { level: 'soon', icon: 'deadline', label: '近いうちに確認', reason: `${days}日後が回答期限` };
  }
  if (record.changes.some(change => change.fields?.some(field => field.field === 'dependsOnTaskIds'))) {
    return { level: 'soon', icon: 'blocked', label: '近いうちに確認', reason: 'この判断が後続作業の前提になります' };
  }
  return { level: 'normal', icon: 'suggestion', label: '通常の提案', reason: '都合のよいときに確認' };
}

function stableNumber(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed ^ (seed >>> 16), 2246822519) + 3266489917) >>> 0;
    const target = seed % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/**
 * Keep equally urgent work varied within a browsing round. The cursor is
 * private session UI state; it never changes a task, deadline, or progress.
 */
export function orderReviewItems<T>(items: readonly T[], scope: string, getKey: (item: T) => string, getAttention: (item: T) => ReviewAttention): T[] {
  if (items.length < 2) return [...items];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const attention = getAttention(item);
    const bucket = `${attention.level}:${attention.reason}`;
    groups.set(bucket, [...(groups.get(bucket) ?? []), item]);
  }
  let cursor = 0;
  try {
    const storageKey = `taskflow-review-round:${scope}`;
    cursor = Number.parseInt(sessionStorage.getItem(storageKey) ?? '0', 10) || 0;
    sessionStorage.setItem(storageKey, String(cursor + 1));
  } catch {
    cursor = stableNumber(scope);
  }
  const ordered: T[] = [];
  [...groups.entries()].sort(([a], [b]) => levelOrder[a.split(':')[0] as ReviewAttentionLevel] - levelOrder[b.split(':')[0] as ReviewAttentionLevel] || a.localeCompare(b)).forEach(([bucket, group], index) => {
    ordered.push(...shuffle(group, stableNumber(`${scope}:${bucket}:${cursor + index}`)));
  });
  const result = ordered.sort((a, b) => levelOrder[getAttention(a).level] - levelOrder[getAttention(b).level]
    || stableNumber(`${scope}:${getKey(a)}:${cursor}`) - stableNumber(`${scope}:${getKey(b)}:${cursor}`));
  return result;
}

export function reviewPosition<T>(items: readonly T[], selectedKey: string | null, getKey: (item: T) => string): number {
  if (!items.length) return 0;
  const index = selectedKey ? items.findIndex(item => getKey(item) === selectedKey) : -1;
  return index >= 0 ? index : 0;
}

export function sameReviewTime(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return !!a && !!b && isSameDay(a, b);
}

export function soonReviewDate(now = new Date()) {
  return addDays(startOfDay(now), 3);
}
