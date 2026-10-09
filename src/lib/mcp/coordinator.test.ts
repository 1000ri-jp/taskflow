// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { taskFirestore } from './taskData.fixture';
import { readTaskData, writeTaskData, type TaskOperation, type TaskPrincipal } from './taskData';
import { applyWorkflow } from '@/lib/task/workflowRepository';
import { coordinationFingerprint } from './coordinatorProvenance';
import { COORDINATION_PILOT_PROJECT } from './coordinator';
import type { CoordinationPlan, CoordinationPolicy, CoordinationWorkInput } from './coordinatorTypes';
const fake = vi.hoisted(() => ({ db: null as unknown, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ getUser: fake.getUser }) }));
vi.mock('@/lib/task/changeStamp.server', () => ({ stampTaskWrite: (_ref: unknown, data: unknown) => data }));
let fixture: ReturnType<typeof taskFirestore>, sequence = 0;
const project = COORDINATION_PILOT_PROJECT, prefix = `projects/${project}`;
const auth = (): TaskPrincipal => ({ userId: 'ai', grantId: 'grant', expiresAt: Date.now() + 3600000, authorizationExpiresAt: Date.now() + 3600000, projectIds: [project], taskScopes: ['tasks:read', 'tasks:write'], permissions: ['tasks:read', 'tasks:write'] });
const original = new Date('2026-10-01T00:00:00Z');
const base = { projectId: project, listId: 'todo', title: '親の仕事', description: '調査して人間に確認', order: 0, assigneeIds: ['human'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: true, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, createdAt: original, updatedAt: original, createdBy: 'human' };
const task = (id = 'parent') => fixture.records.get(`${prefix}/tasks/${id}`)!;
const taskVersion = (id = 'parent') => (task(id).updatedAt as Date).toISOString();
const policy: CoordinationPolicy = { enabled: true, mode: 'active', aiMemberId: 'ai', humanReviewers: ['ai', 'human'], humans: [{ id: 'human', skills: [], availability: 'unknown' }],
  capabilities: [{ id: 'research', name: '資料調査', kinds: ['research', 'draft'], executor: 'dot_native', status: 'verified', availability: 'connected', evidence: ['Read/Write verification'], scope: { projectIds: [project], sourceIds: [] }, constraints: ['No paid services'], transport: { type: 'mcp', supported: true }, requiresHumanReview: true }], maxLeaseSeconds: 60, requireHumanReview: true };
const work: CoordinationWorkInput = { id: 'research', title: '調査', description: '資料を読んで比較', kind: 'research', assigneeType: 'ai', assigneeId: 'ai', capabilityId: 'research', dependsOn: [], acceptanceCriteria: ['実際の比較結果'] };
async function write(raw: Omit<TaskOperation, 'id'> & { id?: string }) { const output = await writeTaskData(auth(), { operations: [{ ...raw, id: raw.id ?? `operation-${++sequence}` }] }); return output.results[0]; }
async function success(raw: Parameters<typeof write>[0]) { const output = await write(raw); expect(output).toMatchObject({ ok: true }); return output.result! as Record<string, unknown>; }
async function readPlan() { return await readTaskData(auth(), { resource: 'coordination_plan', task_id: 'parent', resource_id: 'plan' }) as { item: CoordinationPlan; _version: string; materialization: { operations: TaskOperation[] } }; }
async function act(action: string, data: Record<string, unknown>, id?: string) { const current = await readPlan(); return write({ id, resource: 'coordination', action, task_id: 'parent', resource_id: 'plan', expected_version: current._version, data }); }
async function goodAct(action: string, data: Record<string, unknown>, id?: string) { const output = await act(action, data, id); expect(output).toMatchObject({ ok: true }); return output.result! as Record<string, unknown>; }
async function propose(works = [work]) {
  const context = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string; parent_version: string };
  return success({ resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'plan', expected_version: 'absent', expected_task_version: context.parent_version, data: { inputFingerprint: context.input_fingerprint, rationale: 'AIの内容理解に基づく分割', works } });
}
async function activate(works = [work]) {
  await propose(works); const before = await readPlan();
  for (const operation of before.materialization.operations) await success({ ...operation, expected_task_version: taskVersion() });
  const plan = (await readPlan()).item;
  for (const item of plan.works) if (item.dependsOn.length) await success({ resource: 'task', action: 'patch', task_id: item.taskId, expected_version: taskVersion(item.taskId), data: { dependsOnTaskIds: item.dependsOn.map(id => plan.works.find(candidate => candidate.id === id)!.taskId) } });
  await goodAct('activate', {}); return (await readPlan()).item;
}
async function claim(id = 'research') { return goodAct('claim', { work_id: id, worker_id: 'dot', lease_seconds: 30 }); }
async function requestReview(id = 'review-comment') { return success({ resource: 'comment', action: 'submit', task_id: 'parent', resource_id: id, expected_version: taskVersion(), data: { content: '実際の調査結果です', review: { content: '結果を確認してください', assigneeIds: ['ai'], dueDate: null, policy: 'all' } } }); }
beforeEach(async () => {
  fixture = taskFirestore(); fake.db = fixture.db; sequence = 0;
  vi.stubEnv('SLOWTH_MCP_OAUTH_ENABLED', 'true');
  vi.stubEnv('SLOWTH_MCP_OAUTH_ORIGIN', 'https://slowth.example.test');
  vi.stubEnv('SLOWTH_MCP_OAUTH_ALLOWED_UID', 'ai');
  vi.stubEnv('SLOWTH_MCP_OAUTH_CLIENT_ID', 'https://chatgpt.com/oauth/client.json');
  vi.stubEnv('SLOWTH_MCP_OAUTH_REDIRECT_URI', 'https://chatgpt.com/connector_platform_oauth_redirect');
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true');
  vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', project);
  vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'true');
  fake.getUser.mockReset().mockResolvedValue({ disabled: false, emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: '1970-01-01T00:00:00.000Z' });
  for (const [path, data] of Object.entries({
    [prefix]: { memberIds: ['ai', 'human'], isArchived: false }, [`${prefix}/members/ai`]: { userId: 'ai', role: 'editor' }, [`${prefix}/members/human`]: { userId: 'human', role: 'editor' },
    'users/ai': { displayName: '*愛1号' }, 'users/human': { displayName: '人間' }, [`${prefix}/lists/todo`]: { name: '作業' }, [`${prefix}/tasks/parent`]: base,
    [`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`]: { userId: 'ai', projectId: project, mode: 'production', expiresAt: new Date(Date.now() + 3600000), taskScopes: ['tasks:read', 'tasks:write'], authTime: Math.floor(Date.now() / 1000), clientId: 'https://chatgpt.com/oauth/client.json', resource: 'https://slowth.example.test/api/mcp' },
    [`mcpOAuthState/${createHash('sha256').update('Grant:grant').digest('hex')}`]: { expiresAt: new Date(Date.now() + 3600000) },
  })) fixture.records.set(path, structuredClone(data));
  await success({ resource: 'coordination_policy', action: 'set', expected_version: 'absent', data: policy as unknown as Record<string, unknown> });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('persists AI-supplied plans across reads and materializes stable subtasks preserving parent owners/dates', async () => {
  const plan = await activate(); const parent = task(); const child = task(plan.works[0].taskId);
  expect(parent).toMatchObject({ assigneeIds: ['human'], startDate: null, dueDate: null, title: '親の仕事' });
  expect(child).toMatchObject({ title: '調査', parentTaskId: 'parent', assigneeIds: ['ai'], completionCriteria: '実際の比較結果' });
  expect((await readPlan()).item).toMatchObject({ rationale: 'AIの内容理解に基づく分割', status: 'active' });
  expect((await readTaskData(auth(), { resource: 'coordination_history', task_id: 'parent', resource_id: 'plan' }) as { items: unknown[] }).items).toHaveLength(2);
});
it('requires fresh source and ledger versions, exact replay and nonduplicate material inputs', async () => {
  const context = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string; parent_version: string };
  task().description = '人間が判断中に修正';
  expect(await write({ resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'plan', expected_version: 'absent', expected_task_version: context.parent_version, data: { inputFingerprint: context.input_fingerprint, rationale: '古い判断', works: [work] } })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
  await activate(); const current = await readPlan();
  const operation = { id: 'exact-claim', resource: 'coordination' as const, action: 'claim', task_id: 'parent', resource_id: 'plan', expected_version: current._version, data: { work_id: 'research', worker_id: 'dot' } };
  const first = await success(operation), snapshot = structuredClone([...fixture.records]);
  expect(await success(operation)).toMatchObject({ lease_token: first.lease_token, already_applied: true }); expect([...fixture.records]).toEqual(snapshot);
  expect(await write({ ...operation, data: { work_id: 'research', worker_id: 'other' } })).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  expect(await write({ ...operation, id: 'stale-claim' })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
});
it('claims once, checkpoints, rejects expired writers and recovers with a new lease after restart', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z')); fixture.records.get(`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`)!.expiresAt = new Date(Date.now() + 3600000);
  await activate(); const first = await claim();
  expect(await act('claim', { work_id: 'research', worker_id: 'other' })).toMatchObject({ ok: false, error: { code: 'LEASE_HELD' } });
  await goodAct('checkpoint', { work_id: 'research', lease_token: first.lease_token, summary: '比較資料を取得', checks: [{ name: '出典取得', passed: true, detail: '取得済み' }] });
  vi.advanceTimersByTime(61000);
  expect(await act('checkpoint', { work_id: 'research', lease_token: first.lease_token, summary: '遅い実行' })).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
  const second = await claim(); expect(second.lease_token).not.toBe(first.lease_token); expect((await readPlan()).item.works[0].checkpoint?.summary).toBe('比較資料を取得');
  expect(await act('result', { work_id: 'research', lease_token: first.lease_token, summary: '古い実行の結果' })).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
});
it('waits for a real human comment and resumes even when human shares the ai00 actor account', async () => {
  await activate(); const lease = await claim();
  await success({ resource: 'comment', action: 'submit', task_id: 'parent', resource_id: 'question', expected_version: taskVersion(), data: { content: 'どの資料を使いますか？' } });
  const question = fixture.records.get(`${prefix}/tasks/parent/comments/question`)!;
  await goodAct('wait', { work_id: 'research', lease_token: lease.lease_token, question: '資料選択', comment_id: 'question', comment_version: coordinationFingerprint(question) });
  await success({ resource: 'comment', action: 'submit', task_id: 'parent', resource_id: 'self-answer', expected_version: taskVersion(), data: { content: '自分で回答したことにする' } });
  expect(await act('resume', { work_id: 'research', answer_comment_id: 'self-answer', answer_comment_version: coordinationFingerprint(fixture.records.get(`${prefix}/tasks/parent/comments/self-answer`)!) })).toMatchObject({ ok: false, error: { code: 'HUMAN_RESPONSE_REQUIRED' } });
  const answer = { taskId: 'parent', content: '資料Aを使ってください', authorId: 'ai', attachments: [], mentions: [], createdAt: new Date(Date.now() + 100), updatedAt: new Date(Date.now() + 100) };
  fixture.records.set(`${prefix}/tasks/parent/comments/ui-answer`, answer);
  await goodAct('resume', { work_id: 'research', answer_comment_id: 'ui-answer', answer_comment_version: coordinationFingerprint(answer) });
  expect((await readPlan()).item.works[0]).toMatchObject({ status: 'ready', waiting: null, lease: null, humanEvidence: { kind: 'comment', id: 'ui-answer' } });
  await claim();
});
it('requires actual unanswered review, blocks MCP approval, and accepts human UI approval with the same UID', async () => {
  await activate(); const lease = await claim(); const review = await requestReview();
  await goodAct('result', { work_id: 'research', lease_token: lease.lease_token, summary: '比較資料と結論を記録', checks: [{ name: '出典一致', passed: true, detail: '確認済み' }], review_task_id: review.reviewTaskId });
  expect(await act('sync_human', { work_id: 'research' })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_PENDING' } });
  const parent = task(), request = (parent.reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
  expect(await write({ resource: 'workflow', action: 'apply', task_id: String(review.reviewTaskId), expected_version: request.updatedAt, data: { action: 'approve', note: 'AIが自己承認' } })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_REQUIRED' } });
  await applyWorkflow('ai', project, String(review.reviewTaskId), { id: 'human-ui-approve', action: 'approve', expectedVersion: request.updatedAt, note: '人間が画面で確認' });
  await goodAct('sync_human', { work_id: 'research' }); expect((await readPlan()).item).toMatchObject({ status: 'completed', works: [{ status: 'done', humanEvidence: { kind: 'review' } }] });
  expect(task().isCompleted).toBe(false);
});
it('rejects MCP human correction with a shared AI/reviewer UID while retaining real UI correction', async () => {
  await activate(); const lease = await claim(); const review = await requestReview();
  await goodAct('result', { work_id: 'research', lease_token: lease.lease_token, summary: '人間が確認する実成果', review_task_id: review.reviewTaskId });
  const reviewId = String(review.reviewTaskId);
  const request = (task().reviewRequests as Record<string, { updatedAt: string }>)[reviewId];
  const before = structuredClone([...fixture.records]);
  expect(await write({ resource: 'workflow', action: 'apply', task_id: reviewId, expected_version: request.updatedAt, data: { action: 'request_changes', note: 'AIが人間の修正依頼を代行' } })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_REQUIRED' } });
  expect([...fixture.records]).toEqual(before);
  await applyWorkflow('ai', project, reviewId, { id: 'human-ui-correction', action: 'request_changes', expectedVersion: request.updatedAt, note: '本人が画面から内容の改善を依頼' });
  await goodAct('sync_human', { work_id: 'research' });
  expect((task().reviewRequests as Record<string, unknown>)[reviewId]).toMatchObject({ cycle: { responses: { ai: { outcome: 'changes_requested' } } } });
  expect((await readPlan()).item.works[0]).toMatchObject({ status: 'changes_requested', executionRevision: 2, humanEvidence: { kind: 'review', id: reviewId } });
});
it('retains correction evidence and requires human re-review before releasing dependent AI work', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z')); fixture.records.get(`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`)!.expiresAt = new Date(Date.now() + 3600000);
  await activate([work, { ...work, id: 'draft', title: '文書化', kind: 'draft', dependsOn: ['research'] }]);
  expect(await act('claim', { work_id: 'draft', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_PENDING' } });
  const lease = await claim(), review = await requestReview();
  await goodAct('result', { work_id: 'research', lease_token: lease.lease_token, summary: '初回成果', review_task_id: review.reviewTaskId });
  const request = (task().reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
  await applyWorkflow('ai', project, String(review.reviewTaskId), { id: 'human-ui-fix', action: 'request_changes', expectedVersion: request.updatedAt, note: '引用箇所を増やしてください' });
  await goodAct('sync_human', { work_id: 'research' }); expect((await readPlan()).item.works[0].status).toBe('changes_requested');
  expect(await act('claim', { work_id: 'draft', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_PENDING' } });
  await claim(); expect((await readPlan()).item.works[0]).toMatchObject({ status: 'running', humanEvidence: { kind: 'review' }, checkpoint: { summary: '初回成果' } });
});
it('keeps unconnected capabilities from running and disabled policies from activating', async () => {
  const newPolicy = { ...policy, capabilities: policy.capabilities.map(capability => ({ ...capability, status: 'transport_required' as const, availability: 'local_only' as const, transport: { type: 'file_job' as const, supported: false } })) };
  const before = await readTaskData(auth(), { resource: 'coordination_policy' }) as { _version: string };
  await success({ resource: 'coordination_policy', action: 'set', expected_version: before._version, data: newPolicy as unknown as Record<string, unknown> });
  await activate(); expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'CAPABILITY_UNAVAILABLE' } });
  const current = await readTaskData(auth(), { resource: 'coordination_policy' }) as { _version: string };
  await success({ resource: 'coordination_policy', action: 'set', expected_version: current._version, data: { ...newPolicy, enabled: false } as unknown as Record<string, unknown> });
  expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'COORDINATION_PAUSED' } });
});
it('proves self writes using exact fingerprints and treats later edits by the same UID as human inputs', async () => {
  const before = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  await success({ resource: 'comment', action: 'submit', task_id: 'parent', resource_id: 'self', expected_version: taskVersion(), data: { content: 'AIの進捗だけ' } });
  const own = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  expect(own.input_fingerprint).toBe(before.input_fingerprint);
  fixture.records.get(`${prefix}/tasks/parent/comments/self`)!.content = '人間が同じアカウントで編集した依頼';
  const human = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string }; expect(human.input_fingerprint).not.toBe(before.input_fingerprint);
});
it('preserves manual child assignments and refuses conflicting plans/cycles without partial writes', async () => {
  fixture.records.set(`${prefix}/tasks/manual`, { ...base, title: '人間が担当', parentTaskId: 'parent', dueDate: new Date('2026-11-01T00:00:00Z') });
  const before = structuredClone(task('manual'));
  const bad = { ...work, taskId: 'manual' }; await expect(propose([bad])).rejects.toThrow(); expect(task('manual')).toEqual(before);
  const human: CoordinationWorkInput = { ...work, id: 'manual', title: '人間作業', kind: 'human', assigneeType: 'human', assigneeId: 'human', capabilityId: null, taskId: 'manual' };
  await activate([human]); expect(task('manual')).toEqual(before);
  expect(await write({ resource: 'workflow', action: 'apply', task_id: 'manual', expected_version: taskVersion('manual'), data: { action: 'complete' } })).toMatchObject({ ok: false, error: { code: 'HUMAN_RESPONSE_REQUIRED' } });
  await goodAct('cancel', { reason: '手動割り振りへ戻す' }); expect(task('manual')).toEqual(before); expect(task().isArchived).toBe(false);
});
it('rejects preapproved and failed results instead of claiming successful human acceptance', async () => {
  await activate(); const lease = await claim(), review = await requestReview();
  expect(await act('result', { work_id: 'research', lease_token: lease.lease_token, summary: '失敗あり', checks: [{ name: '検証', passed: false, detail: 'エラー' }], review_task_id: review.reviewTaskId })).toMatchObject({ ok: false, error: { code: 'CHECKS_FAILED' } });
  const request = (task().reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
  await applyWorkflow('ai', project, String(review.reviewTaskId), { id: 'premature-ui-response', action: 'approve', expectedVersion: request.updatedAt });
  expect(await act('result', { work_id: 'research', lease_token: lease.lease_token, summary: '事前の確認を流用', review_task_id: review.reviewTaskId })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_REQUIRED' } });
  expect((await readPlan()).item.works[0].status).toBe('running');
});

it.each(['archived', 'abandoned', 'deleted', 'reparented'] as const)('cancels an existing plan after its original parent is %s without recreating or rewriting tasks', async state => {
  const plan = await activate(), lease = await claim();
  const childBefore = structuredClone(task(plan.works[0].taskId));
  if (state === 'deleted') fixture.records.delete(`${prefix}/tasks/parent`);
  else {
    if (state === 'reparented') { task().parentTaskId = 'other-parent'; fixture.records.set(`${prefix}/tasks/other-parent`, structuredClone(base)); }
    else task()[state === 'archived' ? 'isArchived' : 'isAbandoned'] = true;
    task().updatedAt = new Date(Date.now() + 5);
  }
  const parentBefore = structuredClone(task());
  const delegationPath = `mcpCoordinationDelegations/${coordinationFingerprint([project, plan.id])}`;
  fixture.records.set(delegationPath, { projectId: project, planId: plan.id, fixtureOnly: true });
  const current = await readPlan();
  expect(await act('checkpoint', { work_id: 'research', lease_token: lease.lease_token, summary: '停止済み親への古い進捗' })).toMatchObject({ ok: false, error: { code: 'INVALID_PARENT' } });
  expect(await write({ resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'replacement', expected_version: 'absent',
    expected_task_version: original.toISOString(), data: { inputFingerprint: current.item.inputFingerprint, rationale: '停止した元の仕事を再作成', works: [work] } })).toMatchObject({ ok: false, error: { code: 'INVALID_PARENT' } });
  const operation = { id: `cancel-${state}`, resource: 'coordination' as const, action: 'cancel', task_id: 'parent', resource_id: plan.id,
    expected_version: current._version, data: { reason: '人間が元の仕事を取り下げたため作業を停止' } };
  const output = await write(operation);
  expect(output, JSON.stringify(output)).toMatchObject({ ok: true, result: { item: { status: 'cancelled', works: [{ status: 'cancelled', lease: null }] }, materialization: { operations: [] } } });
  expect(task()).toEqual(parentBefore); expect(task(plan.works[0].taskId)).toEqual(childBefore);
  expect(fixture.records.has(delegationPath)).toBe(false);
  const after = structuredClone([...fixture.records]);
  expect(await write(operation)).toMatchObject({ ok: true, result: { already_applied: true } });
  expect([...fixture.records]).toEqual(after);
  expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'INVALID_PARENT' } });
});

it('still requires the existing plan binding and current version to cancel after parent deletion', async () => {
  await activate(); fixture.records.delete(`${prefix}/tasks/parent`);
  const current = await readPlan(), before = structuredClone([...fixture.records]);
  const operation = { resource: 'coordination' as const, action: 'cancel', task_id: 'parent', resource_id: 'plan', expected_version: current._version, data: { reason: '削除後の停止' } };
  expect(await write({ ...operation, task_id: 'different-parent' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await write({ ...operation, resource_id: 'missing-plan' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await write({ ...operation, expected_version: 'absent' })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
  expect([...fixture.records]).toEqual(before);
});

it('detects human child edits, prevents competing plans, and reconciles before restarting work', async () => {
  await activate(); const first = await claim(), current = (await readPlan()).item, child = task(current.works[0].taskId);
  child.description = '人間が作業範囲を変更'; child.updatedAt = new Date(Date.now() + 5);
  expect(await act('checkpoint', { work_id: 'research', lease_token: first.lease_token, summary: '古い範囲の結果' })).toMatchObject({ ok: false, error: { code: 'COORDINATION_SOURCE_CHANGED' } });
  const source = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string; parent_version: string };
  expect(await write({ resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'competing', expected_version: 'absent', expected_task_version: source.parent_version, data: { inputFingerprint: source.input_fingerprint, rationale: '二重計画', works: [work] } })).toMatchObject({ ok: false, error: { code: 'ACTIVE_PLAN_EXISTS' } });
  await goodAct('reconcile', { inputFingerprint: source.input_fingerprint, rationale: '新しい範囲を理解した上で同じ担当を継続' });
  const second = await claim(); expect(second.lease_token).not.toBe(first.lease_token);
  expect(child.description).toBe('人間が作業範囲を変更');
  child.isCompleted = true; child.updatedAt = new Date(Date.now() + 10);
  const changed = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  await goodAct('reconcile', { inputFingerprint: changed.input_fingerprint, rationale: '人間が完了した作業を再実行しない' });
  expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'TASK_ALREADY_COMPLETED' } });
});
it('releases dependent AI work only after actual human completion, preserving that task', async () => {
  const humanWork: CoordinationWorkInput = { ...work, id: 'human-input', title: '資料を提供', kind: 'human', assigneeType: 'human', assigneeId: 'human', capabilityId: null };
  const plan = await activate([humanWork, { ...work, dependsOn: ['human-input'] }]);
  expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_PENDING' } });
  const humanTask = task(plan.works[0].taskId); humanTask.isCompleted = true; humanTask.completedAt = new Date(); humanTask.updatedAt = new Date(Date.now() + 10);
  const preserved = structuredClone(humanTask);
  await goodAct('sync_human', { work_id: 'human-input' }); await claim();
  expect(task(plan.works[0].taskId)).toEqual(preserved);
});
it('denies unapproved projects by default and allows only explicitly configured project IDs', async () => {
  const { coordinationProjectIds } = await import('./coordinator'); expect(coordinationProjectIds()).toEqual([project]);
  vi.stubEnv('SLOWTH_MCP_COORDINATION_PROJECT_IDS', ''); expect(coordinationProjectIds()).toEqual([]);
  const saved = await readTaskData(auth(), { resource: 'coordination_policy' }) as { _version: string };
  expect(await write({ resource: 'coordination_policy', action: 'set', expected_version: saved._version, data: policy as unknown as Record<string, unknown> })).toMatchObject({ ok: false, error: { code: 'PILOT_SCOPE' } });
  vi.stubEnv('SLOWTH_MCP_COORDINATION_PROJECT_IDS', project); expect(coordinationProjectIds()).toEqual([project]);
  vi.unstubAllEnvs();
});

it('reopens a completed ledger after a human corrects approval through the existing UI workflow', async () => {
  await activate(); const lease = await claim(), review = await requestReview();
  await goodAct('result', { work_id: 'research', lease_token: lease.lease_token, summary: '初回成果', review_task_id: review.reviewTaskId });
  let request = (task().reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
  await applyWorkflow('ai', project, String(review.reviewTaskId), { id: 'ui-first-approve', action: 'approve', expectedVersion: request.updatedAt });
  await goodAct('sync_human', { work_id: 'research' }); expect((await readPlan()).item.status).toBe('completed');
  request = (task().reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
  await applyWorkflow('ai', project, String(review.reviewTaskId), { id: 'ui-correct-approval', action: 'correct_approval', expectedVersion: request.updatedAt, note: '確認漏れがあった' });
  await goodAct('sync_human', { work_id: 'research' }); expect((await readPlan()).item).toMatchObject({ status: 'active', works: [{ status: 'awaiting_review' }] });
});
it('keeps original human review requirement when execution policy later loosens', async () => {
  await activate(); const lease = await claim();
  const current = await readTaskData(auth(), { resource: 'coordination_policy' }) as { _version: string };
  await success({ resource: 'coordination_policy', action: 'set', expected_version: current._version, data: { ...policy, requireHumanReview: false, capabilities: policy.capabilities.map(capability => ({ ...capability, requiresHumanReview: false })) } as unknown as Record<string, unknown> });
  expect(await act('result', { work_id: 'research', lease_token: lease.lease_token, summary: '確認を省略する' })).toMatchObject({ ok: false });
  expect((await readPlan()).item.works[0]).toMatchObject({ status: 'running', requiresHumanReview: true });
});
const localCapability = { ...policy.capabilities[0], id: 'local.codex_workspace', executor: 'local_worker' as const, scope: { projectIds: [project], sourceIds: ['worker-fixture'] }, transport: { type: 'file_job' as const, supported: true } };
const execution = { sourceId: 'worker-fixture', files: [{ path: 'example.mjs', expectedSha256: 'a'.repeat(64) }], prompt: '指定された小さな実装だけを隔離して修正し、確認する', checks: [{ type: 'node_syntax' as const, path: 'example.mjs' }], reviewerIds: ['human'] };
const localWork: CoordinationWorkInput = { ...work, capabilityId: localCapability.id, execution };
async function registerLocalPolicy() {
  const stored = await readTaskData(auth(), { resource: 'coordination_policy' }) as { _version: string };
  await success({ resource: 'coordination_policy', action: 'set', expected_version: stored._version, data: { ...policy, capabilities: [localCapability] } as unknown as Record<string, unknown> });
}
describe('authoritative worker availability through existing coordination reads', () => {
  type Availability = {
    serverNow: string; status: 'available' | 'unavailable' | 'missing';
    workers: { workerId: string; projectId: string; seenAt: string | null; expiresAt: string | null;
      status: 'fresh' | 'expired' | 'invalid'; fresh: boolean; available: boolean;
      capabilities: { capabilityId: string; sourceIds: string[] }[] }[];
  };
  const readPolicy = () => readTaskData(auth(), { resource: 'coordination_policy' }) as Promise<{ item: CoordinationPolicy; _version: string; worker_availability: Availability }>;
  const storeWorker = (overrides: Record<string, unknown> = {}, workerId = 'local') => {
    const data = { projectId: project, workerId, capabilityIds: [localCapability.id], sourceIds: ['worker-fixture'],
      seenAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 89000).toISOString(), ...overrides };
    fixture.records.set(`${prefix}/mcpCoordinationWorkers/${workerId}`, data); return data;
  };
  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z')); await registerLocalPolicy();
  });
  it('exposes the exact live capability/source before any parent or coordination plan exists', async () => {
    fixture.records.delete(`${prefix}/tasks/parent`); const heartbeat = storeWorker(); const before = structuredClone([...fixture.records]);
    const result = await readPolicy();
    expect(result.worker_availability).toEqual({ serverNow: new Date().toISOString(), status: 'available', workers: [{
      workerId: 'local', projectId: project, seenAt: heartbeat.seenAt, expiresAt: heartbeat.expiresAt,
      status: 'fresh', fresh: true, available: true, capabilities: [{ capabilityId: localCapability.id, sourceIds: ['worker-fixture'] }],
    }] });
    expect(result.item).toEqual({ ...policy, capabilities: [localCapability] }); expect([...fixture.records]).toEqual(before);
    expect([...fixture.records.keys()].some(path => path.includes('/mcpCoordinationPlans/'))).toBe(false);
  });
  it('returns the same authoritative projection in coordination_context without changing its material fingerprint', async () => {
    const before = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
    storeWorker(); const policyRead = await readPolicy();
    const context = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string; worker_availability: Availability };
    expect(context.worker_availability).toEqual(policyRead.worker_availability); expect(context.input_fingerprint).toBe(before.input_fingerprint);
  });
  it('distinguishes missing, expired at the boundary, refreshed and stopped workers', async () => {
    const { heartbeatCoordinationWorker, stopCoordinationWorker } = await import('./coordinatorTransport');
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'missing', workers: [] });
    storeWorker({ seenAt: new Date(Date.now() - 90000).toISOString(), expiresAt: new Date().toISOString() });
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ status: 'expired', fresh: false, available: false }] });
    await heartbeatCoordinationWorker(project, { worker_id: 'local', capability_ids: [localCapability.id], source_ids: ['worker-fixture'], ttl_seconds: 90 });
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'available', workers: [{ status: 'fresh', available: true }] });
    vi.advanceTimersByTime(91000);
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ status: 'expired', available: false }] });
    await stopCoordinationWorker(project, 'local'); expect((await readPolicy()).worker_availability).toMatchObject({ status: 'missing', workers: [] });
  });
  it.each([
    ['different worker ID', { workerId: 'spoofed' }],
    ['missing capability array', { capabilityIds: undefined }],
    ['malformed capability array', { capabilityIds: [localCapability.id, 17] }],
    ['malformed source array', { sourceIds: ['worker-fixture', {}] }],
    ['missing seenAt', { seenAt: null }],
    ['invalid expiry', { expiresAt: 'not-a-date' }],
    ['future observation', { seenAt: '2026-10-08T00:00:01.000Z' }],
    ['reversed interval', { seenAt: '2026-10-07T23:59:59.000Z', expiresAt: '2026-10-07T23:59:58.000Z' }],
    ['TTL below writer minimum', { expiresAt: '2026-10-08T00:00:20.000Z' }],
    ['TTL beyond writer maximum', { expiresAt: '2026-10-08T00:04:00.000Z' }],
  ])('marks %s invalid instead of claiming executable availability', async (_name, data) => {
    storeWorker(data); expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ status: 'invalid', fresh: false, available: false }] });
  });
  it('does not expose rows from a different project even when they share the requested collection', async () => {
    storeWorker({ projectId: 'other' });
    fixture.records.set('projects/other/mcpCoordinationWorkers/remote', { projectId: 'other', workerId: 'remote', capabilityIds: [localCapability.id], sourceIds: ['worker-fixture'] });
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'missing', workers: [] });
  });
  it('projects only exact capability/source intersections and never crosses capability scopes', async () => {
    const saved = await readPolicy(); const secondary = { ...localCapability, id: 'local.secondary', scope: { projectIds: [project], sourceIds: ['other-fixture'] } };
    await success({ resource: 'coordination_policy', action: 'set', expected_version: saved._version, data: { ...saved.item, capabilities: [localCapability, secondary] } as unknown as Record<string, unknown> });
    storeWorker({ capabilityIds: [localCapability.id, secondary.id, 'unsupported'], sourceIds: ['worker-fixture', 'other-fixture', 'unregistered-source'] });
    const result = (await readPolicy()).worker_availability;
    expect(result).toMatchObject({ status: 'available', workers: [{ capabilities: [
      { capabilityId: localCapability.id, sourceIds: ['worker-fixture'] }, { capabilityId: secondary.id, sourceIds: ['other-fixture'] },
    ] }] });
    expect(JSON.stringify(result)).not.toContain('unsupported'); expect(JSON.stringify(result)).not.toContain('unregistered-source');
    storeWorker({ capabilityIds: [localCapability.id], sourceIds: ['other-fixture'] });
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ fresh: true, available: false, capabilities: [] }] });
  });
  it.each([
    ['unverified capability', { status: 'transport_required' }],
    ['disconnected capability', { availability: 'local_only' }],
    ['unsupported transport', { transport: { type: 'file_job', supported: false } }],
    ['native executor', { executor: 'dot_native' }],
    ['different project scope', { scope: { projectIds: ['other'], sourceIds: ['worker-fixture'] } }],
  ])('does not offer a fresh worker for %s', async (_name, data) => {
    const stored = fixture.records.get(`${prefix}/mcpCoordination/policy`)!;
    stored.capabilities = [{ ...localCapability, ...data }]; storeWorker();
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ fresh: true, available: false, capabilities: [] }] });
  });
  it.each([{ enabled: false }, { mode: 'propose' }])('keeps a live worker unavailable when policy prevents active execution: %j', async data => {
    Object.assign(fixture.records.get(`${prefix}/mcpCoordination/policy`)!, data); storeWorker();
    expect((await readPolicy()).worker_availability).toMatchObject({ status: 'unavailable', workers: [{ fresh: true, available: false }] });
  });
  it('whitelists public heartbeat fields without leaking grants, delegation or lease values', async () => {
    storeWorker({ grantId: 'private-grant-value', coordinationDelegationId: 'private-delegation-value', lease_token: 'private-lease-value',
      principal: { accessToken: 'private-token-value' }, privatePath: 'mcpCoordinationDelegations/private-record' });
    fixture.records.set('mcpCoordinationDelegations/private-record', { grantId: 'private-grant-value', lease_token: 'private-lease-value' });
    for (const args of [{ resource: 'coordination_policy' }, { resource: 'coordination_context', task_id: 'parent' }]) {
      const output = await readTaskData(auth(), args) as { worker_availability: Availability }; const serialized = JSON.stringify(output);
      for (const secret of ['private-grant-value', 'private-delegation-value', 'private-lease-value', 'private-token-value', 'mcpCoordinationDelegations/private-record']) expect(serialized).not.toContain(secret);
      expect(Object.keys(output.worker_availability.workers[0]).sort()).toEqual(['available', 'capabilities', 'expiresAt', 'fresh', 'projectId', 'seenAt', 'status', 'workerId']);
    }
  });
  it('keeps stored policy and its optimistic version stable across heartbeat updates and expiry', async () => {
    const initial = await readPolicy(); const stored = structuredClone(fixture.records.get(`${prefix}/mcpCoordination/policy`));
    storeWorker(); const fresh = await readPolicy(); vi.advanceTimersByTime(91000); const expired = await readPolicy();
    expect(fresh.worker_availability.status).toBe('available'); expect(expired.worker_availability.status).toBe('unavailable');
    expect(fresh._version).toBe(initial._version); expect(expired._version).toBe(initial._version);
    expect(fixture.records.get(`${prefix}/mcpCoordination/policy`)).toEqual(stored);
    await success({ resource: 'coordination_policy', action: 'set', expected_version: initial._version, data: { ...initial.item, mode: 'propose' } as unknown as Record<string, unknown> });
  });
  it.each(['scope', 'permission', 'project', 'membership', 'ai-setting', 'archived', 'expired'])('retains existing %s authorization before exposing worker metadata', async restriction => {
    storeWorker(); let principal = auth();
    if (restriction === 'scope') principal = { ...principal, taskScopes: [] };
    if (restriction === 'permission') principal = { ...principal, permissions: [] };
    if (restriction === 'project') principal = { ...principal, projectIds: ['other'] };
    if (restriction === 'membership') fixture.records.delete(`${prefix}/members/ai`);
    if (restriction === 'ai-setting') fixture.records.set('users/ai/settings/aiSettings', { allowedProjectIds: ['other'] });
    if (restriction === 'archived') fixture.records.get(prefix)!.isArchived = true;
    if (restriction === 'expired') principal = { ...principal, authorizationExpiresAt: Date.now() };
    const before = structuredClone([...fixture.records]);
    await expect(readTaskData(principal, { project_id: project, resource: 'coordination_policy' })).rejects.toMatchObject({ code: restriction === 'scope' ? 'INSUFFICIENT_SCOPE' : restriction === 'expired' ? 'AUTHORIZATION_EXPIRED' : 'FORBIDDEN' });
    expect([...fixture.records]).toEqual(before);
  });
  it('fails explicitly when the worker collection exceeds the complete-read bound', async () => {
    for (let index = 0; index <= 100; index++) storeWorker({}, `worker-${String(index).padStart(3, '0')}`);
    await expect(readPolicy()).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });
  it('does not substitute a successful missing projection for a heartbeat query outage', async () => {
    const originalDb = fixture.db;
    fake.db = { ...originalDb, doc: (path: string) => {
      const ref = originalDb.doc(path); if (path !== prefix) return ref;
      return { ...ref, collection: (name: string) => {
        const query = ref.collection(name); if (name !== 'mcpCoordinationWorkers') return query;
        return { ...query, limit: () => ({ ...query, get: async () => { throw new Error('private database failure detail'); } }) };
      } };
    } };
    await expect(readPolicy()).rejects.toMatchObject({ code: 'WORKER_AVAILABILITY_UNAVAILABLE', status: 503 });
    await expect(readPolicy()).rejects.not.toThrow('private database failure detail');
  });
});
it('persists only the real delegated grant privately and rechecks grant revocation on every generic read', async () => {
  const { loadCoordinationDelegation } = await import('./coordinatorTransport');
  await registerLocalPolicy(); await activate([localWork]);
  const delegated = await loadCoordinationDelegation(project, 'plan'); expect(delegated).toMatchObject({ userId: 'ai', grantId: 'grant', projectIds: [project], taskScopes: ['tasks:read', 'tasks:write'], coordinationDelegationId: expect.any(String) });
  const privatePaths = [...fixture.records.keys()].filter(path => path.startsWith('mcpCoordinationDelegations/')); expect(privatePaths).toHaveLength(1);
  const output = JSON.stringify(await readTaskData(auth(), { resource: 'coordination_plan', task_id: 'parent', resource_id: 'plan' }));
  expect(output).not.toContain('grantId'); expect(output).not.toContain('coordinationDelegationId');
  expect(JSON.stringify([...fixture.records].filter(([path]) => path.startsWith(prefix)))).not.toContain('principalFingerprint');
  await readTaskData(delegated, { resource: 'task', task_id: 'parent' });
  fixture.records.delete(`mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`);
  await expect(readTaskData(delegated, { resource: 'task', task_id: 'parent' })).rejects.toThrow('元のOAuth');
  await expect(loadCoordinationDelegation(project, 'plan')).rejects.toThrow('元のOAuth');
});
it('rejects expired or cancelled private delegations without minting replacement login grants', async () => {
  const { loadCoordinationDelegation } = await import('./coordinatorTransport');
  await registerLocalPolicy(); await activate([localWork]); const delegated = await loadCoordinationDelegation(project, 'plan');
  const privatePath = `mcpCoordinationDelegations/${delegated.coordinationDelegationId}`;
  const saved = fixture.records.get(privatePath)!; saved.expiresAt = Date.now() - 1;
  await expect(loadCoordinationDelegation(project, 'plan')).rejects.toThrow('期限');
  await expect(readTaskData(delegated, { resource: 'task', task_id: 'parent' })).rejects.toThrow('期限');
  saved.expiresAt = Date.now() + 60000;
  await goodAct('cancel', { reason: '人間が実行を取消' }); expect(fixture.records.has(privatePath)).toBe(false);
  await expect(readTaskData(delegated, { resource: 'task', task_id: 'parent' })).rejects.toThrow('取消');
  expect([...fixture.records.keys()].filter(path => path.startsWith('mcpOAuthGrants/'))).toHaveLength(1);
});
it.each(['source-grant-removed', 'source-grant-expired', 'identity-disabled', 'identity-revoked', 'oauth-disabled', 'pinned-user-changed', 'auth-time-missing', 'client-changed', 'resource-changed'])('rejects delegated reads and writes after %s even when the binding remains', async restriction => {
  const { loadCoordinationDelegation } = await import('./coordinatorTransport');
  await registerLocalPolicy(); await activate([localWork]); const delegated = await loadCoordinationDelegation(project, 'plan');
  const bindingPath = `mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`;
  const sourcePath = `mcpOAuthState/${createHash('sha256').update('Grant:grant').digest('hex')}`;
  if (restriction === 'source-grant-removed') fixture.records.delete(sourcePath);
  if (restriction === 'source-grant-expired') fixture.records.get(sourcePath)!.expiresAt = new Date(Date.now() - 1);
  if (restriction === 'identity-disabled') fake.getUser.mockResolvedValue({ disabled: true });
  if (restriction === 'identity-revoked') fake.getUser.mockResolvedValue({ disabled: false, emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: new Date(Date.now() + 1000).toISOString() });
  if (restriction === 'oauth-disabled') vi.stubEnv('SLOWTH_MCP_OAUTH_ENABLED', 'false');
  if (restriction === 'pinned-user-changed') vi.stubEnv('SLOWTH_MCP_OAUTH_ALLOWED_UID', 'other-user');
  if (restriction === 'auth-time-missing') delete fixture.records.get(bindingPath)!.authTime;
  if (restriction === 'client-changed') fixture.records.get(bindingPath)!.clientId = 'https://other.example/client.json';
  if (restriction === 'resource-changed') fixture.records.get(bindingPath)!.resource = 'https://other.example/api/mcp';
  const before = structuredClone([...fixture.records]);
  await expect(readTaskData(delegated, { resource: 'task', task_id: 'parent' })).rejects.toMatchObject({ code: 'DELEGATION_REVOKED' });
  await expect(writeTaskData(delegated, { operations: [{ id: 'revoked-write', resource: 'task', action: 'patch', task_id: 'parent', expected_version: taskVersion(), data: { title: '拒否される更新' } }] })).rejects.toMatchObject({ code: 'DELEGATION_REVOKED' });
  await expect(loadCoordinationDelegation(project, 'plan')).rejects.toMatchObject({ code: 'DELEGATION_REVOKED' });
  expect(fixture.records.has(bindingPath)).toBe(true); expect([...fixture.records]).toEqual(before);
});
it('rechecks the source grant inside the write transaction after delegated preflight succeeds', async () => {
  const { loadCoordinationDelegation } = await import('./coordinatorTransport');
  await registerLocalPolicy(); await activate([localWork]); const delegated = await loadCoordinationDelegation(project, 'plan');
  const sourcePath = `mcpOAuthState/${createHash('sha256').update('Grant:grant').digest('hex')}`;
  const before = structuredClone(task()); const runTransaction = fixture.db.runTransaction;
  fixture.db.runTransaction = async callback => { fixture.records.delete(sourcePath); return runTransaction(callback); };
  const output = await writeTaskData(delegated, { operations: [{ id: 'race-revoked-write', resource: 'task', action: 'patch', task_id: 'parent', expected_version: taskVersion(), data: { title: '保存してはいけない更新' } }] });
  expect(output.results[0]).toMatchObject({ ok: false, error: { code: 'DELEGATION_REVOKED' } });
  expect(task()).toEqual(before);
  expect([...fixture.records.keys()].some(path => path.includes('race-revoked-write'))).toBe(false);
});
it('checks live registered local worker scope before claim, checkpoint and results', async () => {
  const { heartbeatCoordinationWorker, stopCoordinationWorker } = await import('./coordinatorTransport');
  await registerLocalPolicy(); await activate([localWork]);
  expect(await act('claim', { work_id: 'research', worker_id: 'local' })).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
  await expect(heartbeatCoordinationWorker(project, { worker_id: 'local', capability_ids: [localCapability.id], source_ids: ['unregistered-source'] })).rejects.toThrow('範囲');
  await heartbeatCoordinationWorker(project, { worker_id: 'local', capability_ids: [localCapability.id], source_ids: ['worker-fixture'], ttl_seconds: 90 });
  const lease = await goodAct('claim', { work_id: 'research', worker_id: 'local' });
  await goodAct('checkpoint', { work_id: 'research', lease_token: lease.lease_token, summary: '隔離したファイルを確認' });
  fixture.records.get(`${prefix}/mcpCoordinationWorkers/local`)!.expiresAt = new Date(Date.now() - 1).toISOString();
  expect(await act('checkpoint', { work_id: 'research', lease_token: lease.lease_token, summary: '切断後の成果' })).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
  await heartbeatCoordinationWorker(project, { worker_id: 'local', capability_ids: [localCapability.id], source_ids: ['worker-fixture'], ttl_seconds: 90 });
  await stopCoordinationWorker(project, 'local'); expect(fixture.records.has(`${prefix}/mcpCoordinationWorkers/local`)).toBe(false);
  expect(await act('result', { work_id: 'research', lease_token: lease.lease_token, summary: '停止後の結果' })).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
});
it('rejects unregistered execution sources, arbitrary check commands and unselected path inputs', async () => {
  await registerLocalPolicy();
  const before = [...fixture.records.keys()];
  await expect(propose([{ ...localWork, execution: { ...execution, sourceId: 'outside-project' } }])).rejects.toThrow();
  await expect(propose([{ ...localWork, execution: { ...execution, files: [{ path: '../outside', expectedSha256: null }] } }])).rejects.toThrow();
  await expect(propose([{ ...localWork, execution: { ...execution, files: [{ path: '.env.local', expectedSha256: null }] } }])).rejects.toThrow();
  await expect(propose([{ ...localWork, execution: { ...execution, checks: [{ type: 'shell' as 'node_syntax', path: 'example.mjs' }] } }])).rejects.toThrow();
  await expect(propose([{ ...localWork, execution: { ...execution, checks: [{ type: 'node_test', path: 'unselected.test.mjs' }] } }])).rejects.toThrow();
  expect([...fixture.records.keys()]).toEqual(before);
});
it('invalidates transitive reviewed results when a human prerequisite reopens, preserving manual tasks and artifacts', async () => {
  const humanWork: CoordinationWorkInput = { ...work, id: 'human-input', title: '人間が資料を用意', kind: 'human', assigneeType: 'human', assigneeId: 'human', capabilityId: null };
  const plan = await activate([humanWork, { ...work, dependsOn: ['human-input'] }, { ...work, id: 'draft', title: '資料を文書化', kind: 'draft', dependsOn: ['research'] }]);
  const humanTaskId = plan.works[0].taskId;
  await applyWorkflow('human', project, humanTaskId, { id: 'ui-prepare-complete', action: 'complete', expectedVersion: taskVersion(humanTaskId) });
  await goodAct('sync_human', { work_id: 'human-input' });
  for (const id of ['research', 'draft']) {
    const lease = await claim(id), review = await requestReview(`original-${id}`);
    await goodAct('result', { work_id: id, lease_token: lease.lease_token, summary: `最初の資料に基づく${id}結果`, artifacts: [{ label: '保持する成果物', url: `https://example.test/${id}.txt` }], review_task_id: review.reviewTaskId });
    const request = (task().reviewRequests as Record<string, { updatedAt: string }>)[String(review.reviewTaskId)];
    await applyWorkflow('ai', project, String(review.reviewTaskId), { id: `ui-approve-${id}`, action: 'approve', expectedVersion: request.updatedAt });
    await goodAct('sync_human', { work_id: id });
  }
  expect((await readPlan()).item.status).toBe('completed');
  await applyWorkflow('human', project, humanTaskId, { id: 'ui-prerequisite-reopen', action: 'reopen', expectedVersion: taskVersion(humanTaskId) });
  task(humanTaskId).description = '前提資料の内容を変更'; task(humanTaskId).updatedAt = new Date(Date.now() + 5);
  const preservedHuman = structuredClone(task(humanTaskId)), preservedResearch = structuredClone(task(plan.works[1].taskId));
  await goodAct('sync_human', { work_id: 'human-input' });
  const invalidated = (await readPlan()).item;
  expect(invalidated).toMatchObject({ status: 'active', works: [{ status: 'ready' }, { status: 'changes_requested', executionRevision: 2, needsReconciliation: true, reviewTaskId: null }, { status: 'changes_requested', executionRevision: 2, needsReconciliation: true, reviewTaskId: null }] });
  expect(invalidated.works[1].checkpoint).toMatchObject({ summary: '最初の資料に基づくresearch結果', artifacts: [{ url: 'https://example.test/research.txt' }] });
  expect(invalidated.works[1].previousReviewTaskIds).toEqual(['review-original-research']);
  expect(task(humanTaskId)).toEqual(preservedHuman); expect(task(plan.works[1].taskId)).toEqual(preservedResearch);
  expect(await act('claim', { work_id: 'research', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'RECONCILIATION_REQUIRED' } });
  await applyWorkflow('human', project, humanTaskId, { id: 'ui-prerequisite-recomplete', action: 'complete', expectedVersion: taskVersion(humanTaskId) });
  await goodAct('sync_human', { work_id: 'human-input' }); expect((await readPlan()).item.status).toBe('active');
  expect(await act('sync_human', { work_id: 'research' })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_PENDING' } });
  const source = await readTaskData(auth(), { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  await goodAct('reconcile', { inputFingerprint: source.input_fingerprint, rationale: '更新された前提資料を読み、両成果を作り直して確認依頼する' });
  const lease = await claim();
  expect(await act('result', { work_id: 'research', lease_token: lease.lease_token, summary: '古い確認の流用', review_task_id: 'review-original-research' })).toMatchObject({ ok: false, error: { code: 'HUMAN_REVIEW_REQUIRED' } });
  const fresh = await requestReview('fresh-research');
  await goodAct('result', { work_id: 'research', lease_token: lease.lease_token, summary: '変更後の資料に基づく新しい結果', review_task_id: fresh.reviewTaskId });
  expect(await act('claim', { work_id: 'draft', worker_id: 'dot' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_PENDING' } });
  expect((await readPlan()).item.status).toBe('active');
});
it('keeps authorized background jobs alive after bearer expiry but stops at original grant expiry', async () => {
  const { loadCoordinationDelegation } = await import('./coordinatorTransport');
  vi.useFakeTimers(); const capturedAt = Date.now();
  const shortAuth = { ...auth(), expiresAt: capturedAt + 1000, authorizationExpiresAt: capturedAt + 10000 };
  const grantPath = `mcpOAuthGrants/${createHash('sha256').update('grant').digest('hex')}`;
  fixture.records.get(grantPath)!.expiresAt = new Date(capturedAt + 5000);
  await registerLocalPolicy();
  const context = await readTaskData(shortAuth, { resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string; parent_version: string };
  const output = await writeTaskData(shortAuth, { operations: [{ id: 'offline-job-propose', resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'plan', expected_version: 'absent', expected_task_version: context.parent_version, data: { inputFingerprint: context.input_fingerprint, rationale: '既存の長期承認範囲内で実行する', works: [localWork] } }] });
  expect(output.results[0]).toMatchObject({ ok: true });
  let delegated = await loadCoordinationDelegation(project, 'plan');
  expect(delegated).toMatchObject({ expiresAt: capturedAt + 5000, authorizationExpiresAt: capturedAt + 5000, coordinationSourceAccessTokenExpiresAt: capturedAt + 1000, grantId: 'grant' });
  vi.advanceTimersByTime(1500);
  await expect(readTaskData(shortAuth, { resource: 'task', task_id: 'parent' })).rejects.toThrow('有効期限');
  delegated = await loadCoordinationDelegation(project, 'plan'); await readTaskData(delegated, { resource: 'task', task_id: 'parent' });
  vi.advanceTimersByTime(3501);
  await expect(loadCoordinationDelegation(project, 'plan')).rejects.toThrow('期限');
  expect([...fixture.records.keys()].filter(path => path.startsWith('mcpOAuthGrants/'))).toHaveLength(1);
});

it('accepts whole registered-source intake without per-task file enumeration and rejects malformed explicit selections', async () => {
  await registerLocalPolicy();
  await expect(propose([{ ...localWork, execution: { ...execution, files: [null] as unknown as typeof execution.files } }])).rejects.toThrow();
  await expect(propose([{ ...localWork, execution: { ...execution, files: ['example.mjs'] as unknown as typeof execution.files } }])).rejects.toThrow();
  await propose([{ ...localWork, execution: { ...execution, files: [], checks: [{ type: 'node_syntax', path: 'example.mjs' }] } }]);
  expect((await readPlan()).item.works[0].execution).toMatchObject({ sourceId: 'worker-fixture', files: [], checks: [{ type: 'node_syntax', path: 'example.mjs' }] });
});
