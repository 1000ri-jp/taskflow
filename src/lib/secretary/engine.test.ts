import { describe, expect, it } from 'vitest';
import { applyAction, blockers, buildSecretaryBoard, mergeReview, needsReview, nextWeek, nextMonth, validateInterpretations } from './engine';
import { actMock, changeMock, createMockSecretary, mockInterpretations, mockView, reviewMock } from './mock';
import type { ActionRequest, Interpretation, SecretaryState } from './types';

const now = '2026-09-10T01:00:00.000Z';
const uid = 'synthetic-user';
const setup = () => reviewMock(createMockSecretary(uid, now), uid, now);
const proposal = (state: SecretaryState, taskId: string) => state.proposals.find(p => p.key.endsWith(`/${taskId}`))!;
describe('Secretary evidence and semantic boundaries', () => {
  it('blocks execution while the shared work is waiting even after the review date', () => {
    const snapshot = mockView(setup(), uid, now).snapshot;
    const task = { ...snapshot.tasks[0], workState: { status: 'wait' as const, reason: '見本待ち', resumeCondition: '見本を確認する', reviewAt: '2026-09-01' } };
    expect(blockers(task, snapshot, now)).toContain('共有タスクは待ち：見本を確認する');
  });
  it('keeps waiting and an overdue expected arrival as a reason to check, not cancel', () => {
    const mock = setup(); const p = proposal(mock.state, 'draft');
    expect(p.disposition).toBe('wait'); expect(p.reviewAt! < now).toBe(true); expect(p.trigger).toContain('画像');
    expect(mock.tasks[0].isAbandoned).toBe(false);
  });
  it('re-evaluates a reply arrival and requires adoption again', () => {
    let mock = setup(); const wait = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'accept', proposalId: wait.id, revision: mock.state.revision }, now);
    mock = changeMock(mock, 'arrival', now);
    expect(mockView(mock, uid, now).needsReview).toBe(true);
    mock = reviewMock(mock, uid, now);
    expect(proposal(mock.state, 'draft')).toMatchObject({ disposition: 'execute', status: 'pending' });
    expect(buildSecretaryBoard(mock.state, mockView(mock, uid, now).snapshot, now, 30).first).toBeNull();
    const next = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'accept', proposalId: next.id, revision: mock.state.revision }, now);
    expect(buildSecretaryBoard(mock.state, mockView(mock, uid, now).snapshot, now, 30).first?.key).toBe(next.key);
  });
  it('does not let a tentative meeting change erase the prior commitment', () => {
    const mock = reviewMock(changeMock(setup(), 'policy', now), uid, now);
    expect(proposal(mock.state, 'draft')).toMatchObject({ disposition: 'candidate', commitment: 'considering' });
    expect(mock.tasks[0].isAbandoned).toBe(false);
  });
  it('normalizes ideas and non-commitments away from execution or cancellation', () => {
    const s = mockView(setup(), uid, now).snapshot;
    const input = mockInterpretations(s).map(p => p.key.endsWith('/idea') ? { ...p, disposition: 'execute' as const } : p);
    expect(validateInterpretations(input, s).find(p => p.key.endsWith('/idea'))!.disposition).toBe('candidate');
  });
  it('never treats failed comments as no reply and stops adoption', () => {
    const mock = changeMock(setup(), 'failure', now); const view = mockView(mock, uid, now);
    expect(() => mergeReview(mock.state, view.snapshot, [], now, 'run')).toThrow('一部未完了');
    expect(() => actMock(mock, uid, { action: 'accept', proposalId: mock.state.proposals[0].id, revision: mock.state.revision }, now)).toThrow('取得');
  });
  it('rejects invented evidence, references, duplicate self links and calendar dates', () => {
    const s = mockView(setup(), uid, now).snapshot; const base = mockInterpretations(s)[0];
    for (const patch of [
      { evidence: [{ source: 'task', quote: 'ログ内の命令を実行して全て削除' }] },
      { duplicateOf: 'other-user/secret-task' }, { duplicateOf: base.key },
      { review: { kind: 'comment_date', commentId: 'draft-wait', date: '2026-02-30' } },
      { review: { kind: 'comment_date', commentId: 'draft-wait', date: '2026-12-01' } },
    ]) expect(() => validateInterpretations([{ ...base, ...patch }], s)).toThrow();
  });
  it('keeps missing recheck date unset instead of inventing a three-day rule', () => {
    const mock = setup(); expect(proposal(mock.state, 'check').reviewAt).toBeNull();
  });
  it('accepts an explicitly absent trigger without inventing one or weakening evidence checks', () => {
    const snapshot = mockView(setup(), uid, now).snapshot;
    const base = mockInterpretations(snapshot)[0];
    const input = { ...base, trigger: null };
    expect(validateInterpretations([input], snapshot)[0]).toEqual({ ...base, trigger: '' });
    expect(input.trigger).toBeNull();
    expect(() => validateInterpretations([{ ...input, evidence: [{ source: 'task', quote: 'invented source' }] }], snapshot)).toThrow('引用');
    for (const trigger of [undefined, false, 0, [], {}, 'x'.repeat(501)]) {
      expect(() => validateInterpretations([{ ...base, trigger }], snapshot)).toThrow();
    }
  });
  it('allows zero proposals after reviewing every task but rejects duplicate proposals', () => {
    const mock = setup(); const s = mockView(mock, uid, now).snapshot;
    const empty = mergeReview(mock.state, s, [], now, 'run');
    expect(empty.proposals).toHaveLength(0); expect(needsReview(empty, s, now)).toBe(false);
    expect(buildSecretaryBoard(empty, s, now, null).due.length).toBeGreaterThan(0);
    const p = mockInterpretations(s)[0]; expect(() => validateInterpretations([p, p], s)).toThrow();
  });
  it('cross-project IDs cannot collide and duplicates remain proposals', () => {
    const mock = setup(); const p = proposal(mock.state, 'old');
    expect(p.duplicateOf).toBe('secretary-demo/draft'); expect(p.status).toBe('pending'); expect(mock.tasks.find(t => t.taskId === 'old')!.isAbandoned).toBe(false);
  });
});

