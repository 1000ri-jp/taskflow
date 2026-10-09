#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalWorker, PILOT, ROOT, REGISTERED_SOURCE_IDS, WORKER_CONFIG } from './worker.mjs';
import { CoordinationWorkerBridge, workJobId, executionRevision } from './bridge.mjs';
import { loadDomain } from './domain-loader.mjs';

const AUTH_ERRORS = new Set(['AUTHORIZATION_EXPIRED', 'DELEGATION_REVOKED', 'DELEGATION_MISSING', 'FORBIDDEN', 'INSUFFICIENT_SCOPE']);
const safeError = error => ({ code: error.code ?? (/^[A-Z_]+:/.exec(error.message)?.[0].slice(0, -1) || 'HOST_EXECUTION_FAILED'),
  message: error.code ? error.message : 'ホスト実行で停止しました。実行状態とローカル記録を確認してください。' });
const wait = (ms, signal) => new Promise(resolve => { if (signal?.aborted) return resolve(); const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); });

/** One current project, one local model job at a time, original server-saved OAuth delegation only. */
export class CoordinationHost {
  constructor({ domain, db = domain.getAdminDb(), worker = new LocalWorker(), workerId = WORKER_CONFIG.workerId,
    pollMs = 15000, heartbeatMs = 30000, allowAccountUsage = false,
    statusFile = path.join(worker.stateRoot, 'host-status.json') }) {
    this.domain = domain; this.db = db; this.worker = worker; this.workerId = workerId;
    this.pollMs = pollMs; this.heartbeatMs = heartbeatMs; this.allowAccountUsage = allowAccountUsage; this.statusFile = statusFile;
    this.stopController = new AbortController(); this.lastFailures = new Map();
    this.statusWrites = Promise.resolve();
    this.heartbeatScope = { worker_id: workerId, capability_ids: ['local.codex_workspace'], source_ids: [...REGISTERED_SOURCE_IDS], ttl_seconds: 90 };
  }
  async record(patch) {
    const write = this.statusWrites.catch(() => {}).then(async () => {
      let before = {};
      try { before = JSON.parse(await fs.readFile(this.statusFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.mkdir(path.dirname(this.statusFile), { recursive: true });
      const next = { ...before, schema: 'slowth-host-status/v1', project_id: PILOT, worker_id: this.workerId, process_id: process.pid, updated_at: new Date().toISOString(), ...patch };
      const temporary = `${this.statusFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temporary, this.statusFile); return next;
    });
    this.statusWrites = write; return write;
  }
  async heartbeat() {
    const policy = (await this.db.doc(`projects/${PILOT}/mcpCoordination/policy`).get()).data();
    const capability = policy?.capabilities.find(item => item.id === 'local.codex_workspace' && item.executor === 'local_worker' && item.scope.projectIds.includes(PILOT));
    if (!capability) throw Object.assign(new Error('対象プロジェクトへ実行能力を登録してください。'), { code: 'POLICY_REQUIRED' });
    const sources = capability.scope.sourceIds.filter(id => REGISTERED_SOURCE_IDS.includes(id));
    if (!sources.length) throw Object.assign(new Error('登録された資料範囲に、このホストで使えるソースがありません。'), { code: 'EXECUTION_SCOPE' });
    this.heartbeatScope = { ...this.heartbeatScope, capability_ids: [capability.id], source_ids: sources };
    const live = await this.domain.heartbeatCoordinationWorker(PILOT, this.heartbeatScope);
    await this.record({ heartbeat_at: live.seenAt, heartbeat_expires_at: live.expiresAt });
    return live;
  }
  async runOnce() {
    await this.heartbeat();
    await this.record({ scan_status: 'scanning', scan_started_at: new Date().toISOString() });
    const rows = await this.db.collection(`projects/${PILOT}/mcpCoordinationPlans`).where('status', '==', 'active').limit(101).get();
    if (rows.size > 100) throw Object.assign(new Error('計画が100件を超えています。対象を確認してください。'), { code: 'RESOURCE_LIMIT' });
    await this.record({ active_plan_count: rows.size });
    let scanStatus = 'idle';
    for (const row of rows.docs) {
      const plan = row.data();
      for (const work of plan.works ?? []) {
        if (work.assigneeType !== 'ai' || work.capabilityId !== 'local.codex_workspace' || !work.execution || work.needsReconciliation) continue;
        const ownRunning = work.status === 'running' && work.lease?.workerId === this.workerId;
        const expiredOwn = ownRunning && Date.parse(work.lease.expiresAt) <= Date.now();
        const jobId = workJobId(plan.parentTaskId, row.id, work.id, plan.inputFingerprint, executionRevision(work));
        if (!['ready', 'changes_requested'].includes(work.status) && !expiredOwn) {
          let resumableOwn = false;
          if (ownRunning) {
            let local;
            try { local = await this.worker.inspect(jobId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            resumableOwn = Date.parse(work.lease.expiresAt) > Date.now()
              && ['failed', 'awaiting_review'].includes(local?.status) && local?.process_alive === false;
            if (!resumableOwn) {
              scanStatus = local?.process_alive ? 'running_observed' : 'lease_wait';
              await this.record({ status: local?.process_alive ? 'running_observed' : 'lease_wait', job_id: jobId,
                observed_live_process: !!local?.process_alive, lease_expires_at: work.lease.expiresAt });
            }
          }
          if (!resumableOwn) continue;
        }
        if (work.dependsOn.some(id => plan.works.find(item => item.id === id)?.status !== 'done')) continue;
        // Heartbeats and sibling checkpoints change plan.updatedAt without changing this work's approved input.
        const failureBasis = JSON.stringify([plan.inputFingerprint, executionRevision(work), work.kind, work.title,
          work.assigneeId, work.capabilityId, work.acceptanceCriteria, work.requiresHumanReview, work.dependsOn,
          work.execution, work.humanEvidence ?? null, work.invalidation ?? null]);
        if (this.lastFailures.get(jobId)?.basis === failureBasis && this.lastFailures.get(jobId)?.retry_after > Date.now()) { if (scanStatus === 'idle') scanStatus = 'retry_wait'; continue; }
        const payload = { source_id: work.execution.sourceId,
          files: work.execution.files.map(file => ({ path: file.path, expected_sha256: file.expectedSha256 })),
          prompt: work.execution.prompt, checks: work.execution.checks };
        const callTool = async (name, args) => {
          // Principal is loaded for every call, preserving expiry, revocation, current membership and refreshed delegation.
          const auth = await this.domain.loadCoordinationDelegation(PILOT, row.id);
          if (name === 'get_task_contract') { this.domain.requireTaskScope(auth, false); return this.domain.taskContract(); }
          return name === 'read_task_data' ? this.domain.readTaskData(auth, args)
            : name === 'write_task_data' ? this.domain.writeTaskData(auth, args) : Promise.reject(new Error('Unsupported host tool.'));
        };
        try {
          const parent = await callTool('read_task_data', { project_id: PILOT, resource: 'task', task_id: plan.parentTaskId });
          const policy = (await callTool('read_task_data', { project_id: PILOT, resource: 'coordination_policy' })).item;
          const namedReviewers = work.execution.reviewerIds?.length ? work.execution.reviewerIds
            : (parent.task.assigneeIds ?? []).filter(id => policy.humanReviewers.includes(id));
          await this.record({ status: 'executing', scan_status: 'executing', job_id: jobId, work_id: work.id, plan_id: row.id, last_error: null });
          const bridge = new CoordinationWorkerBridge({ worker: this.worker, workerId: this.workerId, callTool });
          const output = await bridge.execute({ parentTaskId: plan.parentTaskId, planId: row.id, workId: work.id,
            payload, reviewerIds: namedReviewers, allowAccountUsage: this.allowAccountUsage });
          this.lastFailures.delete(jobId);
          await this.record({ status: output.status, job_id: jobId, work_id: work.id, plan_id: row.id,
            artifact_count: output.artifact_count ?? 0, review_task_id: output.review_task_id ?? null, last_error: null,
            scan_status: 'completed', last_scan_at: new Date().toISOString() });
          return { dispatched: true, job_id: jobId, status: output.status };
        } catch (error) {
          const details = safeError(error), pendingAuth = AUTH_ERRORS.has(details.code);
          this.lastFailures.set(jobId, { basis: failureBasis, retry_after: Date.now() + (pendingAuth ? 60000 : 300000) });
          await this.record({ status: pendingAuth ? 'authorization_required' : 'work_failed', job_id: jobId, work_id: work.id, plan_id: row.id, last_error: details,
            scan_status: 'failed', last_scan_at: new Date().toISOString() });
          return { dispatched: false, job_id: jobId, status: pendingAuth ? 'authorization_required' : 'work_failed', error_code: details.code };
        }
      }
    }
    await this.record({ scan_status: scanStatus, last_scan_at: new Date().toISOString() });
    return { dispatched: false, status: 'idle' };
  }
  async run() {
    let heartbeatBusy = false;
    const timer = setInterval(async () => { if (heartbeatBusy || this.stopController.signal.aborted) return; heartbeatBusy = true;
      try { await this.heartbeat(); } catch (error) { await this.record({ status: 'heartbeat_failed', last_error: safeError(error) }); }
      finally { heartbeatBusy = false; }
    }, this.heartbeatMs);
    try {
      await this.record({ status: 'starting', started_at: new Date().toISOString(), stopped_at: null,
        scan_status: 'starting', scan_started_at: null, last_scan_at: null, active_plan_count: null });
      while (!this.stopController.signal.aborted) {
        try { const outcome = await this.runOnce(); if (!outcome.dispatched) await wait(this.pollMs, this.stopController.signal); }
        catch (error) { await this.record({ status: 'host_wait', scan_status: 'failed', last_scan_at: new Date().toISOString(), last_error: safeError(error) }); await wait(this.pollMs, this.stopController.signal); }
      }
    } finally {
      clearInterval(timer); while (heartbeatBusy) await wait(25);
      await this.domain.stopCoordinationWorker(PILOT, this.workerId);
      await this.record({ status: 'stopped', scan_status: 'stopped', stopped_at: new Date().toISOString() });
    }
  }
  async stop() { this.stopController.abort(); return this.worker.stopActive(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--verify-setup')) {
    await loadDomain({ initializeCredentials: false });
    return { compiled: true, live_started: false, credential_source: 'existing ApplicationDefaultCredential; no credential export', project_id: PILOT };
  }
  if (!args.includes('--run') && !args.includes('--once')) throw new Error('Usage: node host.mjs --verify-setup | --once | --run [--allow-account-usage]. --run/--once register heartbeat and may perform approved queued work.');
  const domain = await loadDomain({ initializeCredentials: true });
  const host = new CoordinationHost({ domain, allowAccountUsage: args.includes('--allow-account-usage') });
  process.once('SIGTERM', () => { host.stop().catch(() => {}); }); process.once('SIGINT', () => { host.stop().catch(() => {}); });
  if (args.includes('--once')) { try { return await host.runOnce(); } finally { await domain.stopCoordinationWorker(PILOT, host.workerId); } }
  await host.run(); return { stopped: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
  .then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n'))
  .catch(error => { process.stderr.write(JSON.stringify(safeError(error)) + '\n'); process.exitCode = 1; });
