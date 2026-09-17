'use client';
import { completionBlockReason } from './completion';
import { repeatMockTask } from './recurrenceClient';
import type { Task } from '@/types';
import { ORGANIZATION_MOCK_PROJECT, mutateOrganizationMock, type OrganizationMock } from './organizationMock';
import { completesCriterion, evidenceRuleVersion, expectedDateSchedule, reminderDue, requiredChildrenState, selectEvidence, validRule } from './automationEngine';
import { hasAmbiguousEvidenceRevision } from './automationEvidenceRevision';
import { STAGE_LABELS, type AllChildrenCompletionPolicy, type AutomationState, type AutomationView, type TaskEvidence, type TaskEvidenceRule } from './automationTypes';
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
const version = (task: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(task).filter(([k]) => k !== 'automation')));
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const parentVersion = (task: Record<string, unknown>) => JSON.stringify(canonical(Object.fromEntries(Object.entries(task).filter(([key]) => !['completionPolicy', 'automation'].includes(key)))));
function writeLog(state: OrganizationMock, uid: string, taskId: string, text: string, now: string) {
  state.activityLogs.push({ id: crypto.randomUUID(), projectId: ORGANIZATION_MOCK_PROJECT, targetId: taskId, targetType: 'task', targetName: state.data.tasks[taskId].title,
    userId: uid, userName: '架空の自動更新', action: 'update', createdAt: new Date(now), changes: [{ field: '確認結果', newValue: text }] });
}
function parents(work: OrganizationMock, now: string) {
  const tasks = Object.entries(work.data.tasks).map(([id, task]) => ({ ...task, id } as unknown as Task));
  for (const task of tasks) {
    if (task.parentTaskId || task.taskKind === 'review_request' || task.isArchived || task.isAbandoned) continue;
    const result = requiredChildrenState(task, tasks.filter(child => child.parentTaskId === task.id)); if (!result) continue;
    const raw = work.data.tasks[task.id];
    const policy = task.completionPolicy!;
    const owned = policy.completedByAutomation && policy.completedVersion === parentVersion(raw);
    if (result.complete && !raw.isCompleted && !policy.completedByAutomation || !result.complete && owned && raw.isCompleted) {
      if (result.complete && completionBlockReason(task,tasks)) continue;
      if (result.complete) repeatMockTask(work, task);
      raw.isCompleted = result.complete; raw.completedAt = result.complete ? new Date(now) : null; raw.updatedAt = new Date(now);
      const nextPolicy = { ...policy, completedByAutomation: result.complete };
      if (result.complete) nextPolicy.completedVersion = parentVersion(raw);
      else delete nextPolicy.completedVersion;
      raw.completionPolicy = nextPolicy;
      writeLog(work, policy.grantedBy, task.id, result.complete ? '必要な全員の完了条件が成立しました。' : '取消により全員条件が成立しなくなりました。', now);
    }
  }
}
export async function mockAutomationRequest(uid: string, body?: Record<string, unknown>): Promise<AutomationView> {
  return mutateOrganizationMock(ORGANIZATION_MOCK_PROJECT, work => {
    const state: AutomationState = work.automationStates?.[uid] ?? { uid, automationEnabled: false, revision: 0, grants: [], reminders: [] };
    const now = new Date().toISOString();
    if (body?.action === 'save') {
      const rule = body.rule as TaskEvidenceRule; const task = work.data.tasks[rule.taskId];
      if (!validRule(rule) || !task || (!rule.order && (!Array.isArray(task.assigneeIds) || task.assigneeIds.length !== 1))) throw new Error('対象・条件を確認してください。');
      if (rule.enabled && (task.parentTaskId || task.taskKind === 'review_request')) throw new Error('自動確認は親タスクで設定してください。');
      if (body.revision !== state.revision) throw new Error('設定が変わりました。');
      const old = state.grants.find(g => g.rule.taskId === rule.taskId);
      const identityChanged = old && evidenceRuleVersion(old.rule) !== evidenceRuleVersion(rule);
      const editedAfterGrant = old && old.expectedTaskVersion !== version(task);
      state.grants = [...state.grants.filter(g => g !== old), { rule, uid, grantedAt: now, notBefore: iso(task.createdAt) ?? now,
        connectionEpoch: 'mock', expectedTaskVersion: version(task), check: rule.enabled ? 'unconfirmed' : 'revoked', checkedAt: null, reason: rule.enabled ? '架空の根拠を確認します。' : '自動更新を解除しました。',
        latestEvidenceAt: identityChanged ? null : old?.latestEvidenceAt ?? null, stage: identityChanged ? null : old?.stage ?? null, ownedCompletion: identityChanged || editedAfterGrant ? false : old?.ownedCompletion ?? false, records: old?.records ?? [] }];
    }
    if (body?.action === 'evidence') {
      const evidence = body.evidence as TaskEvidence;
      work.automationEvidence ??= {}; work.automationEvidence[uid] = [...(work.automationEvidence[uid] ?? []).filter(old => old.source !== evidence.source || old.id !== evidence.id), evidence];
    }
    if (body?.action === 'run' || body?.action === 'evidence') for (const grant of state.grants.filter(g => g.rule.enabled)) {
      const task = work.data.tasks[grant.rule.taskId]; grant.checkedAt = now;
      if (task?.parentTaskId || task?.taskKind === 'review_request') {grant.check='conflict';grant.reason='以前の設定を保持しています。自動確認は親タスクで扱います。';continue;}
      if (!task || version(task) !== grant.expectedTaskVersion) { grant.check = 'conflict'; grant.reason = '後からの編集を保持しています。'; continue; }
      if (hasAmbiguousEvidenceRevision(grant, work.automationEvidence?.[uid] ?? [])) {
        grant.check = 'conflict'; grant.reason = '反映済みの根拠が訂正されています。確定状態を保持して自動更新を停止しています。';
        task.automation = { ...(task.automation as object ?? {}), ownerId: uid, stage: grant.stage, check: grant.check, checkedAt: now, evidenceAt: grant.latestEvidenceAt };
        continue;
      }
      let result = selectEvidence(grant, work.automationEvidence?.[uid] ?? [], now);
      while (result) {
        const reason=completesCriterion(grant.rule.criterion,result.stage) ? completionBlockReason({...task,id:grant.rule.taskId,projectId:ORGANIZATION_MOCK_PROJECT} as Task,Object.entries(work.data.tasks).map(([id,t])=>({...t,id,projectId:ORGANIZATION_MOCK_PROJECT} as Task))) : null;
        if(reason){grant.check='conflict';grant.reason=reason;break;}
        const schedule = result.expectedDate && grant.rule.allowExpectedDate ? expectedDateSchedule({ startDate: iso(task.startDate), dueDate: iso(task.dueDate), durationDays: typeof task.durationDays === 'number' ? task.durationDays : null, isDueDateFixed: !!task.isDueDateFixed }, result.expectedDate) : null;
        if (schedule && !schedule.ok) {
          grant.check = 'conflict'; grant.reason = schedule.reason;
          task.automation = { ...(task.automation as object ?? {}), ownerId: uid, stage: grant.stage, check: grant.check, checkedAt: now, evidenceAt: grant.latestEvidenceAt };
          break;
        }
        const before = { ...(grant.rule.order?{automation:structuredClone(task.automation as import('./automationTypes').TaskAutomationSummary??null)}:{}), isCompleted: !!task.isCompleted, completedAt: iso(task.completedAt), dueDate: iso(task.dueDate), isDueDateFixed: !!task.isDueDateFixed, durationDays: typeof task.durationDays === 'number' ? task.durationDays : null };
        if (completesCriterion(grant.rule.criterion, result.stage) && !task.isCompleted) { task.isCompleted = true; task.completedAt = new Date(now); grant.ownedCompletion = true; }
        if (['cancelled', 'refunded'].includes(result.stage) && grant.ownedCompletion) { task.isCompleted = false; task.completedAt = null; grant.ownedCompletion = false; }
        if (schedule?.ok) { task.dueDate = new Date(schedule.dueDate); task.isDueDateFixed = schedule.isDueDateFixed; task.durationDays = schedule.durationDays; }
        task.updatedAt = new Date(now); grant.stage = result.stage; grant.latestEvidenceAt = result.evidence.at; grant.check = 'confirmed'; grant.reason = `${STAGE_LABELS[result.stage]}を反映しました。`;
        grant.expectedTaskVersion = version(task);
        grant.records.push({ id: crypto.randomUUID(), expectedDate:result.expectedDate, ruleVersion: evidenceRuleVersion(grant.rule), at: now, source: result.evidence.source, sourceId: result.evidence.id, sourceVersion: result.evidence.version, evidenceAt: result.evidence.at,
          sourceUrl: result.evidence.url, stage: result.stage, before, after: { isCompleted: !!task.isCompleted, completedAt: iso(task.completedAt), dueDate: iso(task.dueDate), isDueDateFixed: !!task.isDueDateFixed, durationDays: typeof task.durationDays === 'number' ? task.durationDays : null }, afterVersion: grant.expectedTaskVersion, undone: false });
        task.automation = { ...(task.automation as object ?? {}), ownerId: uid, stage: grant.stage, check: grant.check, checkedAt: now, evidenceAt: grant.latestEvidenceAt, expectedDate: ['cancelled','refunded'].includes(result.stage) ? null : result.expectedDate ?? (task.automation as {expectedDate?:string})?.expectedDate ?? null };
        writeLog(work, uid, grant.rule.taskId, grant.reason, now); result = selectEvidence(grant, work.automationEvidence?.[uid] ?? [], now);
      }
    }
    for (const [id, data] of Object.entries(work.data.tasks)) if (data.isCompleted && data.recurrence) repeatMockTask(work, { ...data, id } as unknown as Task);
    const taskId = body?.taskId as string; const task = work.data.tasks[taskId];
    if (body?.action === 'policy' && task) {
      if (body.policy && (task.parentTaskId || task.taskKind === 'review_request')) throw new Error('自動確認は親タスクで設定してください。');
      if (typeof body.expectedUpdatedAt !== 'string' || body.expectedUpdatedAt !== iso(task.updatedAt)) throw new Error('親タスクが更新されています。入力を保持したまま、現在の条件・担当を確認してください。');
      let policy: Pick<AllChildrenCompletionPolicy, 'condition' | 'required'> | null = null;
      if (body.policy !== null) {
        const input = body.policy;
        if (!input || typeof input !== 'object' || Array.isArray(input) || !('condition' in input) || typeof input.condition !== 'string' || !input.condition.trim() || input.condition.length > 500 || !('required' in input) || !Array.isArray(input.required) || !input.required.length || input.required.length > 40) throw new Error('必要な各担当の個別タスクが一致しません。');
        const required = input.required.map((row: unknown) => {
          if (!row || typeof row !== 'object' || !('taskId' in row) || typeof row.taskId !== 'string' || !/^[^/]{1,200}$/.test(row.taskId) || !('assigneeId' in row) || typeof row.assigneeId !== 'string' || !/^[^/]{1,200}$/.test(row.assigneeId)) throw new Error('必要な各担当の個別タスクが一致しません。');
          return { taskId: row.taskId, assigneeId: row.assigneeId };
        });
        policy = { condition: input.condition, required };
        if (new Set(required.map(row => row.taskId)).size !== required.length || new Set(required.map(row => row.assigneeId)).size !== required.length || required.some(required => {
          const child = work.data.tasks[required.taskId];
          return required.taskId === taskId || !child || child.parentTaskId !== taskId || child.isArchived || child.isAbandoned || !Array.isArray(child.assigneeIds) || child.assigneeIds.length !== 1 || child.assigneeIds[0] !== required.assigneeId;
        })) throw new Error('必要な各担当の個別タスクが一致しません。');
      }
      task.updatedAt = new Date(Math.max(Date.parse(now), Date.parse(iso(task.updatedAt)!) + 1));
      task.completionPolicy = policy ? { ...policy, kind: 'all_required_children', grantedBy: uid, grantedAt: now } : null;
      state.reminders = state.reminders.filter(r => r.taskId !== taskId);
      if (policy) state.reminders.push({ projectId: ORGANIZATION_MOCK_PROJECT, taskId, dueDate: iso(task.dueDate) ?? '', snoozedUntil: null, notifiedSignature: null, sequence: 0 });
      writeLog(work, uid, taskId, policy ? '全員が購入したら親も完了する条件を設定' : '全員条件を解除', now);
    }
    if (body?.action === 'reminder') {
      const reminder = state.reminders.find(r => r.taskId === taskId); if (reminder) { reminder.snoozedUntil = body.until as string | null; reminder.sequence++; }
    }
    if (body?.action === 'undo' && task) {
      const grant = state.grants.find(g => g.rule.taskId === taskId); const record = grant?.records.at(-1);
      if (!record || record.id !== body.recordId || version(task) !== record.afterVersion) throw new Error('反映後に編集があるため戻せません。');
      Object.assign(task, record.before, { completedAt: record.before.completedAt ? new Date(record.before.completedAt) : null, dueDate: record.before.dueDate ? new Date(record.before.dueDate) : null });
      if('automation' in record.before){task.automation={...record.before.automation,check:'conflict'};grant!.stage=record.before.automation?.stage??null;grant!.latestEvidenceAt=record.before.automation?.evidenceAt??null;}
      record.undone = true; grant!.rule.enabled = false; grant!.check = 'conflict';
      writeLog(work, uid, taskId, '自動反映を取り消しました。', now);
    }
    parents(work, now);
    for (const reminder of state.reminders) {
      const parent = work.data.tasks[reminder.taskId]; reminder.dueDate = iso(parent?.dueDate) ?? '';
      reminder.notifiedSignature = parent?.isCompleted ? null : reminderDue(reminder.dueDate, now, reminder.snoozedUntil) ? '未完了が残っています' : null;
    }
    if (body) state.revision++;
    state.automationEnabled = state.grants.some(g => g.rule.enabled) || !!state.reminders.length;
    work.automationStates = { ...work.automationStates, [uid]: state };
    return { revision: state.revision, grants: state.grants, reminders: state.reminders, backgroundConfigured: false };
  });
}
