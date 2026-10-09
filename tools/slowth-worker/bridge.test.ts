import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { taskFirestore } from '../../src/lib/mcp/taskData.fixture';
import { readTaskData, writeTaskData, type TaskOperation, type TaskPrincipal } from '../../src/lib/mcp/taskData';
import { taskContract } from '../../src/lib/mcp/taskContract';
import { loadCoordinationDelegation, heartbeatCoordinationWorker, stopCoordinationWorker } from '../../src/lib/mcp/coordinatorTransport';
import { requireTaskScope } from '../../src/lib/mcp/taskData';
import { LocalWorker, PILOT, ROOT } from './worker.mjs';
import { fixtureCapability, fictionalResult, cleanupFictionalResults } from './fixtures/transport.mjs';
afterEach(cleanupFictionalResults);
import { CoordinationWorkerBridge } from './bridge.mjs';
import { CoordinationHost } from './host.mjs';
import { applyWorkflow } from '../../src/lib/task/workflowRepository';
import type { CoordinationPlan } from '../../src/lib/mcp/coordinatorTypes';
import { PILOT_PROJECT as OAUTH_CONFIG_PROJECT } from '../../scripts/mcp-events/policy.mjs';
const fake = vi.hoisted(() => ({ db: null as unknown, getUser: vi.fn(), files: new Map<string, { bytes: Buffer; metadata: Record<string, unknown> }>() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ getUser: fake.getUser }), getAdminStorage: () => ({ bucket: () => ({ file: (name: string) => ({
  save: async (bytes: Buffer, options: Record<string, unknown>) => { if (fake.files.has(name)) throw Object.assign(new Error('exists'), { code: 412 }); fake.files.set(name, { bytes, metadata: { ...(options.metadata as object), size: bytes.length, generation: '1', contentType: options.contentType } }); },
  getMetadata: async () => [fake.files.get(name)!.metadata],
  createReadStream: async function* ({ start, end }: { start: number; end: number }) { yield fake.files.get(name)!.bytes.subarray(start, end + 1); },
}) }) }) }));
vi.mock('@/lib/task/changeStamp.server', () => ({ stampTaskWrite: (_ref: unknown, data: unknown) => data }));
const ai = 'fixture-ai', human = 'fixture-human';
let fixture: ReturnType<typeof taskFirestore>;
const auth = (): TaskPrincipal => ({ userId: ai, grantId: 'fixture-grant', expiresAt: Date.now() + 60000, authorizationExpiresAt: Date.now() + 60000, projectIds: [PILOT], taskScopes: ['tasks:read', 'tasks:write'], permissions: ['tasks:read', 'tasks:write'] });
const record = (id: string) => fixture.records.get(`projects/${PILOT}/tasks/${id}`)!;
const version = (id: string) => (record(id).updatedAt as Date).toISOString();
const write = async (operation: TaskOperation) => {
  const result = await writeTaskData(auth(), { project_id: PILOT, operations: [operation] });
  expect(result.results[0], JSON.stringify(result)).toMatchObject({ ok: true }); return result.results[0].result!;
};
async function readyFixturePlan(planId: string, sourceIds = ['worker-fixture'], withSibling = false) {
  const registry = { capabilities: [fixtureCapability(PILOT)] };
  const originalCapability = registry.capabilities.find((c: { id: string }) => c.id === 'local.codex_workspace');
  const capability = { ...originalCapability, status: 'verified', availability: 'connected', transport: { type: 'file_job', supported: true }, scope: { ...originalCapability.scope, sourceIds } };
  await write({ id: `${planId}-policy`, resource: 'coordination_policy', action: 'set', expected_version: 'absent', data: { enabled: true, mode: 'active', aiMemberId: ai, humanReviewers: [human], humans: [{ id: human, skills: [], availability: 'fictional reviewer only' }], capabilities: [capability], maxLeaseSeconds: 900, requireHumanReview: true } });
  const context = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  const execution = { sourceId: 'worker-fixture', files: [], prompt: 'Fictional fixture; no production data', checks: [], reviewerIds: [human] };
  const works = [{ id: 'code', title: '架空実装', description: '登録済みのfixtureだけを使う', kind: 'implementation', assigneeType: 'ai', assigneeId: ai, capabilityId: capability.id, dependsOn: [], acceptanceCriteria: ['成果が保持され人間確認を待つ'], execution },
    ...(withSibling ? [{ id: 'sibling', title: '既存の架空調査', description: '保持する兄弟作業', kind: 'research', assigneeType: 'ai', assigneeId: ai, capabilityId: capability.id, dependsOn: [], acceptanceCriteria: ['既存の進捗が保持される'], execution }] : [])];
  const proposal = await write({ id: `${planId}-propose`, resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: planId, expected_version: 'absent', expected_task_version: version('parent'), data: { inputFingerprint: context.input_fingerprint, rationale: '実行経路を架空データで確認する', works } });
  for (const [index, child] of (proposal.item as { works: { taskId: string; title: string }[] }).works.entries()) {
    await write({ id: `${planId}-child-${index}`, resource: 'task', action: 'create', task_id: child.taskId, expected_task_version: version('parent'), data: { title: child.title, description: 'fixture', listId: 'todo', parentTaskId: 'parent', assigneeIds: [ai] } });
  }
  const latest = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: planId }) as { _version: string };
  await write({ id: `${planId}-activate`, resource: 'coordination', action: 'activate', task_id: 'parent', resource_id: planId, expected_version: latest._version, data: {} });
  await heartbeatCoordinationWorker(PILOT, { worker_id: 'fixture-worker', capability_ids: [capability.id], source_ids: sourceIds, ttl_seconds: 90 });
  return execution;
}
beforeEach(() => {
  fixture = taskFirestore(); fake.db = fixture.db; fake.files.clear(); vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'fictional.appspot.com');
  vi.stubEnv('SLOWTH_MCP_OAUTH_ENABLED', 'true');
  vi.stubEnv('SLOWTH_MCP_OAUTH_ORIGIN', 'https://slowth.example.test');
  vi.stubEnv('SLOWTH_MCP_OAUTH_ALLOWED_UID', ai);
  vi.stubEnv('SLOWTH_MCP_OAUTH_CLIENT_ID', 'https://chatgpt.com/oauth/client.json');
  vi.stubEnv('SLOWTH_MCP_OAUTH_REDIRECT_URI', 'https://chatgpt.com/connector_platform_oauth_redirect');
  vi.stubEnv('SLOWTH_MCP_EVENTS_PRODUCTION', 'true');
  vi.stubEnv('SLOWTH_MCP_EVENTS_PROJECT_ID', OAUTH_CONFIG_PROJECT);
  vi.stubEnv('SLOWTH_MCP_TASK_ACCESS', 'true');
  fake.getUser.mockReset().mockResolvedValue({ disabled: false, emailVerified: true, email: 'fixture@1000ri.jp', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: '1970-01-01T00:00:00.000Z' });
  const time = new Date('2026-10-08T00:00:00Z');
  const base = { projectId: PILOT, listId: 'todo', title: '架空のworker検証', description: '完成済みCodex検証の成果を返却する', order: 0, assigneeIds: [human], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: true, isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, createdAt: time, updatedAt: time, createdBy: human };
  for (const [name, data] of Object.entries({
    [`projects/${PILOT}`]: { memberIds: [ai, human], isArchived: false }, [`projects/${PILOT}/members/${ai}`]: { userId: ai, role: 'editor' }, [`projects/${PILOT}/members/${human}`]: { userId: human, role: 'editor' },
    [`users/${ai}`]: { displayName: '架空AI' }, [`users/${human}`]: { displayName: '架空確認者' }, [`projects/${PILOT}/lists/todo`]: { name: '作業' },
    [`projects/${PILOT}/tasks/parent`]: base,
    [`mcpOAuthGrants/${createHash('sha256').update('fixture-grant').digest('hex')}`]: { userId: ai, projectId: PILOT, mode: 'production', expiresAt: new Date(Date.now() + 60000), taskScopes: ['tasks:read', 'tasks:write'], authTime: Math.floor(Date.now() / 1000), clientId: 'https://chatgpt.com/oauth/client.json', resource: 'https://slowth.example.test/api/mcp' },
    [`mcpOAuthState/${createHash('sha256').update('Grant:fixture-grant').digest('hex')}`]: { expiresAt: new Date(Date.now() + 60000) },
  })) fixture.records.set(name, structuredClone(data));
});
it('revalidates an owned lease before every resume and blocks a changed assignment before worker execution', async () => {
  const planId = 'resume-gate-plan', execution = await readyFixturePlan(planId);
  const latest = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: planId }) as { _version: string; item: CoordinationPlan };
  const claimed = await write({ id: 'resume-gate-claim', resource: 'coordination', action: 'claim', task_id: 'parent', resource_id: planId, expected_version: latest._version,
    data: { work_id: 'code', worker_id: 'fixture-worker' } });
  expect(claimed.lease_token).toBeTruthy();
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-resume-gate-'));
  try {
    const worker = new LocalWorker({ stateRoot }), checkpoints: string[] = [], sequence: string[] = [];
    worker.run = async () => { sequence.push('run'); return { status: 'running', observed_live_process: true }; };
    const bridge = new CoordinationWorkerBridge({ worker, callTool: async (name: string, args: Record<string, unknown>) => {
      const op = (args.operations as TaskOperation[] | undefined)?.[0];
      if (op?.action === 'checkpoint') { sequence.push('checkpoint'); checkpoints.push(op.id); }
      return name === 'get_task_contract' ? taskContract() : name === 'read_task_data' ? readTaskData(auth(), args) : writeTaskData(auth(), args);
    } });
    const parameters = { parentTaskId: 'parent', planId, workId: 'code', payload: { source_id: execution.sourceId, files: [], prompt: execution.prompt, checks: [] } };
    expect(await bridge.execute(parameters)).toMatchObject({ status: 'running' });
    expect(sequence).toEqual(['checkpoint', 'run']);
    record(latest.item.works[0].taskId).assigneeIds = [human];
    await expect(bridge.execute(parameters)).rejects.toThrow(/MANUAL_ASSIGNMENT/);
    expect(sequence).toEqual(['checkpoint', 'run', 'checkpoint']);
    expect(new Set(checkpoints).size).toBe(2);
    expect(fake.files.size).toBe(0);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});
