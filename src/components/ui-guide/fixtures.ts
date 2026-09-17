import type { List, Task } from '@/types';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';

export const guideNames = { 'guide-aya': '架空のあや', 'guide-ren': '架空のれん' };
export const guideLists: List[] = [{
  id: 'guide-list', projectId: 'guide-project', name: '案内の準備（架空）', color: '#64748b', order: 0,
  autoCompleteOnEnter: false, autoUncompleteOnExit: false, autoSetStartDateOnEnter: false,
  createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'),
}];
export const guideTitle = (long: boolean) => long
  ? '初めて参加する人にも持ち物・集合場所・雨天時の連絡方法が伝わる日本語の案内資料を、関係者と確認してから仕上げる'
  : '参加者向けの案内を仕上げる';
export const guideDescription = (long: boolean) => long
  ? '初めて読む人が、この案内だけで集合場所と当日の流れを把握できるようにします。\n持ち物、担当、連絡先を分けて書き、変更がある場合は誰が確認するかも残します。これは表示と操作の確認に使う架空の説明です。'.repeat(3)
  : '集合場所と持ち物を確認して、案内にまとめます。';
export function guideTasks(long: boolean, many: boolean, children = true): Task[] {
  const base: Task = {
    id: 'guide-parent', projectId: 'guide-project', listId: 'guide-list', title: guideTitle(long), description: guideDescription(long), order: 0,
    assigneeIds: ['guide-aya', 'guide-ren'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: 'medium',
    startDate: new Date('2026-09-16T00:00:00Z'), dueDate: new Date('2026-09-23T00:00:00Z'), durationDays: null, isDueDateFixed: false,
    isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'guide-aya',
    createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'),
  };
  return [base, ...(children ? [{ ...base, id: 'guide-child', parentTaskId: base.id, title: long ? '集合場所への道順を、初めて来る人が迷わないように写真付きで確認する' : '集合場所を確認する', assigneeIds: ['guide-ren'] }] : []),
    ...Array.from({ length: many ? 11 : 1 }, (_, index) => ({ ...base, id: `guide-${index}`, order: index + 1, title: `${index + 1}. ${long ? guideTitle(true) : '配布する内容を確認する'}`, isCompleted: index === 2 }))];
}
export function guideProposal(long: boolean): OrganizationPreview {
  return { id: 'guide-proposal', projectId: 'guide-project', kind: 'update', status: 'pending', aiSuggested: true, canApply: true,
    createdAt: '2026-09-16T00:00:00Z', reason: long ? guideDescription(true) : '案内の担当者から届いた新しい連絡と、現在の期限を照合しました。', sourceTitle: '打ち合わせメモ（架空）',
    quote: '案内の確認期限を9月23日に変更します。', warnings: [],
    changes: [{ taskId: 'guide-parent', title: guideTitle(long), summary: '期限を変更', fields: [{ field: 'dueDate', before: '2026-09-20', after: '2026-09-23' }] }],
  };
}
