import type { ChecklistItem } from '@/types';

export function sortedChecklistItems(items: readonly ChecklistItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

// Apply a move to the latest items, never to an old copy of their text/check state.
export function moveChecklistItem(items: readonly ChecklistItem[], itemId: string, targetId: string) {
  const sorted = sortedChecklistItems(items);
  const from = sorted.findIndex(item => item.id === itemId);
  const to = sorted.findIndex(item => item.id === targetId);
  if (from < 0 || to < 0 || new Set(sorted.map(item => item.id)).size !== sorted.length) {
    throw new Error('項目が変更されています。タスクを開き直してから並べ替えてください。');
  }
  if (from === to) return sorted;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return sorted.map((item, order) => ({ ...item, order }));
}
