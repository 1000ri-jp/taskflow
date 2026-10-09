import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { CoordinationHost } from './host.mjs';
import { PILOT } from './worker.mjs';
import { executionRevision, workJobId } from './bridge.mjs';

async function fixture(t, { status = 'running', local = { status: 'failed', process_alive: false }, leaseOwner = 'fixture-worker', leaseExpired = false, runOutcome = { status: 'running' } } = {}) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-host-recovery-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const work = { id: 'research', taskId: 'fixture-child', title: 'Fixture research', kind: 'research',
    assigneeType: 'ai', assigneeId: 'fixture-ai', capabilityId: 'local.codex_workspace',
    acceptanceCriteria: ['Return checked research artifacts'], requiresHumanReview: true,
    dependsOn: [], status, executionRevision: 1, humanEvidence: null, needsReconciliation: false,
    lease: { workerId: leaseOwner, token: 'fixture-only-lease', expiresAt: new Date(Date.now() + (leaseExpired ? -1000 : 3600000)).toISOString() },
    execution: { sourceId: 'worker-fixture', files: [], prompt: 'Fixture research only', checks: [], reviewerIds: ['fixture-reviewer'] } };
  const plan = { status: 'active', parentTaskId: 'fixture-parent', inputFingerprint: 'a'.repeat(64), updatedAt: 'initial', works: [work] };
  const capability = { id: work.capabilityId, executor: 'local_worker', status: 'verified', availability: 'connected', transport: { supported: true },
    scope: { projectIds: [PILOT], sourceIds: ['worker-fixture'] }, requiresHumanReview: true };
  const policy = { enabled: true, mode: 'active', capabilities: [capability], humanReviewers: ['fixture-reviewer'], maxLeaseSeconds: 900, requireHumanReview: true };
  const calls = { inspect: [], enqueue: [], run: [], operations: [], authorizations: 0, checkedPrincipals: 0 };
  const query = { where() { return this; }, limit() { return this; }, async get() {
    return { size: 1, docs: [{ id: 'fixture-plan', data: () => structuredClone(plan) }] };
  } };
  const db = { collection: () => query, doc: () => ({ get: async () => ({ data: () => policy }) }) };
  const worker = { stateRoot,
    async inspect(id) { calls.inspect.push(id); if (local === null) throw Object.assign(new Error('No local job'), { code: 'ENOENT' }); return structuredClone(local); },
    async enqueue(job) { calls.enqueue.push(job); },
    async run(id, options) { calls.run.push({ id, options }); if (runOutcome instanceof Error) throw runOutcome; return { ...runOutcome, job_id: id }; },
    stopActive: async () => ({ signalled: false }),
  };
  const checkPrincipal = principal => { assert.equal(principal.scope, 'fixture-only-delegation'); calls.checkedPrincipals++; };
  const domain = { getAdminDb: () => db,
    heartbeatCoordinationWorker: async () => ({ seenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90000).toISOString() }),
    loadCoordinationDelegation: async () => { calls.authorizations++; return { scope: 'fixture-only-delegation' }; },
    requireTaskScope: checkPrincipal, taskContract: () => ({ resources: ['coordination'] }),
    async readTaskData(principal, args) {
      checkPrincipal(principal);
      if (args.resource === 'coordination_policy') return { item: policy };
      if (args.resource === 'coordination_plan') return { _version: 'fixture-plan-version', item: structuredClone(plan) };
      if (args.resource === 'task') return { task: { _version: 'fixture-parent-version', title: 'Fixture parent', description: '', assigneeIds: ['fixture-reviewer'] } };
      throw new Error(`Unexpected fixture read: ${args.resource}`);
    },
    async writeTaskData(principal, args) {
      checkPrincipal(principal);
      const operation = args.operations[0]; calls.operations.push(operation);
      let result = {};
      if (operation.resource === 'coordination' && operation.action === 'claim') {
        work.status = 'running'; work.lease.workerId = 'fixture-worker';
        result = { lease_token: 'fixture-only-lease' };
      } else if (operation.resource === 'attachment') {
        result = { attachment: { url: 'https://example.invalid/fixture-artifact', name: operation.data.name, type: operation.data.type, size: 3 } };
      } else if (operation.resource === 'comment') result = { reviewTaskId: 'fixture-review' };
      else if (operation.resource === 'coordination' && operation.action === 'result') {
        work.status = 'awaiting_review'; work.lease = null; result = { item: { status: 'awaiting_review' } };
      }
      return { results: [{ ok: true, result }] };
    },
  };
  const host = new CoordinationHost({ domain, worker, allowAccountUsage: true });
  return { host, worker, work, plan, calls,
    jobId: () => workJobId(plan.parentTaskId, 'fixture-plan', work.id, plan.inputFingerprint, executionRevision(work)),
    readStatus: async () => JSON.parse(await fs.readFile(host.statusFile, 'utf8')) };
}

test('resumes the same failed job under its own fresh lease using current delegated calls', async t => {
  const f = await fixture(t); const expected = f.jobId();
  assert.deepEqual(await f.host.runOnce(), { dispatched: true, job_id: expected, status: 'running' });
  assert.deepEqual(f.calls.run.map(c => c.id), [expected]);
  assert.equal(f.calls.enqueue[0].execution_revision, 'revision:1');
  assert.equal(f.calls.operations.filter(c => c.action === 'claim').length, 0);
  assert.ok(f.calls.authorizations >= 4);
  assert.equal(f.calls.authorizations, f.calls.checkedPrincipals);
});

