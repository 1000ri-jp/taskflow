import { proposalRefreshReason, proposalCardQuestion, proposalAttentionReason } from './presentation';
import { describe, expect, it } from 'vitest';
import { createMockSecretary, mockView, reviewMock } from './mock';
import { isActionableProposal, isReadyToStartProposal, proposalReadinessReason, proposalPresentation } from './presentation';
import type { Proposal } from './types';

const now = '2026-09-12T01:00:00.000Z';
function setup() {
  const mock = reviewMock(createMockSecretary('me', now), 'me', now);
  const { snapshot } = mockView(mock, 'me', now);
  const task = snapshot.tasks.find(t => t.taskId === 'ready')!;
  const proposal = mock.state.proposals.find(p => p.key === task.key)!;
  return { task, proposal, snapshot };
}

describe('Secretary attention timing', () => {
  it.each([
    '2026-09-11T14:59:59Z',
    '2026-09-11T15:00:00Z',
    '2026-09-12T00:00:00Z',
    '2026-09-12T14:59:59Z',
    '2026-09-12T15:00:00Z',
  ])('does not prioritize a revisit date before the task deadline at %s', checkedAt => {
    const { task, proposal, snapshot } = setup();
    task.dueDate = '2026-09-18T00:00:00+09:00';
    proposal.reviewAt = '2026-09-12T00:00:00Z';
    snapshot.checkedAt = checkedAt;
    const before = structuredClone({ proposal, snapshot });
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    expect({ proposal, snapshot }).toEqual(before);
  });
  it.each([null, '2026-09-18T00:00:00+09:00', '2026-10-31T00:00:00+09:00'])('does not make unknown progress or high priority a decision due today (%s)', dueDate => {
    const { task, proposal, snapshot } = setup();
    task.dueDate = dueDate; task.priority = 'high';
    proposal.disposition = 'candidate'; proposal.uncertainties = ['進捗を確認する'];
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
  });
  it('uses the current task deadline in Japan time even when the AI proposal is stale', () => {
    const { task, proposal, snapshot } = setup();
    task.dueDate = '2026-09-11T15:00:00Z'; task.version += ':edited';
    expect(proposalAttentionReason(proposal, snapshot)).toEqual({ kind: 'due', label: '期限が今日' });
    task.dueDate = '2026-09-11T14:59:00Z';
    expect(proposalAttentionReason(proposal, snapshot)).toEqual({ kind: 'due', label: '期限超過' });
  });
  it('keeps both current and stale AI reminders out of priority candidates', () => {
    const { task, proposal, snapshot } = setup();
    task.dueDate = '2026-10-01T00:00:00+09:00';
    proposal.reviewAt = '2026-09-13T00:00:00+09:00';
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    proposal.reviewAt = now;
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    task.version += ':edited';
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
  });
  it('does not let partial retrieval establish an AI reminder or erase a known deadline', () => {
    const { task, proposal, snapshot } = setup();
    proposal.reviewAt = now; snapshot.coverage.status = 'partial';
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    task.dueDate = now;
    expect(proposalAttentionReason(proposal, snapshot)?.kind).toBe('due');
  });
  it('surfaces only explicit urgent review requests still awaiting this person', () => {
    const { task, proposal, snapshot } = setup();
    const review = { urgency: 'urgent' as const, policy: 'all' as const, round: 1, request: '確認してください', attachments: [], requestedAt: now, responses: {} };
    task.assigneeIds = ['me', 'colleague'];
    task.context = { projectDescription: '', parentState: 'unset', parent: null, milestoneState: 'unset', milestone: null, taskKind: 'review_request', sourceComment: null, review };
    expect(proposalAttentionReason(proposal, snapshot)?.kind).toBe('urgent');
    task.context.review = { ...review, responses: { me: { outcome: 'approved', note: '', at: now } } };
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    task.context.review = { ...review, policy: 'any', responses: { colleague: { outcome: 'approved', note: '', at: now } } };
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    task.context.review = { ...review, urgency: undefined };
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
  });
  it('does not revive an adopted hold or change any saved decision', () => {
    const { task, proposal, snapshot } = setup();
    task.dueDate = now; proposal.status = 'accepted'; proposal.disposition = 'hold';
    const before = structuredClone({ proposal, snapshot });
    expect(proposalAttentionReason(proposal, snapshot)).toBeNull();
    expect({ proposal, snapshot }).toEqual(before);
  });
});

