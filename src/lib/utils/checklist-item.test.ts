import { describe, expect, it } from 'vitest';
import { assertChecklistItemScope, mutateChecklistItems, validateChecklistItemDueDate, type ChecklistItemMutation } from './checklist-item';
import type { ChecklistItem } from '@/types';

const items = [
  { id: 'later', text: '箱', isChecked: true, order: 20, dueDate: '2026-09-15', assigneeIds: ['a'] },
  { id: 'first', text: 'シール', isChecked: false, order: 4 },
  { id: 'middle', text: 'テープ', isChecked: false, order: 10, dueDate: null },
];

describe('checklist item mutation', () => {
  it('edits only the requested text, keeps legacy fields and accepts an identical retry', () => {
    const action = { kind: 'text', itemId: 'later', text: '  梱包箱  ', expectedText: '箱' } as const;
    const saved = mutateChecklistItems(items, action);
    expect(saved[0]).toEqual({ ...items[0], text: '梱包箱' });
    expect(saved[1]).toBe(items[1]); expect(saved[2]).toBe(items[2]);
    expect(items[0].text).toBe('箱');
    expect(mutateChecklistItems(saved, action)[0]).toBe(saved[0]);
    expect(() => mutateChecklistItems(items, { ...action, expectedText: '古い箱' })).toThrow('項目名が変更されています');
    expect(() => mutateChecklistItems(items, { ...action, itemId: 'deleted' })).toThrow('見つかりません');
    expect(() => mutateChecklistItems(items, { ...action, text: ' ' })).toThrow('項目名を入力');
  });
  it.each([null, '0001-01-01', '0099-02-28', '2000-02-29', '2024-02-29', '2026-09-13', '9999-12-31'])('accepts an exact Gregorian date or clear: %s', date => {
    expect(() => validateChecklistItemDueDate(date)).not.toThrow();
  });
  it.each([undefined, '', ' ', '2026-9-13', '2026-09-13T00:00:00Z', '2026-02-29', '1900-02-29', '2100-02-29', '0000-01-01', '2026-00-10', '2026-13-01', '2026-04-31', '2026-01-00', '2026-01-32', '2026-09-13\n', 20260913, new Date()])('rejects an invalid deadline: %s', date => {
    expect(() => validateChecklistItemDueDate(date)).toThrow('期限');
  });
  it('changes only the target deadline, preserving completion, ordering, extra fields, and legacy absent dates', () => {
    const input = items.map(item => Object.freeze({ ...item }));
    Object.freeze(input);
    const result = mutateChecklistItems(input, { kind: 'dueDate', itemId: 'later', dueDate: '2026-10-01' });
    expect(result[0]).toEqual({ ...items[0], dueDate: '2026-10-01' });
    expect(result[1]).toBe(input[1]);
    expect(result[1]).not.toHaveProperty('dueDate');
    expect(result[2]).toBe(input[2]);
    expect(input[0].dueDate).toBe('2026-09-15');
    const cleared = mutateChecklistItems(result, { kind: 'dueDate', itemId: 'later', dueDate: null });
    expect(cleared[0]).toEqual({ ...items[0], dueDate: null });
  });
  it('adds after the maximum manual order and preserves all latest sibling data', () => {
    const result = mutateChecklistItems(items, { kind: 'add', item: { id: 'new', text: '追加' } });
    expect(result.slice(0, 3)).toEqual(items);
    expect(result[3]).toEqual({ id: 'new', text: '追加', isChecked: false, order: 21 });
    expect(mutateChecklistItems([], { kind: 'add', item: { id: 'new', text: '最初' } })[0].order).toBe(0);
    expect(items).toHaveLength(3);
  });
  it('uses the requested checked state and removes only the target without renumbering siblings', () => {
    const checked = mutateChecklistItems(items, { kind: 'toggle', itemId: 'first', isChecked: true });
    expect(checked[1]).toEqual({ ...items[1], isChecked: true });
    const removed = mutateChecklistItems(checked, { kind: 'remove', itemId: 'middle' });
    expect(removed).toEqual([items[0], { ...items[1], isChecked: true }]);
    expect(removed[0]).toBe(items[0]);
    expect(items[1].isChecked).toBe(false);
  });
  it.each<ChecklistItemMutation>([
    { kind: 'dueDate', itemId: 'later', dueDate: '2026-09-15' },
    { kind: 'dueDate', itemId: 'first', dueDate: null },
    { kind: 'dueDate', itemId: 'middle', dueDate: null },
    { kind: 'toggle', itemId: 'later', isChecked: true },
    { kind: 'add', item: { id: 'later', text: '箱' } },
  ])('preserves item references for no-op intent %j', action => {
    const result = mutateChecklistItems(items, action);
    expect(result).not.toBe(items);
    result.forEach((item, index) => expect(item).toBe(items[index]));
    expect(result[1]).not.toHaveProperty('dueDate');
  });
  it('rejects duplicate/empty IDs, missing targets, and conflicting retry additions', () => {
    const action: ChecklistItemMutation = { kind: 'toggle', itemId: 'first', isChecked: true };
    for (const malformed of [[...items, items[0]], [{ ...items[0], id: '' }], [{ ...items[0], id: ' ' }], [null]]) {
      expect(() => mutateChecklistItems(malformed as ChecklistItem[], action)).toThrow('読み込めません');
    }
    for (const missing of [
      { kind: 'dueDate', itemId: 'deleted', dueDate: null },
      { kind: 'toggle', itemId: 'deleted', isChecked: true },
      { kind: 'remove', itemId: 'deleted' },
    ] satisfies ChecklistItemMutation[]) expect(() => mutateChecklistItems(items, missing)).toThrow('見つかりません');
    expect(() => mutateChecklistItems(items, { kind: 'add', item: { id: 'later', text: '変更された箱' } })).toThrow('変更されています');
    expect(() => mutateChecklistItems(items, { kind: 'add', item: { id: 'new', text: ' ' } })).toThrow('指定');
    expect(() => mutateChecklistItems(items, { kind: 'remove', itemId: '' })).toThrow('指定');
  });
  it.each(['', ' ', '/', 'p/task', '.', '..', 'p\u0000', 'p\n', 'p\u007f', 'p\u009f'])('rejects unsafe scope IDs in every path segment: %s', id => {
    expect(() => assertChecklistItemScope(id, 'task', 'list')).toThrow('指定');
    expect(() => assertChecklistItemScope('project', id, 'list')).toThrow('指定');
    expect(() => assertChecklistItemScope('project', 'task', id)).toThrow('指定');
  });
  it('allows normal Unicode, spaces, and punctuation in document IDs', () => {
    expect(() => assertChecklistItemScope('展示会', '搬入 1', 'list-v1.2_備品')).not.toThrow();
  });
});