test('returns cached awaiting_review artifacts under the same own lease without creating another job', async t => {
  const f = await fixture(t, { local: { status: 'awaiting_review', process_alive: false }, runOutcome: {
    status: 'awaiting_review', already_completed: true, summary: 'Fixture cached output', artifacts: [],
    checks: [{ name: 'fixture-output', passed: true, detail: 'Previously verified output.' }], limitations: [],
  } });
  const artifact = path.join(f.worker.stateRoot, 'cached.md'); await fs.writeFile(artifact, 'abc');
  f.worker.run = async id => {
    f.calls.run.push({ id, cached: true });
    return { status: 'awaiting_review', already_completed: true, summary: 'Fixture cached output',
      artifacts: [{ path: artifact, label: 'Fixture artifact', media_type: 'text/markdown', bytes: 3, sha256: createHash('sha256').update('abc').digest('hex') }],
      checks: [{ name: 'fixture-output', passed: true, detail: 'Previously verified output.' }], limitations: [] };
  };
  const expected = f.jobId();
  assert.deepEqual(await f.host.runOnce(), { dispatched: true, job_id: expected, status: 'awaiting_review' });
  assert.equal(f.calls.run.length, 1); assert.equal(f.calls.run[0].id, expected); assert.equal(f.calls.run[0].cached, true);
  assert.equal(f.calls.operations.filter(c => c.action === 'claim').length, 0);
  assert.equal(f.calls.operations.filter(c => c.resource === 'attachment').length, 1);
  assert.equal(f.calls.operations.filter(c => c.resource === 'comment').length, 1);
  assert.equal(f.calls.operations.filter(c => c.action === 'result').length, 1);
  assert.deepEqual((await f.readStatus()).review_task_id, 'fixture-review');
});

test('keeps live, missing and nonterminal local jobs waiting rather than resuming them', async t => {
  for (const local of [{ status: 'failed', process_alive: true }, { status: 'awaiting_review', process_alive: true },
    { status: 'running', process_alive: true }, { status: 'running', process_alive: false },
    { status: 'queued', process_alive: false }, { status: 'failed' }, null]) {
    const f = await fixture(t, { local });
    assert.equal((await f.host.runOnce()).dispatched, false);
    assert.equal(f.calls.run.length, 0); assert.equal(f.calls.enqueue.length, 0);
    assert.equal(f.calls.authorizations, 0);
    assert.equal((await f.readStatus()).scan_status, local?.process_alive ? 'running_observed' : 'lease_wait');
  }
});

test('never resumes another workers lease, even when expired and locally failed', async t => {
  for (const leaseExpired of [false, true]) {
    const f = await fixture(t, { leaseOwner: 'foreign-fixture-worker', leaseExpired });
    assert.equal((await f.host.runOnce()).dispatched, false);
    assert.equal(f.calls.inspect.length, 0); assert.equal(f.calls.run.length, 0); assert.equal(f.calls.authorizations, 0);
  }
});

test('retains normal ready, changes_requested and expired own lease dispatch', async t => {
  for (const options of [{ status: 'ready' }, { status: 'changes_requested' }, { leaseExpired: true }]) {
    const f = await fixture(t, options);
    assert.equal((await f.host.runOnce()).dispatched, true); assert.equal(f.calls.run.length, 1);
    assert.equal(f.calls.operations.filter(c => c.action === 'claim').length, 1);
  }
});

test('preserves reconciliation and prerequisite gates before same lease recovery', async t => {
  const reconciliation = await fixture(t); reconciliation.work.needsReconciliation = true;
  assert.equal((await reconciliation.host.runOnce()).dispatched, false); assert.equal(reconciliation.calls.run.length, 0);
  const dependency = await fixture(t); dependency.work.dependsOn = ['prerequisite'];
  dependency.plan.works.push({ id: 'prerequisite', status: 'ready', assigneeType: 'human' });
  assert.equal((await dependency.host.runOnce()).dispatched, false); assert.equal(dependency.calls.run.length, 0);
});

test('heartbeat and checkpoint timestamps cannot bypass failure cooldown; expiry permits the same retry', async t => {
  const originalNow = Date.now; let clock = originalNow(); Date.now = () => clock;
  t.after(() => { Date.now = originalNow; });
  const f = await fixture(t, { runOutcome: new Error('FIXTURE_TRANSIENT: preserved output') });
  assert.equal((await f.host.runOnce()).status, 'work_failed'); assert.equal(f.calls.run.length, 1);
  f.plan.updatedAt = 'heartbeat-changed'; f.work.checkpoint = { summary: 'heartbeat-only', at: 'later' };
  f.work.lease.expiresAt = new Date(clock + 3600000).toISOString();
  assert.equal((await f.host.runOnce()).dispatched, false); assert.equal(f.calls.run.length, 1);
  assert.equal((await f.readStatus()).scan_status, 'retry_wait');
  clock += 300001;
  assert.equal((await f.host.runOnce()).status, 'work_failed'); assert.equal(f.calls.run.length, 2);
});

test('new execution input, human evidence, revision and input fingerprint bypass the old cooldown', async t => {
  for (const update of [f => { f.work.execution.prompt = 'Updated fixture input'; },
    f => { f.work.humanEvidence = { kind: 'task', id: 'fixture-child', version: 'new-human-version' }; },
    f => { f.work.executionRevision++; }, f => { f.plan.inputFingerprint = 'b'.repeat(64); }]) {
    const f = await fixture(t, { runOutcome: new Error('FIXTURE_TRANSIENT: preserved output') });
    assert.equal((await f.host.runOnce()).status, 'work_failed'); assert.equal(f.calls.run.length, 1);
    update(f);
    assert.equal((await f.host.runOnce()).status, 'work_failed'); assert.equal(f.calls.run.length, 2);
  }
});