describe('Secretary proposal presentation', () => {
  it('explains only registered start conditions, independently of deadlines and action summaries', () => {
    const { proposal, task, snapshot } = setup();
    proposal.reason = '展示台への暗幕取り付けと加工を完了させます。';
    task.startDate = '2026-09-03T15:00:00Z';
    const expected = '登録上、自分の担当です。開始日（9/4）を迎えています。前工程の登録はありません。待ち・保留の登録はありません。';
    for (const dueDate of [null, '2026-09-11T00:00:00Z', '2026-10-01T00:00:00Z']) {
      task.dueDate = dueDate;
      expect(proposalReadinessReason(proposal, snapshot)).toBe(expected);
    }
    task.startDate = null;
    expect(proposalReadinessReason(proposal, snapshot)).toContain('開始日の指定はありません。');
    expect(proposalReadinessReason(proposal, snapshot)).not.toMatch(/素材.*揃|準備.*完了|取り付け|期限/);
  });
  it('names completed prerequisites and stops explaining readiness when they become unknown or blocked', () => {
    const { proposal, task, snapshot } = setup();
    const dependency = snapshot.tasks.find(t => t.taskId === 'draft')!;
    task.dependsOn = [dependency.key];
    dependency.isCompleted = true;
    expect(proposalReadinessReason(proposal, snapshot)).toContain(`前工程「${dependency.title}」が完了しています。`);
    dependency.isCompleted = false;
    expect(proposalReadinessReason(proposal, snapshot)).toBeNull();
    dependency.isCompleted = true;
    dependency.complete = false;
    expect(proposalReadinessReason(proposal, snapshot)).toBeNull();
    dependency.complete = true;
    task.workState = { status: 'wait', reason: '資材待ち', resumeCondition: '資材が到着', reviewAt: null };
    expect(proposalReadinessReason(proposal, snapshot)).toBeNull();
    task.workState = null;
    task.version += ':changed';
    expect(proposalReadinessReason(proposal, snapshot)).toBeNull();
  });
  it('keeps a current ready badge grouped after an unrelated snapshot change without relaxing next-step adoption', () => {
    const { proposal, snapshot } = setup();
    snapshot.signature += ':unrelated-update';
    const before = structuredClone({ proposal, snapshot });
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(true);
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
    expect({ proposal, snapshot }).toEqual(before);
  });
  it('does not group stale or unresolved execution as ready to start', () => {
    const { proposal, task, snapshot } = setup();
    task.version += ':changed';
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(false);
    proposal.sourceVersion = task.version;
    proposal.uncertainties = ['素材は届いているか'];
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(false);
    proposal.uncertainties = [];
    task.startDate = '2026-09-13T00:00:00+09:00';
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(false);
    task.startDate = null;
    snapshot.coverage.status = 'partial';
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(false);
    snapshot.coverage.status = 'ready';
    proposal.status = 'accepted';
    expect(isReadyToStartProposal(proposal, snapshot)).toBe(false);
  });
  it('separates resolved current execution from work that needs a decision', () => {
    const { proposal, snapshot } = setup();
    expect(isActionableProposal(proposal, snapshot)).toBe(true);
    proposal.uncertainties = ['素材は到着していますか'];
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
    proposal.uncertainties = [];
    proposal.commitment = 'unknown';
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
  });
  it('keeps stale, partial, blocked and review work out of the actionable section', () => {
    const { proposal, task, snapshot } = setup();
    snapshot.signature += ':new';
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
    proposal.snapshotSignature = snapshot.signature;
    snapshot.coverage.status = 'partial';
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
    snapshot.coverage.status = 'ready';
    task.startDate = '2026-09-13T00:00:00Z';
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
    task.startDate = null;
    task.context = { projectDescription: '', parentState: 'unset', parent: null, milestoneState: 'unset', milestone: null, taskKind: 'review_request', sourceComment: null };
    expect(isActionableProposal(proposal, snapshot)).toBe(false);
  });
  it.each<{ name: string; patch: Partial<Proposal>; label: string }>([
    { name: 'an unconfirmed candidate', patch: { disposition: 'candidate', commitment: 'unknown' }, label: '今やるか未判断' },
    { name: 'a candidate with a confirmed commitment', patch: { disposition: 'candidate' }, label: '今やるか未判断' },
    { name: 'a confirmed question', patch: { speech: 'question' }, label: '状況確認が必要' },
    { name: 'execution with unanswered status', patch: { uncertainties: ['銀行側の手続き完了待ちか、未着手か'] }, label: '状況確認が必要' },
  ])('asks to inspect $name without offering adoption', ({ patch, label }) => {
    const { proposal, task, snapshot } = setup();
    Object.assign(proposal, patch, { reason: '銀行側の手続き完了待ちか、未着手かを確認させてください。' });
    const before = structuredClone({ proposal, task, snapshot });

    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label,
      detail: proposal.uncertainties.length ? '銀行側の手続き完了待ちか、未着手かを確認する' : proposal.reason,
      inspect: true,
    });
    expect({ proposal, task, snapshot }).toEqual(before);
  });

  it.each([
    ['銀行への書類提出状況', '銀行への書類提出状況を確認する'],
    ['原稿の承認状況', '原稿の承認状況を確認する'],
    ['原稿が承認済みか', '原稿が承認済みかを確認する'],
    ['原稿が承認済みか？', '原稿が承認済みかを確認する'],
    ['原稿が承認済みか確認する', '原稿が承認済みか確認する'],
    ['原稿が承認済みか確認する。', '原稿が承認済みか確認する。'],
    ['原稿は承認済みですか？', '「原稿は承認済みですか？」を確認する'],
    ['原稿は承認済み？', '「原稿は承認済み？」を確認する'],
  ])('makes the first uncertainty actionable without changing its meaning: %s', (uncertainty, detail) => {
    const { proposal, task, snapshot } = setup();
    proposal.uncertainties = [uncertainty, 'ほかの依頼への影響'];
    proposal.reason = '今日送信するかは判断できません。';
    task.dueDate = '2026-09-10T00:00:00.000Z';
    const before = structuredClone({ proposal, task, snapshot });

    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '状況確認が必要', detail, inspect: true,
    });
    expect({ proposal, task, snapshot }).toEqual(before);
  });

  it('does not present a decision from partially retrieved information', () => {
    const { proposal, task, snapshot } = setup();
    snapshot.coverage.status = 'partial';
    proposal.uncertainties = ['銀行側の手続き完了待ちか、未着手か'];
    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '情報不足・未判断', detail: '取得できていない情報があります。', inspect: true,
    });
    snapshot.coverage.status = 'ready';
    task.complete = false;
    expect(proposalPresentation(proposal, task, snapshot).label).toBe('情報不足・未判断');
  });

  it.each(['missing', 'incomplete'] as const)('distinguishes a %s prerequisite from known unfinished work', state => {
    const { proposal, task, snapshot } = setup();
    const dependency = snapshot.tasks.find(t => t.taskId === 'draft')!;
    task.dependsOn = [dependency.key];
    if (state === 'missing') snapshot.tasks = snapshot.tasks.filter(t => t !== dependency);
    else { dependency.complete = false; dependency.isCompleted = true; }

    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '前提の確認が必要', detail: '前工程の状況を取得できていません。', inspect: true,
    });
  });

  it('names a known unfinished prerequisite instead of recommending execution', () => {
    const { proposal, task, snapshot } = setup();
    const dependency = snapshot.tasks.find(t => t.taskId === 'draft')!;
    task.dependsOn = [dependency.key];
    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '今は着手できない', detail: `前工程待ち: ${dependency.title}`, inspect: true,
    });
  });

  it('respects a future start date even when the registered deadline has passed', () => {
    const { proposal, task, snapshot } = setup();
    task.startDate = '2026-09-13T00:00:00.000Z';
    task.dueDate = '2026-09-10T00:00:00.000Z';
    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '今は着手できない', detail: '開始日前', inspect: true,
    });
  });

  it('keeps an overdue wait as a wait without inventing a changed schedule', () => {
    const { proposal, task, snapshot } = setup();
    Object.assign(proposal, {
      disposition: 'wait', speech: 'hold', reason: '銀行の手続き完了を待っています。',
      trigger: '銀行から手続き完了の連絡が届く', reviewAt: null,
    });
    task.dueDate = '2026-09-10T00:00:00.000Z';
    const before = structuredClone({ proposal, task });
    expect(proposalPresentation(proposal, task, snapshot)).toEqual({
      label: '条件待ち', detail: '銀行の手続き完了を待っています。', inspect: false,
    });
    expect({ proposal, task }).toEqual(before);
  });

  it.each([null, '2026-09-12T00:00:00.000Z', '2026-09-10T00:00:00.000Z'])(
    'shows confirmed unblocked execution independently of deadline %s', dueDate => {
      const { proposal, task, snapshot } = setup();
      task.dueDate = dueDate;
      expect(proposalPresentation(proposal, task, snapshot)).toEqual({
        label: '着手できる', detail: proposal.reason, inspect: false,
      });
    },
  );
});