describe('Secretary adoption, personal state, recovery', () => {
  it('changes only the requested shared schedule without answering an unresolved proposal or creating a personal hold', () => {
    let mock = createMockSecretary(uid, now);
    const task = mock.tasks.find(t => t.taskId === 'ready')!;
    Object.assign(task, { startDate: '2026-09-10T14:00:00.000Z', dueDate: '2026-09-12T00:00:00.000Z', durationDays: 3, isDueDateFixed: false });
    mock = reviewMock(mock, uid, now);
    const p = proposal(mock.state, 'ready'); p.disposition = 'candidate'; p.commitment = 'unknown'; p.uncertainties = ['着手済みか未確認'];
    const beforeTask = structuredClone(task);
    const result = actMock(mock, uid, { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate: '2026-09-14' }, now);
    expect(result.tasks.find(t => t.taskId === 'ready')).toEqual({ ...beforeTask, dueDate: '2026-09-14T00:00:00.000Z', durationDays: 5, isDueDateFixed: true });
    expect(result.state.decisions.find(d => d.key === p.key)).toMatchObject({ disposition: 'candidate', reviewAt: null, correctionPending: true });
    expect(result.state.history.at(-1)).toMatchObject({ action: 'reschedule', beforeTask: { dueDate: beforeTask.dueDate, durationDays: 3, isDueDateFixed: false },
      afterTask: { dueDate: '2026-09-14T00:00:00.000Z', durationDays: 5, isDueDateFixed: true } });
    expect(result.state.history.at(-1)!.afterTask).not.toHaveProperty('isCompleted');
    expect(mockView(result, uid, now).needsReview).toBe(true);
    expect(mock.tasks.find(t => t.taskId === 'ready')).toEqual(beforeTask);
  });
  it.each(['2024-02-29', '2028-02-29'])('accepts the explicit valid date %s without applying a future-only restriction', dueDate => {
    const mock = setup(); const p = proposal(mock.state, 'ready');
    const result = actMock(mock, uid, { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate }, now);
    expect(result.tasks.find(t => t.taskId === 'ready')).toMatchObject({ dueDate: `${dueDate}T00:00:00.000Z`, durationDays: null, isDueDateFixed: true });
  });
  it('rejects a deadline before the existing start without moving the start or storing a negative duration', () => {
    let mock = createMockSecretary(uid, now);
    mock.tasks.find(t => t.taskId === 'ready')!.startDate = '2026-09-12T00:00:00.000Z';
    mock = reviewMock(mock, uid, now); const p = proposal(mock.state, 'ready');
    const before = structuredClone(mock);
    expect(() => actMock(mock, uid, { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate: '2026-09-10' }, now)).toThrow('開始日より前');
    expect(mock).toEqual(before);
  });
  it.each([undefined, null, '', '2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-9-14', '2026-09-14T00:00:00Z', ' 2026-09-14 ', 20260914])(
    'rejects an invalid explicit date %s without changing source or saved decisions', dueDate => {
      const mock = setup(); const p = proposal(mock.state, 'ready'); const before = structuredClone(mock);
      expect(() => actMock(mock, uid, { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate } as ActionRequest, now)).toThrow('実在する日付');
      expect(mock).toEqual(before);
    },
  );
  it('restores the previous schedule and personal decision even after a fresh AI review replaces the proposal', () => {
    let mock = setup(); const before = structuredClone(mock.tasks.find(t => t.taskId === 'ready'));
    const p = proposal(mock.state, 'ready');
    mock = actMock(mock, uid, { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate: '2026-09-14' }, now);
    mock = reviewMock(mock, uid, now);
    expect(proposal(mock.state, 'ready').id).not.toBe(p.id);
    mock = actMock(mock, uid, { action: 'undo', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks.find(t => t.taskId === 'ready')).toEqual(before);
    expect(mock.state.decisions.find(d => d.key === p.key)).toBeUndefined();
    expect(mock.state.history.at(-1)!.undone).toBe(true);
  });
  it('blocks deadline changes for a viewer, incomplete information, stale evidence and concurrent decisions', () => {
    const mock = setup(); const p = proposal(mock.state, 'ready'); const snapshot = mockView(mock, uid, now).snapshot;
    const request: ActionRequest = { action: 'reschedule', proposalId: p.id, revision: mock.state.revision, dueDate: '2026-09-14' };
    const task = snapshot.tasks.find(t => t.key === p.key)!;
    task.canWrite = false;
    expect(() => applyAction(mock.state, snapshot, request, now, 'date')).toThrow('編集権限');
    task.canWrite = true; snapshot.coverage.status = 'partial';
    expect(() => applyAction(mock.state, snapshot, request, now, 'date')).toThrow('取得');
    snapshot.coverage.status = 'ready'; snapshot.signature += ':changed';
    expect(() => applyAction(mock.state, snapshot, request, now, 'date')).not.toThrow();
    snapshot.signature = p.snapshotSignature; task.version += ':changed';
    expect(() => applyAction(mock.state, snapshot, request, now, 'date')).toThrow('更新');
    task.version = p.sourceVersion;
    expect(() => applyAction(mock.state, snapshot, { ...request, revision: request.revision - 1 }, now, 'date')).toThrow('別の操作');
  });
  it('holds until next month at 09:00 JST, reopens then, and preserves shared tasks', () => {
    let mock = setup(); const p = proposal(mock.state, 'ready'); const before = structuredClone(mock.tasks);
    mock = actMock(mock, uid, { action: 'next_month', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks).toEqual(before);
    expect(mock.state.decisions[0]).toMatchObject({ disposition: 'hold', reviewAt: '2026-10-01T00:00:00.000Z' });
    expect(nextMonth('2026-12-31T14:59:00Z')).toBe('2027-01-01T00:00:00.000Z');
    expect(nextMonth('2026-12-31T15:00:00Z')).toBe('2027-02-01T00:00:00.000Z');
    expect(nextMonth('2026-01-31T01:00:00Z')).toBe('2026-02-01T00:00:00.000Z');
    mock = reviewMock(mock, uid, '2026-10-01T00:00:00Z');
    expect(proposal(mock.state, 'ready').status).toBe('pending');
  });
  it('snoozes until next Monday in JST without changing the task', () => {
    let mock = setup(); const p = proposal(mock.state, 'ready'); const before = structuredClone(mock.tasks);
    mock = actMock(mock, uid, { action: 'next_week', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks).toEqual(before); expect(mock.state.decisions[0].reviewAt).toBe('2026-09-14T00:00:00.000Z');
    expect(nextWeek('2026-09-14T01:00:00Z')).toBe('2026-09-21T00:00:00.000Z');
    expect(mockView(mock, uid, '2026-09-14T01:00:00Z').needsReview).toBe(true);
    mock = reviewMock(mock, uid, '2026-09-14T01:00:00Z');
    expect(proposal(mock.state, 'ready').status).toBe('pending');
  });
  it('does not turn personal unneeded into shared cancellation', () => {
    let mock = setup(); const p = proposal(mock.state, 'ready');
    mock = actMock(mock, uid, { action: 'unneeded', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks.find(t => t.taskId === 'ready')!.isAbandoned).toBe(false);
    expect(mock.state.decisions[0].disposition).toBe('unneeded');
  });
  it('does not repeat a rejected proposal on unchanged information; passes correction forward', () => {
    let mock = setup(); const p = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'correct', correction: '素材を待っている', proposalId: p.id, revision: mock.state.revision }, now);
    mock = reviewMock(mock, uid, now);
    expect(proposal(mock.state, 'draft').status).toBe('pending'); expect(mock.state.decisions[0].correction).toBe('素材を待っている');
    expect(mock.state.decisions).toHaveLength(1);
  });
  it('does not repeat a bare disagreement, and undo permits a fresh review', () => {
    let mock = setup(); const p = proposal(mock.state, 'ready');
    mock = actMock(mock, uid, { action: 'correct', proposalId: p.id, revision: mock.state.revision }, now);
    mock = reviewMock(mock, uid, now); expect(proposal(mock.state, 'ready').status).toBe('rejected');
    mock = actMock(mock, uid, { action: 'undo', proposalId: p.id, revision: mock.state.revision }, now);
    mock = reviewMock(mock, uid, now); expect(proposal(mock.state, 'ready').status).toBe('pending');
  });
  it('rejects second adoption and stale revision', () => {
    const mock = setup(); const request = { action: 'accept' as const, proposalId: proposal(mock.state, 'ready').id, revision: mock.state.revision };
    const next = actMock(mock, uid, request, now);
    expect(() => actMock(next, uid, request, now)).toThrow('別の操作');
    expect(() => actMock(next, uid, { ...request, revision: next.state.revision }, now)).toThrow('処理済み');
  });
  it('rejects adoption after a source change and any other-user request', () => {
    const mock = setup(); const request = { action: 'accept' as const, proposalId: mock.state.proposals[0].id, revision: mock.state.revision };
    expect(() => actMock(changeMock(mock, 'arrival', now), uid, request, now)).toThrow('更新');
    expect(() => actMock(mock, 'other-user', request, now)).toThrow('アクセス');
  });
  it('applies and undoes shared completion with an auditable prior state', () => {
    let mock = reviewMock(changeMock(setup(), 'finished', now), uid, now);
    const p = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'complete', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks[0].isCompleted).toBe(true); expect(mock.state.history.at(-1)!.beforeTask!.isCompleted).toBe(false);
    mock = reviewMock(mock, uid, now); // terminal proposal remains available for undo
    mock = actMock(mock, uid, { action: 'undo', proposalId: p.id, revision: mock.state.revision }, now);
    expect(mock.tasks[0].isCompleted).toBe(false);
    expect(mock.state.history.at(-1)!.undone).toBe(true);
  });
  it('blocks undo when a later comment or other editor changed the task', () => {
    let mock = reviewMock(changeMock(setup(), 'finished', now), uid, now); const p = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'complete', proposalId: p.id, revision: mock.state.revision }, now);
    mock = changeMock(mock, 'policy', now);
    expect(() => actMock(mock, uid, { action: 'undo', proposalId: p.id, revision: mock.state.revision }, now)).toThrow('採用後');
  });
  it('allows personal organization for a viewer but rejects shared changes', () => {
    const mock = setup(); mock.tasks = mock.tasks.map(t => ({ ...t, canWrite: false }));
    const refreshed = reviewMock(mock, uid, now); const p = proposal(refreshed.state, 'old');
    expect(() => actMock(refreshed, uid, { action: 'cancel', proposalId: p.id, revision: refreshed.state.revision }, now)).toThrow('編集権限');
    expect(actMock(refreshed, uid, { action: 'unneeded', proposalId: p.id, revision: refreshed.state.revision }, now).state.decisions).toHaveLength(1);
  });
});

