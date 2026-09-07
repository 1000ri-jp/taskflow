import { describe, expect, it } from 'vitest';
import type { DashboardTask } from './brief';
import { MEETING_PROPOSALS, MEETING_PARENTS, MEETING_ACTIONS, MEETING_IDEAS, MEETING_CONFIRMATIONS, FOCUS_PROPOSAL_IDS, matchMeetingProposal, containsMeetingSecret, safeMeetingText } from './meeting-proposals';

const projects = [{ id: 'p', name: '展示会出展' }, { id: 'r', name: 'ウリャマ' }];
const find = (id: string) => MEETING_PROPOSALS.find(p => p.id === id)!;
const task = (changes: Partial<DashboardTask> = {}): DashboardTask => ({
  id: 'existing', projectId: 'p', projectName: '展示会出展', listId: 'l', title: '出展情報提出', description: '', order: 0,
  assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false,
  isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null,
  createdBy: 'u', createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1), ...changes,
});
describe('replacement meeting memo', () => {
  it('covers all source items under four parents, merges only duplicate display design and separates the idea', () => {
    expect(MEETING_PARENTS).toHaveLength(4);
    expect(MEETING_ACTIONS).toHaveLength(35);
    expect(MEETING_IDEAS.map(p => p.id)).toEqual(['TF-7']);
    expect(new Set(MEETING_PROPOSALS.map(p => p.id)).size).toBe(36);
    const refs = new Set(MEETING_PROPOSALS.flatMap(p => p.sourceRefs));
    [14, 8, 7, 7].forEach((count, index) => {
      for (let number = 1; number <= count; number++) expect(refs.has('親' + (index + 1) + '-' + number)).toBe(true);
    });
    expect(find('TF-1').sourceRefs).toEqual(['親4-1', '親4-2']);
    expect(find('TF-1').completion).toContain('表示テストが通る');
    expect(find('MO-date').sourceRefs).toContain('会議日');
    expect(FOCUS_PROPOSAL_IDS.every(id => MEETING_ACTIONS.some(p => p.id === id))).toBe(true);
    expect(MEETING_CONFIRMATIONS).toHaveLength(12);
    expect(MEETING_PROPOSALS.every(p => p.title && p.completion && p.priority && p.taskStatus && p.sourceExcerpt)).toBe(true);
  });
  it('does not reuse old owners, fixed dates, completed claims or unspecified execution states', () => {
    expect(MEETING_PROPOSALS.every(p => p.dueDate === '')).toBe(true);
    expect(find('MO-2').timing).toContain('会議当日21時');
    expect(find('MO-date').content).toContain('2026/9/2');
    expect(find('MO-date').content).toContain('2026/9/3');
    expect(find('EX-3').timing).toBe('出展情報提出前');
    expect(find('EX-12').timing).toBe('資材到着後');
    expect(find('EX-5').owner).toBe('');
    expect(find('MO-4').owner).toBe('');
    expect(find('ST-1').owner).toBe('こずえ');
    expect(find('TF-1').owner).toBe('実装担当');
    expect(find('EX-14').content).toContain('状況が不明瞭');
    expect(find('MO-1').taskStatus).toBe('暫定決定');
    expect(find('EX-6').taskStatus).toBe('未着手');
    expect(find('EX-2').taskStatus).toBe('未指定');
    expect(MEETING_PROPOSALS.some(p => /LINEスタンプ/.test(p.title))).toBe(false);
  });
  it('retains explicit dependencies, all of which point to an existing action, and blocks sales pending verification', () => {
    expect(find('EX-7').dependencies).toEqual(['EX-2','EX-3','EX-4','EX-5','EX-6']);
    expect(find('MO-8').dependencies).toEqual(['MO-2','MO-3','MO-4','MO-5']);
    expect(find('EX-9').dependencyConditions).toBe('展示会登録完了・購入案内メール受領');
    expect(find('ST-6').content).toContain('確認が終わるまで出品しない');
    const ids = new Set(MEETING_ACTIONS.map(p => p.id));
    expect(MEETING_PROPOSALS.every(p => p.dependencies.every(id => ids.has(id) && id !== p.id))).toBe(true);
  });
  it('matches accessible tasks only and never treats unavailable data as new work', () => {
    expect(matchMeetingProposal(find('EX-7'), [task()], projects, true).candidates).toHaveLength(1);
    expect(matchMeetingProposal(find('EX-7'), [task({ projectId: 'foreign' })], projects, true).candidates).toHaveLength(0);
    expect(matchMeetingProposal(find('EX-7'), [task({ isArchived: true })], projects, true).candidates).toHaveLength(0);
    expect(matchMeetingProposal(find('EX-7'), [task()], projects, false).category).toBe('照合待ち');
    expect(matchMeetingProposal(find('EX-7'), [task()], [], true).category).toBe('要確認');
    const confident = { ...find('EX-7'), questions: [], owner: '確認済みの担当' };
    expect(matchMeetingProposal(confident, [task()], projects, true).category).toBe('更新候補');
    expect(matchMeetingProposal(confident, [], projects, true).category).toBe('新規候補');
    expect(matchMeetingProposal(confident, [task({ isCompleted: true })], projects, true).category).toBe('要確認');
    expect(matchMeetingProposal(confident, [task(),task({ id: 'second' })], projects, true).category).toBe('要確認');
  });
  it('never classifies ideas as executable tasks, and flags existing monitor mismatches', () => {
    expect(matchMeetingProposal(find('TF-7'), [], [], false).category).toBe('検討候補');
    const result = matchMeetingProposal(find('MO-2'), [task({ projectId: 'r', title: 'ココナラモニター募集（3名ほど）' })], projects, true);
    expect(result.category).toBe('要確認');
    expect(result.notes.join(' ')).toContain('自動統合しません');
  });
  it('does not include known credential patterns in the curated seed and masks likely secrets', () => {
    expect(MEETING_PROPOSALS.some(p => containsMeetingSecret(JSON.stringify(p)))).toBe(false);
    expect(safeMeetingText('パスワード: test-only-value')).toBe('認証情報の可能性があるため非表示');
    expect(containsMeetingSecret('Bearer fake-test-token')).toBe(true);
    expect(containsMeetingSecret('https://user:password@example.invalid')).toBe(true);
    expect(safeMeetingText('出展情報提出')).toBe('出展情報提出');
  });
});