describe('current questions and stale reasons', () => {
 it('explains a task version change without treating it as a work problem', () => {
  const { proposal, task, snapshot } = setup();
  task.version += ':new';
  expect(proposalRefreshReason(proposal, snapshot)).toEqual({ label: '情報更新', detail: 'このタスクの情報が、前回のAI整理後に変わっています。' });
  expect(proposalCardQuestion(proposal, task, snapshot)).not.toBe(proposal.reason);
 });
 it('asks about completion before a possible deadline change, without adopting it', () => {
  const { proposal, task, snapshot } = setup();
  task.version += ':new'; task.dueDate = '2026-09-01T00:00:00Z'; task.startDate = null;
  const before = structuredClone({ proposal, task, snapshot });
  expect(proposalCardQuestion(proposal, task, snapshot)).toBe('完了済みですか？ 未完了なら期限を見直しますか？');
  expect({ proposal, task, snapshot }).toEqual(before);
  task.workState = { status: 'wait', reason: '返答待ち', resumeCondition: '返答が来る', reviewAt: null };
  expect(proposalCardQuestion(proposal, task, snapshot)).not.toContain('期限を見直し');
 });
 it('retains specific checking content as a short question while current', () => {
  const { proposal, task, snapshot } = setup();
  proposal.uncertainties = ['他の販促品とのデザイン整合性が取れているか'];
  expect(proposalCardQuestion(proposal, task, snapshot)).toBe('他の販促品とのデザイン整合性が取れているか？');
 });
 it('identifies a changed related job, and separates unavailable evidence', () => {
  const { proposal, task, snapshot } = setup();
  const related = snapshot.tasks.find(t => t.key !== task.key)!;
  proposal.relatedVersions = [{ key: related.key, version: related.version }]; related.version += ':new';
  expect(proposalRefreshReason(proposal, snapshot)).toEqual({ label: '関連変更', detail: expect.stringContaining(related.title) });
  related.complete = false;
  expect(proposalRefreshReason(proposal, snapshot)).toEqual({ label: '関連未取得', detail: '関連する仕事の最新情報を取得できていません。' });
  snapshot.coverage.status = 'partial';
  expect(proposalRefreshReason(proposal, snapshot)).toEqual({ label: '情報未取得', detail: '最新情報を取得できていません。' });
 });
});