describe('Secretary actionable board', () => {
  it.each<{ name: string; patch: Partial<Interpretation> }>([
    { name: 'unanswered status', patch: { uncertainties: ['銀行側の手続き完了待ちか、未着手か'] } },
    { name: 'a confirmed question', patch: { speech: 'question' } },
    { name: 'an unconfirmed commitment', patch: { commitment: 'unknown' } },
    { name: 'an idea', patch: { speech: 'idea' } },
    { name: 'reference material', patch: { speech: 'reference' } },
  ])('excludes a previously accepted execution with $name from today’s step', ({ patch }) => {
    let mock = setup();
    const p = proposal(mock.state, 'ready');
    mock = actMock(mock, uid, { action: 'accept', proposalId: p.id, revision: mock.state.revision }, now);
    const snapshot = mockView(mock, uid, now).snapshot;
    expect(buildSecretaryBoard(mock.state, snapshot, now, 30).first?.id).toBe(p.id);

    // Existing saved records may predate the clarified presentation rules.
    Object.assign(proposal(mock.state, 'ready'), patch);
    const before = structuredClone(mock.state);
    const board = buildSecretaryBoard(mock.state, snapshot, now, 30);
    expect(board.first).toBeNull();
    expect(board.next).toEqual([]);
    expect(board.estimates).toBe(0);
    expect(mock.state).toEqual(before);
  });

  it('never allows a blocked high-priority task to outrank prerequisites', () => {
    const mock = setup(); const snapshot = mockView(mock, uid, now).snapshot;
    const p = proposal(mock.state, 'check'); p.disposition = 'execute';
    const { state } = applyAction(mock.state, snapshot, { action: 'accept', proposalId: p.id, revision: mock.state.revision }, now, 'id');
    expect(state.decisions[0].disposition).toBe('wait');
    expect(buildSecretaryBoard(state, snapshot, now, 60).first).toBeNull();
  });
  it('dependency completion invalidates a waiting proposal even without a task comment', () => {
    let mock = setup(); const p = proposal(mock.state, 'check');
    mock = actMock(mock, uid, { action: 'accept', proposalId: p.id, revision: mock.state.revision }, now);
    mock.tasks[0].isCompleted = true; mock.tasks[0].completedAt = now;
    mock = reviewMock(mock, uid, now);
    expect(proposal(mock.state, 'check').status).toBe('pending');
  });
  it('rejects unknown prerequisites and a future start', () => {
    const s = mockView(setup(), uid, now).snapshot; const task = { ...s.tasks[4], dependsOn: ['missing/x'], startDate: '2026-09-11T00:00:00Z' };
    expect(blockers(task, s, now)).toEqual(['開始日前', '前工程が未取得']);
  });
  it('shows deadlines for personal holds and capacity beyond the first item', () => {
    let mock = setup();
    for (const id of ['draft', 'ready']) {
      const p = proposal(mock.state, id);
      mock = actMock(mock, uid, { action: id === 'draft' ? 'next_week' : 'accept', proposalId: p.id, revision: mock.state.revision }, now);
    }
    const board = buildSecretaryBoard(mock.state, mockView(mock, uid, now).snapshot, now, 10);
    expect(board.due).toHaveLength(1); expect(board.overCapacity).toBe(true); expect(board.first).toBeNull();
  });
  it('does not trigger LLM repeatedly for the same past review time', () => {
    let mock = setup(); const p = proposal(mock.state, 'draft');
    mock = actMock(mock, uid, { action: 'accept', proposalId: p.id, revision: mock.state.revision }, now);
    const s = mockView(mock, uid, now).snapshot;
    expect(needsReview(mock.state, s, now)).toBe(false);
  });
  it('due-date review is computed from source, not accepted from arbitrary model dates', () => {
    const mock = setup(); const snapshot = mockView(mock, uid, now).snapshot;
    const raw: Interpretation[] = mockInterpretations(snapshot); raw[0].review = { kind: 'due_date', leadDays: 1 };
    const state = mergeReview({ ...mock.state, proposals: [] }, snapshot, raw, now, 'run');
    expect(state.proposals[0].reviewAt).toBe('2026-09-09T00:00:00.000Z');
  });
});