it('bridges generated fixture artifacts through generic claim/upload/review/result domain operations', async () => {
  const registry = { capabilities: [fixtureCapability(PILOT)] };
  const original = await fictionalResult();
  expect(original.execution.actual_model_invocation).toBe(false); expect(original.execution.fixture_only).toBe(true); expect(original.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
  const capability = { ...registry.capabilities.find((c: { id: string }) => c.id === 'local.codex_workspace'), status: 'verified', availability: 'connected', transport: { type: 'file_job', supported: true } };
  await write({ id: 'fixture-policy', resource: 'coordination_policy', action: 'set', expected_version: 'absent', data: { enabled: true, mode: 'active', aiMemberId: ai, humanReviewers: [human], humans: [{ id: human, skills: [], availability: 'fictional reviewer only' }], capabilities: [capability], maxLeaseSeconds: 900, requireHumanReview: true } });
  const context = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  const originalBytes = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const execution = { sourceId: 'worker-fixture', files: [{ path: 'example.mjs', expectedSha256: createHash('sha256').update(originalBytes).digest('hex') }], prompt: 'reuse verified fictional result', checks: [], reviewerIds: [human] };
  const proposal = await write({ id: 'fixture-propose', resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'fixture-plan', expected_version: 'absent', expected_task_version: version('parent'), data: { inputFingerprint: context.input_fingerprint, rationale: '実際に生成・検証した架空実装を安全に返却する', works: [{ id: 'code', title: '未完了数の修正', description: '隔離された架空ソースで実装する', kind: 'implementation', assigneeType: 'ai', assigneeId: ai, capabilityId: capability.id, dependsOn: [], acceptanceCriteria: ['4件の挙動テストが成功し、人間の確認を待つ'], execution }] } });
  const item = proposal.item as { works: { taskId: string }[] };
  await write({ id: 'fixture-child', resource: 'task', action: 'create', task_id: item.works[0].taskId, expected_task_version: version('parent'), data: { title: '未完了数の修正', description: '架空検証', listId: 'todo', parentTaskId: 'parent', assigneeIds: [ai] } });
  const latest = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'fixture-plan' }) as { _version: string };
  await write({ id: 'fixture-activate', resource: 'coordination', action: 'activate', task_id: 'parent', resource_id: 'fixture-plan', expected_version: latest._version, data: {} });
  await heartbeatCoordinationWorker(PILOT, { worker_id: 'fixture-worker', capability_ids: [capability.id], source_ids: ['worker-fixture'], ttl_seconds: 90 });
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-bridge-test-'));
  try {
    const worker = new LocalWorker({ stateRoot });
    // Generate only fictional temporary bytes; never read private runtime results or invoke a model.
    worker.run = async (id: string) => ({ ...original, job_id: id });
    let loseResponse = true;
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const output = name === 'get_task_contract' ? taskContract() : name === 'read_task_data' ? await readTaskData(auth(), args) : await writeTaskData(auth(), args);
      const operation = (args.operations as TaskOperation[] | undefined)?.[0];
      if (loseResponse && operation?.resource === 'comment' && operation.action === 'submit') { loseResponse = false; throw new Error('fixture response lost after durable review comment'); }
      return output;
    };
    const parameters = { parentTaskId: 'parent', planId: 'fixture-plan', workId: 'code', payload: { prompt: execution.prompt, files: execution.files.map(file => ({ path: file.path, expected_sha256: file.expectedSha256 })), source_id: execution.sourceId, checks: execution.checks }, reviewerIds: [human] };
    const firstBridge = new CoordinationWorkerBridge({ worker, callTool });
    await expect(firstBridge.execute(parameters)).rejects.toThrow('response lost');
    // Restart bridge with no in-memory operation cache; exact durable review replay must prevent duplication.
    const bridge = new CoordinationWorkerBridge({ worker, callTool });
    const result = await bridge.execute(parameters);
    expect(result).toMatchObject({ status: 'awaiting_review', artifact_count: 3 });
    expect(fake.files.size).toBe(3);
    const saved = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'fixture-plan' }) as { item: { works: { status: string; reviewTaskId: string }[] } };
    expect(saved.item.works[0]).toMatchObject({ status: 'awaiting_review', reviewTaskId: result.review_task_id });
    const comments = await readTaskData(auth(), { project_id: PILOT, resource: 'comments', task_id: 'parent' }) as { items: { attachments: { url: string }[] }[] };
    expect(comments.items).toHaveLength(1); expect(comments.items[0].attachments).toHaveLength(3);
    const replay = await bridge.execute(parameters);
    expect(replay).toMatchObject({ already_submitted: true, status: 'awaiting_review' });
    expect(record('parent').assigneeIds).toEqual([human]); expect(record('parent').isCompleted).toBe(false);
    expect(fake.files.size).toBe(3);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

