import { describe, expect, it } from 'vitest';
import { recentActivityEntry, recentChangeText, taskEditChanges } from './recentChanges';
import type { HistoryEntry } from './types';

const entry = (changes: HistoryEntry['changes']): HistoryEntry => ({ id: 'edit', kind: 'activity', title: '内容を更新', text: '', actor: '本人', at: null, private: false, changes });
describe('inline task changes', () => {
  it('shows recorded before/after values and human-readable operation summaries', () => {
    expect(recentChangeText(entry([{ field: 'dueDate', before: '2026-09-16', after: '2026-09-18' }]))).toBe('期限：2026/9/16 → 2026/9/18');
    expect(recentChangeText(entry([{ field: 'organization', before: '', after: 'チェックリストへ「試作」を追加' }]))).toBe('チェックリストへ「試作」を追加');
    expect(recentChangeText(entry([{ field: 'workEvent', before: '', after: '資料を提出して確認待ち' }]))).toBe('資料を提出して確認待ち');
  });
  it('does not expose raw relationship IDs or invent a change when no field was recorded', () => {
    expect(recentChangeText(entry([{ field: 'assigneeIds', before: '["private-id"]', after: '["next-id"]' }]))).toBe('担当を変更・1件追加・1件解除');
    expect(recentChangeText(entry([{ field: 'labelIds', before: '[]', after: '["ai-moai"]' }]))).toBe('ラベルを変更・モアイを追加');
    expect(recentChangeText(entry([]))).toBe('変更項目は記録されていません');
  });
  it('compares stored timestamps with Date edits and ignores metadata and unchanged fields', () => {
    const date = new Date('2026-09-16T00:00:00Z');
    expect(taskEditChanges({ title: '前', dueDate: { toDate: () => date }, labelIds: ['keep'] }, { title: '後', dueDate: date, labelIds: ['keep'], updatedAt: new Date(), priority: undefined })).toEqual([{ field: 'title', oldValue: '前', newValue: '後' }]);
    expect(taskEditChanges({ dueDate: date }, { dueDate: null })).toEqual([{ field: 'dueDate', oldValue: date.toISOString(), newValue: '' }]);
  });
});

it('explains a generic subtask edit using recorded before/after snapshots', () => {
  const log = {targetId:'child',workflowAction:'edit_subtask',action:'update',userName:'本人',changes:[{field:'workEvent',newValue:'サブタスクを編集'}],before:{title:'持ちもの',dueDate:new Date('2026-09-16')},after:{title:'持ちもの',dueDate:new Date('2026-09-18')},receipt:{taskId:'child',taskTitle:'持ちもの'}};
  expect(recentChangeText(recentActivityEntry('edit',log))).toBe('期限：2026/9/16 → 2026/9/18');
  expect(recentChangeText(recentActivityEntry('parent-copy',{...log,targetId:'parent'}))).toBe('「持ちもの」：期限：2026/9/16 → 2026/9/18');
  expect(recentChangeText(recentActivityEntry('same',{...log,after:log.before}))).toBe('内容の変更なし（再保存）');
});
