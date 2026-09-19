import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAutomationRequest } from './automationMock';
import { ORGANIZATION_MOCK_PROJECT as projectId, organizationMockKey, readOrganizationMock, writeOrganizationMock } from './organizationMock';
import type { AllChildrenCompletionPolicy, TaskEvidenceRule } from './automationTypes';
const uid = 'e2e-mock-user';
const taskId = 'purchase-self';
const policy = { condition: '必要な全員の支払完了', required: [{ taskId, assigneeId: uid }, { taskId: 'purchase-peer', assigneeId: 'demo-colleague' }] };
const rule: TaskEvidenceRule = { projectId, taskId, enabled: true, subject: '展示会', period: '2026', person: '本人', sender: 'tickets@example.test', criterion: 'purchase', allowExpectedDate: false, sources: ['gmail'] };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T03:00:00Z'));
  localStorage.removeItem(organizationMockKey(projectId));
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, action: () => unknown) => action() } });
  const fixture = readOrganizationMock(projectId);
  for (const task of Object.values(fixture.data.tasks)) { task.createdAt = new Date('2026-09-11T00:00:00Z'); task.updatedAt = new Date('2026-09-11T00:00:00Z'); }
  writeOrganizationMock(projectId, fixture);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('isolated automation concurrency parity', () => {
  it.each([false, true])('unchecking a subtask reopens an owned parent only while its completed version is unchanged (manual edit: %s)', async manuallyEdited => {
    const work = readOrganizationMock(projectId);
    work.data.tasks['purchase-peer'].isCompleted = true;
    writeOrganizationMock(projectId, work);
    await mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy, expectedUpdatedAt: (work.data.tasks['purchase-parent'].updatedAt as Date).toISOString() });
    const checked=readOrganizationMock(projectId);checked.data.tasks[taskId].isCompleted=true;writeOrganizationMock(projectId,checked);
    vi.setSystemTime(new Date('2026-09-12T03:01:00Z'));
    await mockAutomationRequest(uid,{action:'run'});
    const completed = readOrganizationMock(projectId);
    expect(completed.data.tasks['purchase-parent'].isCompleted).toBe(true);
    expect((completed.data.tasks['purchase-parent'].completionPolicy as AllChildrenCompletionPolicy).completedVersion).toBeTruthy();
    if (manuallyEdited) {
      completed.data.tasks['purchase-parent'].title = '手編集した親タイトル';
      completed.data.tasks['purchase-parent'].updatedAt = new Date('2026-09-12T03:02:00Z');
      writeOrganizationMock(projectId, completed);
    }
    const beforeCancel = readOrganizationMock(projectId);
    vi.setSystemTime(new Date('2026-09-12T04:00:00Z'));
    const unchecked=readOrganizationMock(projectId);unchecked.data.tasks[taskId].isCompleted=false;writeOrganizationMock(projectId,unchecked);
    await mockAutomationRequest(uid,{action:'run'});
    const after = readOrganizationMock(projectId);
    expect(after.data.tasks[taskId].isCompleted).toBe(false);
    expect(after.data.tasks['purchase-parent'].isCompleted).toBe(manuallyEdited);
    if (manuallyEdited) {
      expect(after.data.tasks['purchase-parent']).toEqual(beforeCancel.data.tasks['purchase-parent']);
      expect(after.activityLogs.filter(log => log.targetId === 'purchase-parent')).toEqual(beforeCancel.activityLogs.filter(log => log.targetId === 'purchase-parent'));
    } else {
      expect(after.data.tasks['purchase-parent'].completedAt).toBeNull();
      expect(after.data.tasks['purchase-parent'].completionPolicy).toMatchObject({ completedByAutomation: false });
      expect(after.data.tasks['purchase-parent'].completionPolicy).not.toHaveProperty('completedVersion');
    }
  });
  it('does not claim a manually reopened parent while all children remain complete', async () => {
    const work = readOrganizationMock(projectId);
    work.data.tasks[taskId].isCompleted = true; work.data.tasks['purchase-peer'].isCompleted = true;
    writeOrganizationMock(projectId, work);
    await mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy, expectedUpdatedAt: (work.data.tasks['purchase-parent'].updatedAt as Date).toISOString() });
    const completed = readOrganizationMock(projectId);
    completed.data.tasks['purchase-parent'].isCompleted = false; completed.data.tasks['purchase-parent'].completedAt = null;
    writeOrganizationMock(projectId, completed);
    await mockAutomationRequest(uid, { action: 'run' });
    expect(readOrganizationMock(projectId).data.tasks['purchase-parent']).toEqual(completed.data.tasks['purchase-parent']);
  });
  it.each([undefined, false, true, 0, '', [], {}, { condition: 1, required: [] }])('rejects malformed policy input without removing an existing mock policy: %j', async input => {
    const parent = readOrganizationMock(projectId).data.tasks['purchase-parent'];
    await mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy, expectedUpdatedAt: (parent.updatedAt as Date).toISOString() });
    const before = readOrganizationMock(projectId);
    await expect(mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy: input, expectedUpdatedAt: (before.data.tasks['purchase-parent'].updatedAt as Date).toISOString() })).rejects.toThrow();
    expect(readOrganizationMock(projectId)).toEqual(before);
  });
  it('fixes an expected date, reconciles its duration, and restores both on undo', async () => {
    const standalone=readOrganizationMock(projectId);standalone.data.tasks[taskId].parentTaskId=null;writeOrganizationMock(projectId,standalone);
    const work = readOrganizationMock(projectId);
    Object.assign(work.data.tasks[taskId], { startDate: new Date('2026-09-12T00:00:00+09:00'), dueDate: new Date('2026-09-13T00:00:00+09:00'), durationDays: 2, isDueDateFixed: false });
    writeOrganizationMock(projectId, work);
    const initial = await mockAutomationRequest(uid);
    await mockAutomationRequest(uid, { action: 'save', revision: initial.revision, rule: { ...rule, allowExpectedDate: true } });
    const applied = await mockAutomationRequest(uid, { action: 'evidence', evidence: { id: 'eta', version: '1', source: 'gmail', at: new Date().toISOString(), text: '展示会 2026 本人 到着予定：2026年9月15日。', sender: rule.sender, authorId: uid, url: '#mock' } });
    const task = readOrganizationMock(projectId).data.tasks[taskId];
    expect(task).toMatchObject({ isDueDateFixed: true, durationDays: 4 });
    expect((task.dueDate as Date).toISOString()).toBe('2026-09-15T03:00:00.000Z');
    await mockAutomationRequest(uid, { action: 'undo', taskId, recordId: applied.grants[0].records[0].id, revision: applied.revision });
    expect(readOrganizationMock(projectId).data.tasks[taskId]).toMatchObject({ dueDate: work.data.tasks[taskId].dueDate, durationDays: 2, isDueDateFixed: false });
  });
  it('holds all work state when an expected date precedes the known start', async () => {
    const standalone=readOrganizationMock(projectId);standalone.data.tasks[taskId].parentTaskId=null;writeOrganizationMock(projectId,standalone);
    const work = readOrganizationMock(projectId);
    Object.assign(work.data.tasks[taskId], { startDate: new Date('2026-09-16T00:00:00+09:00'), dueDate: new Date('2026-09-18T00:00:00+09:00'), durationDays: 3, isDueDateFixed: false });
    writeOrganizationMock(projectId, work);
    const initial = await mockAutomationRequest(uid);
    await mockAutomationRequest(uid, { action: 'save', revision: initial.revision, rule: { ...rule, allowExpectedDate: true } });
    const result = await mockAutomationRequest(uid, { action: 'evidence', evidence: { id: 'eta', version: '1', source: 'gmail', at: new Date().toISOString(), text: '展示会 2026 本人 到着予定：2026年9月15日。', sender: rule.sender, authorId: uid, url: '#mock' } });
    expect(result.grants[0]).toMatchObject({ check: 'conflict', stage: null, records: [] });
    expect(readOrganizationMock(projectId).data.tasks[taskId]).toMatchObject(work.data.tasks[taskId]);
  });
  it('rejects a stale parent policy update or removal and preserves the latest condition', async () => {
    const parent = readOrganizationMock(projectId).data.tasks['purchase-parent']; const expectedUpdatedAt = (parent.updatedAt as Date).toISOString();
    await mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy, expectedUpdatedAt });
    const after = readOrganizationMock(projectId).data.tasks['purchase-parent'];
    expect((after.updatedAt as Date).toISOString()).not.toBe(expectedUpdatedAt);
    await expect(mockAutomationRequest(uid, { action: 'policy', projectId, taskId: 'purchase-parent', policy: null, expectedUpdatedAt })).rejects.toThrow('親タスクが更新');
    expect(readOrganizationMock(projectId).data.tasks['purchase-parent']).toEqual(after);
  });
  it('retains prior completed work while a same-source edited correction is ambiguous', async () => {
    const standalone=readOrganizationMock(projectId);standalone.data.tasks[taskId].parentTaskId=null;writeOrganizationMock(projectId,standalone);
    const initial = await mockAutomationRequest(uid); await mockAutomationRequest(uid, { action: 'save', revision: initial.revision, rule });
    const evidence = { id: 'mail-1', version: '1', source: 'gmail', at: '2026-09-12T03:00:00.000Z', text: '展示会 2026 本人 購入完了。', sender: rule.sender, authorId: uid, url: '#mock' };
    const applied = await mockAutomationRequest(uid, { action: 'evidence', evidence });
    expect(applied.grants[0].records[0].ruleVersion).toBeTruthy(); expect(readOrganizationMock(projectId).data.tasks[taskId].isCompleted).toBe(true);
    vi.setSystemTime(new Date('2026-09-12T04:00:00Z'));
    const corrected = await mockAutomationRequest(uid, { action: 'evidence', evidence: { ...evidence, version: '2', at: '2026-09-12T04:00:00.000Z', text: '展示会 2026 本人 訂正：購入はまだ確認できません。' } });
    expect(corrected.grants[0].check).toBe('conflict'); expect(corrected.grants[0].records).toHaveLength(1);
    expect(readOrganizationMock(projectId).data.tasks[taskId].isCompleted).toBe(true);
  });
});

it('rejects subtask-only automation settings without changing stored work',async()=>{
 const before=readOrganizationMock(projectId);const revision=before.automationStates?.[uid]?.revision??0;
 await expect(mockAutomationRequest(uid,{action:'save',revision,rule})).rejects.toThrow('親タスク');expect(readOrganizationMock(projectId)).toEqual(before);
});
