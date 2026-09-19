import { format } from 'date-fns';
import type { ActivityChange } from '@/types';
import type { HistoryEntry } from './types';
import { activityEntry } from './entries';
import { changeLabel } from './presentation';

const labels: Record<string, string> = { taskKind: '仕事の種類', labelIds: 'ラベル', tagIds: 'タグ', listId: 'リスト', workProgress: '作業状態', priority: '優先度', isArchived: 'アーカイブ', isAbandoned: '中止', durationDays: '必要日数', isDueDateFixed: '期限の固定', order: '表示順', workState: '待ち・保留', recurrence: '繰り返し', completedAt: '完了日', review: '確認依頼', reviewRequests: '確認依頼' };
export function serializeChange(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return serializeChange(value.toDate());
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function taskEditChanges(before: Record<string, unknown>, patch: Record<string, unknown>): ActivityChange[] {
  return Object.entries(patch).filter(([field, value]) => value !== undefined && !['updatedAt', 'id', 'projectId', 'createdAt'].includes(field))
    .flatMap(([field, value]) => {
      const oldValue = serializeChange(before[field]), newValue = serializeChange(value);
      return oldValue === newValue ? [] : [{ field, oldValue, newValue }];
    });
}
const shortened = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 180) + (value.length > 180 ? '…' : '');
function valueText(field: string, value: string) {
  if (!value) return 'なし';
  if (['dueDate', 'startDate', 'completedAt', '期限', '開始日'].includes(field) && Number.isFinite(Date.parse(value))) return format(new Date(value), 'yyyy/M/d');
  if (field === 'workProgress') return value === 'started' ? '着手' : value === 'not_started' ? '未着手' : value;
  if (field === 'isCompleted') return value === 'true' ? '完了' : '未完了';
  if (field === 'priority') return ({ high: '高', medium: '中', low: '低' }[value] ?? value);
  if (['isArchived', 'isAbandoned', 'isDueDateFixed'].includes(field)) return value === 'true' ? 'あり' : 'なし';
  return shortened(value);
}
export function recentChangeText(entry: HistoryEntry): string {
  const parts = (entry.changes ?? []).map(({ field, before, after }) => {
    const label = labels[field] ?? changeLabel(field);
    if (['organization', 'workEvent', 'comment'].includes(field)) return shortened(after);
    if (field === 'description' || field === '説明') return after ? `説明を更新：${shortened(after)}` : '説明を削除';
    // IDs describe relationships, not useful display names. Never present them as names.
    if (['labelIds', 'tagIds', 'assigneeIds', 'dependsOnTaskIds', 'relatedTaskIds'].includes(field)) {
      try {
        const oldIds = before ? JSON.parse(before) : [], newIds = after ? JSON.parse(after) : [];
        if (Array.isArray(oldIds) && Array.isArray(newIds)) {
          const added = newIds.filter(id => !oldIds.includes(id)), removed = oldIds.filter(id => !newIds.includes(id));
          return `${label}を変更${added.length ? `・${field === 'labelIds' && added.length === 1 && added[0] === 'ai-moai' ? 'モアイを追加' : `${added.length}件追加`}` : ''}${removed.length ? `・${removed.length}件解除` : ''}`;
        }
      } catch { /* legacy values are not IDs we can safely resolve */ }
      return `${label}を変更`;
    }
    if (['parentTaskId', 'listId', 'milestoneId', 'primaryAssigneeId', 'automation', 'completionPolicy', 'workState', 'recurrence', 'review', 'reviewRequests'].includes(field)) return `${label}を変更`;
    if (field === 'status') {
      try { const state = JSON.parse(after); return state.isCompleted === true ? '完了に変更' : state.isAbandoned === true ? '中止に変更' : '状態を変更'; } catch { return `状態：${valueText(field, before)} → ${valueText(field, after)}`; }
    }
    return `${label}：${valueText(field, before)} → ${valueText(field, after)}`;
  }).filter(Boolean);
  return parts.join(' ／ ') || (entry.title === '内容を更新' ? '変更項目は記録されていません' : entry.title);
}

/** Use the saved edit snapshot, never the current task, to explain older edits. */
export function recentActivityEntry(id: string, data: Record<string, unknown>): HistoryEntry {
  const entry = activityEntry(id, data);
  if (!['edit_subtask', 'configure'].includes(String(data.workflowAction))
    || !data.before || typeof data.before !== 'object' || !data.after || typeof data.after !== 'object') return entry;
  const changes = taskEditChanges(data.before as Record<string, unknown>, data.after as Record<string, unknown>)
    .map(change => ({field: change.field, before: change.oldValue ?? '', after: change.newValue ?? ''}));
  const details = changes.length ? recentChangeText({...entry, changes}) : '内容の変更なし（再保存）';
  const receipt = data.receipt && typeof data.receipt === 'object' ? data.receipt as Record<string, unknown> : null;
  const child = receipt && receipt.taskId !== data.targetId && typeof receipt.taskTitle === 'string' ? `「${receipt.taskTitle}」：` : '';
  return {...entry, changes:[{field:'workEvent',before:'',after:child + details}]};
}