it('automatically selects one ready fixture host job, publishes fixture artifacts and leaves human review pending', async () => {
  const registry = { capabilities: [fixtureCapability(PILOT)] };
  const original = await fictionalResult();
  const capability = { ...registry.capabilities.find((c: { id: string }) => c.id === 'local.codex_workspace'), status: 'verified', availability: 'connected', transport: { type: 'file_job', supported: true } };
  await write({ id: 'host-policy', resource: 'coordination_policy', action: 'set', expected_version: 'absent', data: { enabled: true, mode: 'active', aiMemberId: ai, humanReviewers: [human], humans: [{ id: human, skills: [], availability: 'fictional reviewer only' }], capabilities: [capability], maxLeaseSeconds: 900, requireHumanReview: true } });
  const context = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_context', task_id: 'parent' }) as { input_fingerprint: string };
  const baseline = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const execution = { sourceId: 'worker-fixture', files: [{ path: 'example.mjs', expectedSha256: createHash('sha256').update(baseline).digest('hex') }], prompt: 'Fictional job; use actual captured model artifacts for dispatch verification', checks: [], reviewerIds: [human] };
  const proposal = await write({ id: 'host-propose', resource: 'coordination', action: 'propose', task_id: 'parent', resource_id: 'host-plan', expected_version: 'absent', expected_task_version: version('parent'), data: { inputFingerprint: context.input_fingerprint, rationale: 'ホストが計画の作業を自動で選び、実成果を人間の確認まで返す', works: [{ id: 'code', title: '未完了数の修正', description: '隔離された架空ソースで実装する', kind: 'implementation', assigneeType: 'ai', assigneeId: ai, capabilityId: capability.id, dependsOn: [], acceptanceCriteria: ['4件の挙動テストが成功し、人間の確認を待つ'], execution }] } });
  const childId = (proposal.item as { works: { taskId: string }[] }).works[0].taskId;
  await write({ id: 'host-child', resource: 'task', action: 'create', task_id: childId, expected_task_version: version('parent'), data: { title: '未完了数の修正', description: '架空検証', listId: 'todo', parentTaskId: 'parent', assigneeIds: [ai] } });
  const latest = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'host-plan' }) as { _version: string };
  await write({ id: 'host-activate', resource: 'coordination', action: 'activate', task_id: 'parent', resource_id: 'host-plan', expected_version: latest._version, data: {} });
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-host-test-'));
  try {
    const worker = new LocalWorker({ stateRoot }); const invocations: { id: string; prompt: string }[] = [];
    worker.run = async (id: string) => { const job = JSON.parse(await fs.readFile(path.join(worker.directory(id), 'job.json'), 'utf8')); invocations.push({ id, prompt: job.payload.prompt }); return { ...original, job_id: id }; };
    const host = new CoordinationHost({ worker, domain: { getAdminDb: () => fixture.db, readTaskData, writeTaskData, requireTaskScope, taskContract, loadCoordinationDelegation, heartbeatCoordinationWorker, stopCoordinationWorker } });
    const dispatched = await host.runOnce(); expect(dispatched).toMatchObject({ dispatched: true, status: 'awaiting_review' });
    expect(fake.files.size).toBe(3); expect((await host.runOnce())).toMatchObject({ dispatched: false, status: 'idle' });
    const plan = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'host-plan' }) as { item: { works: { status: string; lease: unknown }[] } };
    expect(plan.item.works[0]).toMatchObject({ status: 'awaiting_review', lease: null });
    expect(record('parent').isCompleted).toBe(false); expect(record('parent').assigneeIds).toEqual([human]);
    const reviewId = (plan.item.works[0] as { reviewTaskId: string }).reviewTaskId;
    const review = (record('parent').reviewRequests as Record<string, { updatedAt: string }>)[reviewId];
    const correction = '空配列を渡したときの0を運用文書にも書いてください';
    await applyWorkflow(human, PILOT, reviewId, { id: 'fixture-human-correction', action: 'request_changes', expectedVersion: review.updatedAt, note: correction });
    const correctionPlan = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'host-plan' }) as { _version: string };
    await write({ id: 'host-sync-correction', resource: 'coordination', action: 'sync_human', task_id: 'parent', resource_id: 'host-plan', expected_version: correctionPlan._version, data: { work_id: 'code' } });
    const corrected = await host.runOnce(); expect(corrected).toMatchObject({ dispatched: true, status: 'awaiting_review' });
    expect(invocations).toHaveLength(2); expect(invocations[1].id).not.toBe(invocations[0].id); expect(invocations[1].prompt).toContain(correction);
    expect(fake.files.size).toBe(6); expect(Object.keys(record('parent').reviewRequests as Record<string, unknown>)).toHaveLength(2);
    await stopCoordinationWorker(PILOT, host.workerId);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

