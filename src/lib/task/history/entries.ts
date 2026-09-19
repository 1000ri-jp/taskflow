import type { HistoryEntry } from './types';
const text = (value: unknown, max = 1200) => typeof value === 'string' ? value.slice(0, max) : '';
export function historyDate(value: unknown): string | null {
  const date = typeof value === 'string' ? new Date(value) : value instanceof Date ? value : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const actionLabels: Record<string, string> = { create: 'タスクを作成', update: '内容を更新', delete: '削除', move: 'リストを移動', complete: '完了', reopen: '再開', assign: '担当を追加', unassign: '担当を解除' };
export function activityEntry(id: string, data: Record<string, unknown>): HistoryEntry {
  const source = data.source && typeof data.source === 'object' ? data.source as Record<string, unknown> : undefined;
  const meeting = source?.kind === 'meeting';
  const organization = data.organization && typeof data.organization === 'object' ? data.organization as Record<string, unknown> : undefined;
  const operationId = text(organization?.operationId, 200);
  const sourceRef = meeting && /^[a-z0-9-]{1,200}$/i.test(operationId) ? { operationId, ownerId: text(data.userId, 200) } : undefined;
  const recordedAt = historyDate(data.createdAt);
  return { id: `activity:${id}`, kind: meeting ? 'meeting' : 'activity', title: meeting ? text(source.title, 300) || '会議の決定を反映' : actionLabels[text(data.action)] || 'タスクの変更',
    text: meeting ? text(source.excerpt, 3000) : text(data.summary), actor: text(data.userName, 120) || '操作者不明',
    at: meeting ? historyDate(source.occurredAt) : recordedAt, recordedAt: meeting ? recordedAt : undefined,
    url: meeting ? text(source.url, 1500) || undefined : undefined, private: false, ...(sourceRef ? { sourceRef } : {}),
    changes: Array.isArray(data.changes) ? data.changes.slice(0, 30).map(raw => {
      const change = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return { field: text(change.field, 80), before: text(change.oldValue), after: text(change.newValue) };
    }) : [] };
}
