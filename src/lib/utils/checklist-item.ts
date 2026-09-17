import type { ChecklistItem } from '@/types';

export type ChecklistItemMutation =
  | { kind: 'dueDate'; itemId: string; dueDate: string | null }
  | { kind: 'text'; itemId: string; text: string; expectedText: string }
  | { kind: 'add'; item: { id: string; text: string } }
  | { kind: 'toggle'; itemId: string; isChecked: boolean }
  | { kind: 'remove'; itemId: string };

export function assertChecklistItemScope(projectId: string, taskId: string, checklistId: string): void {
  for (const value of [projectId, taskId, checklistId]) {
    if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..'
      || value.includes('/') || Array.from(value).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159))) {
      throw new Error('チェックリストの指定が正しくありません。');
    }
  }
}

export function validateChecklistItemDueDate(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('期限は実在する日付を YYYY-MM-DD 形式で指定してください。');
  }
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new Error('期限は実在する日付を YYYY-MM-DD 形式で指定してください。');
  }
}

function validItemId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Apply one captured user intent to the latest items, preserving all other fields. */
export function mutateChecklistItems(items: readonly ChecklistItem[], action: ChecklistItemMutation): ChecklistItem[] {
  if (!Array.isArray(items) || items.some(item => !item || !validItemId(item.id))
    || new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error('チェック項目を読み込めません。タスクを開き直してください。');
  }
  if (action.kind === 'add') {
    if (!action.item || !validItemId(action.item.id) || typeof action.item.text !== 'string' || !action.item.text.trim()) {
      throw new Error('チェック項目の指定が正しくありません。');
    }
    const existing = items.find(item => item.id === action.item.id);
    if (existing) {
      if (existing.text !== action.item.text) throw new Error('同じIDのチェック項目が変更されています。タスクを開き直してください。');
      return [...items];
    }
    if (items.some(item => !Number.isFinite(item.order))) throw new Error('チェック項目の順序を読み込めません。');
    const order = items.length ? items.reduce((max, item) => Math.max(max, item.order), -Infinity) + 1 : 0;
    return [...items, { id: action.item.id, text: action.item.text, isChecked: false, order }];
  }
  if (!validItemId(action.itemId)) throw new Error('チェック項目の指定が正しくありません。');
  const item = items.find(candidate => candidate.id === action.itemId);
  if (!item) throw new Error('チェック項目が見つかりません。タスクを開き直してください。');
  switch (action.kind) {
    case 'text': {
      if (typeof action.text !== 'string' || !action.text.trim() || typeof action.expectedText !== 'string') {
        throw new Error('項目名を入力してください。');
      }
      const text = action.text.trim();
      if (item.text === text) return [...items];
      if (item.text !== action.expectedText) throw new Error('項目名が変更されています。入力を控え、タスクを開き直して確認してください。');
      return items.map(candidate => candidate.id === item.id ? { ...candidate, text } : candidate);
    }
    case 'dueDate':
      validateChecklistItemDueDate(action.dueDate);
      if ((item.dueDate ?? null) === action.dueDate) return [...items];
      return items.map(candidate => candidate.id === item.id ? { ...candidate, dueDate: action.dueDate } : candidate);
    case 'toggle':
      if (typeof action.isChecked !== 'boolean') throw new Error('完了状態の指定が正しくありません。');
      if (item.isChecked === action.isChecked) return [...items];
      return items.map(candidate => candidate.id === item.id ? { ...candidate, isChecked: action.isChecked } : candidate);
    case 'remove':
      return items.filter(candidate => candidate.id !== item.id);
    default:
      throw new Error('チェック項目の操作が正しくありません。');
  }
}