it('stops its live model job when periodic checkpoint shows cancellation instead of uploading stale results', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-cancel-test-'));
  try {
    const worker = new LocalWorker({ stateRoot }); let rejectModel: (error: Error) => void = () => {}; let stopped = 0;
    worker.run = () => new Promise((_resolve, reject) => { rejectModel = reject; });
    worker.stopActive = async () => { stopped++; rejectModel(new Error('fixture model process stopped')); return { signalled: true }; };
    const capability = { id: 'local.codex_workspace', status: 'verified', availability: 'connected', transport: { supported: true }, scope: { projectIds: [PILOT], sourceIds: ['worker-fixture'] }, requiresHumanReview: true };
    const work = { id: 'code', taskId: 'child', kind: 'implementation', assigneeType: 'ai', capabilityId: capability.id, title: '架空の長い実装', acceptanceCriteria: ['成果を確認する'], status: 'ready', executionRevision: 1, humanEvidence: null, execution: { sourceId: 'worker-fixture', files: [], prompt: 'fixture', checks: [] } };
    let uploads = 0;
    const bridge = new CoordinationWorkerBridge({ worker, heartbeatMs: 10, callTool: async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_task_contract') return { resources: ['coordination'] };
      if (name === 'read_task_data') return args.resource === 'coordination_policy' ? { item: { enabled: true, mode: 'active', capabilities: [capability], maxLeaseSeconds: 900, humanReviewers: [human], requireHumanReview: true } }
        : { _version: 'fixture-v1', item: { status: 'active', inputFingerprint: 'a'.repeat(64), works: [work] } };
      const op = (args.operations as TaskOperation[])[0];
      if (op.resource === 'attachment') uploads++;
      if (op.action === 'claim') return { results: [{ ok: true, result: { lease_token: 'fixture-lease' } }] };
      if (op.action === 'checkpoint') return { isError: true, structuredContent: { code: 'PLAN_TERMINAL', message: '計画は取消済みです' } };
      throw new Error('unexpected fixture operation');
    } });
    await expect(bridge.execute({ parentTaskId: 'parent', planId: 'cancel-plan', workId: 'code', payload: { source_id: 'worker-fixture', files: [], prompt: 'fixture', checks: [] }, reviewerIds: [human] })).rejects.toMatchObject({ code: 'PLAN_TERMINAL' });
    expect(stopped).toBe(1); expect(uploads).toBe(0);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

it('returns all 11 artifacts through durable max-10 parent comments and a complete manifest after lost response', async () => {
  await readyFixturePlan('artifact-plan');
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-artifact-chunk-test-'));
  try {
    const worker = new LocalWorker({ stateRoot }); const artifacts = [];
    for (let index = 0; index < 11; index++) { const file = path.join(stateRoot, `actual-artifact-${index}.txt`); await fs.writeFile(file, `fixture output ${index}`); artifacts.push(await worker.describeArtifact(file, `成果物 ${index}`, 'text/plain')); }
    worker.run = async (id: string) => ({ status: 'awaiting_review', job_id: id, summary: '11件の架空成果物を返却する', artifacts, checks: [{ name: 'fixture-output', passed: true, detail: 'All outputs are retained.' }], limitations: [] });
    let responseLost = true, modelRuns = 0;
    const run = worker.run; worker.run = async (...args: unknown[]) => { modelRuns++; return run(...args); };
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const output = name === 'get_task_contract' ? taskContract() : name === 'read_task_data' ? await readTaskData(auth(), args) : await writeTaskData(auth(), args);
      const op = (args.operations as TaskOperation[] | undefined)?.[0];
      if (responseLost && op?.resource === 'comment' && op.data.purpose === 'memo') { responseLost = false; throw new Error('fixture lost artifact chunk response'); }
      return output;
    };
    const parameters = { parentTaskId: 'parent', planId: 'artifact-plan', workId: 'code', payload: { source_id: 'worker-fixture', files: [], prompt: 'Fictional fixture; no production data', checks: [] } };
    await expect(new CoordinationWorkerBridge({ worker, callTool }).execute(parameters)).rejects.toThrow('lost artifact chunk response');
    const completed = await new CoordinationWorkerBridge({ worker, callTool }).execute(parameters);
    expect(completed).toMatchObject({ status: 'awaiting_review', artifact_count: 11, artifact_manifest_count: 1 });
    const comments = await readTaskData(auth(), { project_id: PILOT, resource: 'comments', task_id: 'parent' }) as { items: { attachments: unknown[]; reviewTaskId?: string }[] };
    expect(comments.items).toHaveLength(3); expect(comments.items.every(c => c.attachments.length <= 10)).toBe(true);
    expect(comments.items.reduce((n, c) => n + c.attachments.length, 0)).toBe(12);
    const saved = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: 'artifact-plan' }) as { item: { works: { checkpoint: { artifacts: unknown[] }; status: string }[] } };
    expect(saved.item.works[0]).toMatchObject({ status: 'awaiting_review' }); expect(saved.item.works[0].checkpoint.artifacts).toHaveLength(12); expect(fake.files.size).toBe(12);
    expect(await new CoordinationWorkerBridge({ worker, callTool }).execute(parameters)).toMatchObject({ already_submitted: true }); expect(fake.files.size).toBe(12);
    await expect(new CoordinationWorkerBridge({ worker, callTool }).execute({ ...parameters, reviewerIds: [ai] })).rejects.toThrow('REVIEWER_CONFLICT'); expect(modelRuns).toBe(2);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

it('advertises only an actually supported source registered in the current policy', async () => {
  await readyFixturePlan('source-scope-plan', ['worker-fixture']);
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-heartbeat-scope-test-'));
  try {
    const host = new CoordinationHost({ worker: new LocalWorker({ stateRoot }), domain: { getAdminDb: () => fixture.db, heartbeatCoordinationWorker } });
    const live = await host.heartbeat(); expect(live.sourceIds).toEqual(['worker-fixture']); expect(live.capabilityIds).toEqual(['local.codex_workspace']);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

it('rejects caller overrides and a changed capability source before enqueue or model execution', async () => {
  const execution = await readyFixturePlan('input-scope-plan');
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-authoritative-input-'));
  try {
    const worker = new LocalWorker({ stateRoot }); let enqueues = 0, runs = 0;
    const enqueue = worker.enqueue.bind(worker); worker.enqueue = async job => { enqueues++; return enqueue(job); };
    worker.run = async () => { runs++; return { status: 'running' }; };
    const base = { source_id: execution.sourceId, files: [], prompt: execution.prompt, checks: [] };
    let scope = ['worker-fixture'];
    const bridge = new CoordinationWorkerBridge({ worker, callTool: async (name: string, args: Record<string, unknown>) => {
      const result = name === 'get_task_contract' ? taskContract() : name === 'read_task_data' ? await readTaskData(auth(), args) : await writeTaskData(auth(), args);
      if (name === 'read_task_data' && args.resource === 'coordination_policy') {
        const copy = structuredClone(result) as { item: { capabilities: { scope: { sourceIds: string[] } }[] } };
        copy.item.capabilities[0].scope.sourceIds = scope; return copy;
      }
      return result;
    } });
    for (const payload of [{ ...base, source_id: 'slowth-source' }, { ...base, prompt: 'changed business request' },
      { ...base, files: [{ path: 'different.mjs', expected_sha256: null }] }, { ...base, checks: [{ type: 'node_syntax', path: 'different.mjs' }] },
      { ...base, prior_job_id: 'unrelated-job' }]) {
      await expect(bridge.execute({ parentTaskId: 'parent', planId: 'input-scope-plan', workId: 'code', payload })).rejects.toThrow('EXECUTION_INPUT_CONFLICT');
    }
    expect(enqueues).toBe(0); expect(runs).toBe(0); expect(fake.files.size).toBe(0);
    scope = ['slowth-source'];
    await expect(bridge.execute({ parentTaskId: 'parent', planId: 'input-scope-plan', workId: 'code' })).rejects.toThrow('SOURCE_SCOPE');
    expect(enqueues).toBe(0);
    scope = ['worker-fixture'];
    expect(await bridge.execute({ parentTaskId: 'parent', planId: 'input-scope-plan', workId: 'code' })).toMatchObject({ status: 'running' });
    expect(enqueues).toBe(1); expect(runs).toBe(1);
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});

const domainPlan = async (planId: string) => await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_plan', task_id: 'parent', resource_id: planId }) as { item: CoordinationPlan; _version: string };
async function conflictFixture(planId: string, check: (fixture: {
  worker: LocalWorker; stateRoot: string; operations: TaskOperation[];
  parameters: { parentTaskId: string; planId: string; workId: string; payload: { source_id: string; files: never[]; prompt: string; checks: never[] } };
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  hooks: { onRun?: () => Promise<void> | void; beforeCall?: () => Promise<void> | void; beforeWrite?: (op: TaskOperation) => Promise<void> | void; afterWrite?: (op: TaskOperation) => Promise<void> | void };
  invocations: () => number;
}) => Promise<void>, withSibling = false) {
  const execution = await readyFixturePlan(planId, ['worker-fixture'], withSibling);
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-source-conflict-test-'));
  try {
    const worker = new LocalWorker({ stateRoot }), operations: TaskOperation[] = [];
    const hooks: Parameters<typeof check>[0]['hooks'] = {}; let invocations = 0;
    worker.run = async (id: string) => {
      invocations++; await hooks.onRun?.();
      const file = path.join(worker.directory(id), 'state.json');
      const state = JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.writeFile(file, JSON.stringify({ ...state, status: 'failed', last_error: 'PRIOR_SOURCE_CONFLICT: example.mjs' }));
      throw new Error('PRIOR_SOURCE_CONFLICT: example.mjs');
    };
    const callTool = async (name: string, args: Record<string, unknown>) => {
      await hooks.beforeCall?.();
      const op = (args.operations as TaskOperation[] | undefined)?.[0];
      if (op) { operations.push(structuredClone(op)); await hooks.beforeWrite?.(op); }
      const output = name === 'get_task_contract' ? taskContract() : name === 'read_task_data' ? await readTaskData(auth(), args) : await writeTaskData(auth(), args);
      if (op) await hooks.afterWrite?.(op);
      return output;
    };
    const parameters = { parentTaskId: 'parent', planId, workId: 'code', payload: { source_id: execution.sourceId, files: [] as never[], prompt: execution.prompt, checks: [] as never[] } };
    await check({ worker, stateRoot, operations, parameters, callTool, hooks, invocations: () => invocations });
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
}
async function assertConflictWait(planId: string) {
  const saved = (await domainPlan(planId)).item, work = saved.works.find(item => item.id === 'code')!;
  expect(saved.status).toBe('active');
  expect(work).toMatchObject({ status: 'waiting_human', lease: null, humanEvidence: null, reviewTaskId: null });
  const comments = await readTaskData(auth(), { project_id: PILOT, resource: 'comments', task_id: 'parent' }) as { items: { id: string; content: string; purpose: string; attachments: unknown[] }[] };
  const diagnostics = comments.items.filter(item => item.id === work.waiting!.commentId);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ purpose: 'memo', attachments: [] });
  expect(diagnostics[0].content).toContain('PRIOR_SOURCE_CONFLICT');
  expect(diagnostics[0].content).toContain('Dotは現在の登録資料と元の要望を読み');
  expect(diagnostics[0].content).toContain('適切な未完了タスクを再利用');
  expect(diagnostics[0].content).toContain('完了済みの前提は満たされた根拠として保持');
  expect(diagnostics[0].content).toContain('人間への確認は目的や変更意図が不明な場合だけ');
  expect(diagnostics[0].content).not.toContain(os.tmpdir());
  const history = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_history', task_id: 'parent', resource_id: planId }) as { items: { action: string }[] };
  expect(history.items.filter(item => item.action === 'wait')).toHaveLength(1);
  return { saved, work };
}

it('durably waits only the conflicting work without model output, upload, approval or sibling/history loss', async () => {
  await conflictFixture('conflict-plan', async env => {
    let current = await domainPlan(env.parameters.planId);
    const claimed = await write({ id: 'existing-sibling-claim', resource: 'coordination', action: 'claim', task_id: 'parent', resource_id: env.parameters.planId, expected_version: current._version, data: { work_id: 'sibling', worker_id: 'fixture-worker' } });
    current = await domainPlan(env.parameters.planId);
    await write({ id: 'existing-sibling-checkpoint', resource: 'coordination', action: 'checkpoint', task_id: 'parent', resource_id: env.parameters.planId, expected_version: current._version,
      data: { work_id: 'sibling', lease_token: claimed.lease_token, summary: '既存の架空進捗', artifacts: [{ label: '保持する架空参照', url: 'https://example.test/fixture-existing-result' }], checks: [] } });
    await write({ id: 'existing-review-history', resource: 'comment', action: 'submit', task_id: 'parent', resource_id: 'existing-review-comment', expected_version: version('parent'),
      data: { content: '保持する既存の架空確認', review: { content: '既存の確認依頼', assigneeIds: [human], dueDate: null, policy: 'all' } } });
    const siblingBefore = structuredClone((await domainPlan(env.parameters.planId)).item.works.find(item => item.id === 'sibling'));
    const taskBefore = structuredClone(record((await domainPlan(env.parameters.planId)).item.works[0].taskId));
    const parentBefore = structuredClone(record('parent'));
    const retainedFile = path.join(env.stateRoot, 'existing-result.txt'); await fs.writeFile(retainedFile, 'retained actual fixture bytes');
    const bridge = new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool });
    const result = await bridge.execute(env.parameters);
    expect(result).toMatchObject({ status: 'host_wait', work_id: 'code' });
    const { saved } = await assertConflictWait(env.parameters.planId);
    expect(saved.works.find(item => item.id === 'sibling')).toEqual(siblingBefore);
    expect(record(saved.works[0].taskId)).toEqual(taskBefore);
    expect(record('parent')).toMatchObject({ assigneeIds: parentBefore.assigneeIds, dueDate: parentBefore.dueDate, title: parentBefore.title, description: parentBefore.description, reviewRequests: parentBefore.reviewRequests, isCompleted: false });
    expect(await fs.readFile(retainedFile, 'utf8')).toBe('retained actual fixture bytes');
    expect(env.operations.filter(op => op.resource === 'attachment' || op.action === 'result' || op.resource === 'workflow')).toEqual([]);
    expect(fake.files.size).toBe(0);
    await expect(fs.access(path.join(env.worker.directory(result.job_id), 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const beforeReplay = structuredClone([...fixture.records]);
    expect(await new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).toMatchObject({ status: 'host_wait' });
    expect(env.invocations()).toBe(1); expect([...fixture.records]).toEqual(beforeReplay);
  }, true);
});

it.each(['comment_response', 'wait_response', 'wait_before_commit'])('recovers exact partial %s loss with one diagnostic and one recorded wait', async lost => {
  await conflictFixture(`loss-${lost}`, async env => {
    let pending = true;
    const lose = (op: TaskOperation) => {
      if (!pending) return;
      if (lost === 'comment_response' ? op.resource === 'comment' : op.resource === 'coordination' && op.action === 'wait') { pending = false; throw new Error('fixture transport response lost'); }
    };
    if (lost === 'wait_before_commit') env.hooks.beforeWrite = lose; else env.hooks.afterWrite = lose;
    await expect(new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).rejects.toThrow('PRIOR_SOURCE_CONFLICT');
    expect(await new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).toMatchObject({ status: 'host_wait' });
    await assertConflictWait(env.parameters.planId);
    expect(fake.files.size).toBe(0);
    if (lost === 'wait_before_commit') {
      const attempts = env.operations.filter(op => op.resource === 'coordination' && op.action === 'wait');
      expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
    }
    expect(env.invocations()).toBe(1);
  });
});

it.each(['authorization_lost', 'manual_assignment'])('keeps the original source conflict visible when %s prevents a real wait', async failure => {
  await conflictFixture(`failed-${failure}`, async env => {
    let denied = false;
    env.hooks.onRun = async () => {
      if (failure === 'authorization_lost') denied = true;
      else record((await domainPlan(env.parameters.planId)).item.works[0].taskId).assigneeIds = [human];
    };
    env.hooks.beforeCall = () => { if (denied) throw Object.assign(new Error('FORBIDDEN: fixture access revoked'), { code: 'FORBIDDEN' }); };
    const error = await new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters).catch((value: Error & { code: string }) => value);
    expect(error).toMatchObject({ code: failure === 'authorization_lost' ? 'FORBIDDEN' : 'MANUAL_ASSIGNMENT' });
    expect(error.message).toContain('PRIOR_SOURCE_CONFLICT');
    const work = (await domainPlan(env.parameters.planId)).item.works[0];
    expect(work).toMatchObject({ status: 'running', waiting: null, humanEvidence: null }); expect(work.lease).not.toBeNull();
    if (failure === 'manual_assignment') expect(record(work.taskId).assigneeIds).toEqual([human]);
    const history = await readTaskData(auth(), { project_id: PILOT, resource: 'coordination_history', task_id: 'parent', resource_id: env.parameters.planId }) as { items: { action: string }[] };
    expect(history.items.filter(item => item.action === 'wait')).toEqual([]);
    expect(env.operations.some(op => op.resource === 'attachment' || op.action === 'result' || op.resource === 'workflow')).toBe(false);
  });
});

it('does not convert a different worker failure into a source-conflict memo or wait', async () => {
  await conflictFixture('different-failure', async env => {
    env.hooks.onRun = () => { throw new Error('PRIOR_ARTIFACT_CHANGED: original recorded bytes changed'); };
    await expect(new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).rejects.toThrow('PRIOR_ARTIFACT_CHANGED');
    expect(env.operations.some(op => op.resource === 'comment' || op.action === 'wait')).toBe(false);
    expect((await domainPlan(env.parameters.planId)).item.works[0].status).toBe('running');
  });
});

it.each(['parent', 'plan'])('uses a fresh %s version after a definitive handoff conflict without duplicating the stable memo', async changed => {
  await conflictFixture(`version-${changed}`, async env => {
    let siblingLease: unknown;
    if (changed === 'plan') {
      const current = await domainPlan(env.parameters.planId);
      siblingLease = (await write({ id: 'concurrent-sibling-claim', resource: 'coordination', action: 'claim', task_id: 'parent', resource_id: env.parameters.planId, expected_version: current._version, data: { work_id: 'sibling', worker_id: 'fixture-worker' } })).lease_token;
    }
    let pending = true;
    env.hooks.beforeWrite = async op => {
      if (!pending || (changed === 'parent' ? op.resource !== 'comment' : op.action !== 'wait')) return;
      pending = false;
      if (changed === 'parent') { record('parent').description = '人間が保持する新しい要望'; record('parent').updatedAt = new Date(Date.now() + 10); }
      else {
        const current = await domainPlan(env.parameters.planId);
        await write({ id: 'concurrent-sibling-checkpoint', resource: 'coordination', action: 'checkpoint', task_id: 'parent', resource_id: env.parameters.planId, expected_version: current._version,
          data: { work_id: 'sibling', lease_token: siblingLease, summary: '同時更新した兄弟の進捗', checks: [] } });
      }
    };
    await expect(new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).rejects.toThrow('PRIOR_SOURCE_CONFLICT');
    expect((await domainPlan(env.parameters.planId)).item.works[0].status).toBe('running');
    expect(await new CoordinationWorkerBridge({ worker: env.worker, callTool: env.callTool }).execute(env.parameters)).toMatchObject({ status: 'host_wait' });
    const { saved } = await assertConflictWait(env.parameters.planId);
    const attempts = env.operations.filter(op => changed === 'parent' ? op.resource === 'comment' : op.action === 'wait');
    expect(attempts).toHaveLength(2); expect(attempts[0].id).not.toBe(attempts[1].id); expect(attempts[0].resource_id).toBe(attempts[1].resource_id);
    if (changed === 'parent') expect(record('parent').description).toBe('人間が保持する新しい要望');
    else expect(saved.works[1].checkpoint?.summary).toBe('同時更新した兄弟の進捗');
  }, changed === 'plan');
});
