import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalWorker, PILOT, WORKER_CONFIG, REGISTERED_SOURCE_IDS } from './worker.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical)
  : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const executionRevision = work => Number.isInteger(work.executionRevision)
  ? `revision:${work.executionRevision}` : digest([work.humanEvidence ?? null, work.execution ?? null]);
export const workJobId = (parentTaskId, planId, workId, inputFingerprint, revision = 'initial') => `work-${digest([parentTaskId, planId, workId, inputFingerprint, revision]).slice(0, 48)}`;
const checksOnly = checks => checks.map(({ name, passed, detail }) => ({ name, passed, detail }));
const sourceConflictCommentId = jobId => `worker-source-conflict-${digest(jobId).slice(0, 40)}`;
const isSourceConflict = error => error?.code === 'PRIOR_SOURCE_CONFLICT' || error?.message?.startsWith('PRIOR_SOURCE_CONFLICT:');
const conflictHandoffError = error => {
  const code = error.code ?? (/^[A-Z_]+:/.exec(error.message)?.[0].slice(0, -1) || 'HOST_EXECUTION_FAILED');
  return Object.assign(new Error(`PRIOR_SOURCE_CONFLICT: 現在の登録資料が以前の入力・成果と一致しません。親タスクへの停止記録を保存できませんでした（${code}）。元の失敗と成果はローカルに保持しています。`, { cause: error }), { code });
};
const unwrap = result => {
  if (result?.isError) {
    let payload = result.structuredContent;
    if (!payload) { try { payload = JSON.parse(result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n')); } catch {} }
    const detail = payload?.results?.find(item => !item.ok)?.error ?? payload;
    const error = new Error(`${detail?.code ?? 'MCP_TOOL_FAILED'}: ${detail?.message ?? 'MCP tool returned an error.'}`);
    error.code = detail?.code; throw error;
  }
  if (result?.structuredContent) return result.structuredContent;
  if (result?.content) {
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    try { return JSON.parse(text); } catch { throw new Error('MCP tool did not return structured JSON.'); }
  }
  return result;
};

/** Supported tool-level bridge. Transport and OAuth principal are supplied by the connected host. */
export class CoordinationWorkerBridge {
  constructor({ callTool, worker = new LocalWorker(), workerId = WORKER_CONFIG.workerId, heartbeatMs = 30000 }) {
    if (typeof callTool !== 'function') throw new Error('A connected, scope-validated MCP callTool is required.');
    this.callTool = callTool; this.worker = worker; this.workerId = workerId; this.heartbeatMs = heartbeatMs;
    this.pendingOps = new Map();
    this.operationRoot = path.join(worker.stateRoot, 'bridge-operations');
  }
  async read(resource, taskId, planId) {
    return unwrap(await this.callTool('read_task_data', { project_id: PILOT, resource, ...(taskId ? { task_id: taskId } : {}), ...(planId ? { resource_id: planId } : {}) }));
  }
  async operation(operation) {
    // Preserve the exact request after a transient failure. Never rebuild an expected_version for the same operation ID.
    await fs.mkdir(this.operationRoot, { recursive: true });
    const savedPath = path.join(this.operationRoot, `${operation.id}.json`);
    let saved;
    try { saved = JSON.parse(await fs.readFile(savedPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (saved?.result) return saved.result;
    const previous = this.pendingOps.get(operation.id);
    const exact = saved?.operation ?? previous ?? operation;
    if (!saved) await fs.writeFile(savedPath, JSON.stringify({ operation: exact }), { flag: 'wx', mode: 0o600 });
    this.pendingOps.set(operation.id, exact);
    const response = unwrap(await this.callTool('write_task_data', { project_id: PILOT, operations: [exact] }));
    const item = response.results?.[0];
    if (!item?.ok) {
      const error = new Error(`${item?.error?.code ?? 'WRITE_FAILED'}: ${item?.error?.message ?? 'MCP operation did not succeed.'}`);
      error.code = item?.error?.code; throw error;
    }
    await fs.writeFile(savedPath, JSON.stringify({ operation: exact, result: item.result }), { mode: 0o600 });
    this.pendingOps.delete(operation.id);
    return item.result;
  }
  async coordinate(action, parentTaskId, planId, data, operationId) {
    const plan = await this.read('coordination_plan', parentTaskId, planId);
    return this.operation({ id: operationId, resource: 'coordination', action, task_id: parentTaskId, resource_id: planId, expected_version: plan._version, data });
  }
  async upload(parentTaskId, artifact, jobId) {
    const bytes = await fs.readFile(artifact.path);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== artifact.sha256) throw new Error('ARTIFACT_CHANGED: inspect or rebuild the local result.');
    const id = `coord-worker-file-${digest([jobId, artifact.label, artifact.sha256]).slice(0, 40)}`;
    const output = await this.operation({ id, resource: 'attachment', action: 'upload', task_id: parentTaskId,
      resource_id: `worker-${digest([jobId, artifact.sha256]).slice(0, 40)}`,
      data: { name: path.basename(artifact.path), type: artifact.media_type, base64: bytes.toString('base64'), sha256: artifact.sha256, purpose: 'comment' } });
    if (!output.attachment?.url?.startsWith('https://')) throw new Error('UPLOAD_INCOMPLETE: no supported HTTPS artifact descriptor.');
    return { attachment: output.attachment, artifact: { label: artifact.label, url: output.attachment.url } };
  }
  async artifactReviewContext({ parentTaskId, jobId, work, result, uploaded }) {
    if (uploaded.length <= 10) return { attachments: uploaded.map(item => item.attachment), artifacts: uploaded.map(item => item.artifact), note: '' };
    const chunkIds = [];
    for (let offset = 0; offset < uploaded.length; offset += 10) {
      const index = Math.floor(offset / 10), commentId = `worker-artifacts-${digest([jobId, index]).slice(0, 40)}`;
      const parent = await this.read('task', parentTaskId);
      await this.operation({ id: `coord-worker-artifact-chunk-${digest([jobId, index]).slice(0, 40)}`, resource: 'comment', action: 'submit', task_id: parentTaskId,
        resource_id: commentId, expected_version: parent.task._version,
        data: { content: `AI作業 ${work.taskId} の成果物 ${index + 1}/${Math.ceil(uploaded.length / 10)}。全成果物の一覧は最後の確認依頼へ添付します。`,
          attachments: uploaded.slice(offset, offset + 10).map(item => item.attachment), notifyIds: [], purpose: 'memo' } });
      chunkIds.push(commentId);
    }
    const manifest = { schema: 'slowth-result-artifacts/v1', job_id: jobId, work_id: work.id, task_id: work.taskId,
      summary: result.summary, artifacts: uploaded.map(item => ({ label: item.artifact.label, name: item.attachment.name, url: item.artifact.url,
        size: item.attachment.size, type: item.attachment.type })), checks: checksOnly(result.checks), artifact_comment_ids: chunkIds };
    const manifestFile = path.join(this.worker.directory(jobId), 'artifacts', 'complete-artifact-manifest.json');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    const descriptor = await this.worker.describeArtifact(manifestFile, '全成果物の一覧と確認結果', 'application/json');
    const complete = await this.upload(parentTaskId, descriptor, jobId);
    return { attachments: [complete.attachment], artifacts: [...uploaded.map(item => item.artifact), complete.artifact],
      note: `\n\n成果物${uploaded.length}件は親タスクの${chunkIds.length}件の成果物コメントへ保存しました。添付の「全成果物の一覧と確認結果」には全ての参照と確認結果があります。\n成果物コメントID: ${chunkIds.join(', ')}` };
  }
  async handoffSourceConflict({ parentTaskId, planId, workId, work, jobId, leaseToken }) {
    try {
      const commentId = sourceConflictCommentId(jobId);
      const question = '登録資料が変わったため、現在の内容で仕事の進め方を再判断してください。人間への確認は目的や変更意図が不明な場合だけ行ってください。';
      const content = `[AIからのメッセージ]\nAI作業 ${work.taskId} で、現在の登録資料が以前の入力・成果と一致せず、以前の成果の復元を停止しました（PRIOR_SOURCE_CONFLICT）。現在の作業だけを待機にし、リースを解放するための記録を保存します。タスク・過去の成果・確認履歴は保持します。\n\nDotは現在の登録資料と元の要望を読み、進め方を再判断してください。要望が明確なら、この計画を理由付きで取り消し、現在の資料を使う新しい計画へ適切な未完了タスクを再利用できます。完了済みの前提は満たされた根拠として保持し、未完了の作業として再割り当てしません。同じ計画を再開するだけでは、以前の成果の復元で再び停止する場合があります。人間への確認は目的や変更意図が不明な場合だけまとめて行ってください。`;
      let comment;
      try { comment = await this.read('comments', parentTaskId, commentId); }
      catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      if (!comment) {
        const parent = await this.read('task', parentTaskId);
        // A definitive version conflict permits a fresh attempt; the memo resource stays stable.
        await this.operation({ id: `coord-worker-source-conflict-note-${digest([jobId, parent.task._version]).slice(0, 40)}`, resource: 'comment', action: 'submit', task_id: parentTaskId,
          resource_id: commentId, expected_version: parent.task._version,
          data: { content, attachments: [], notifyIds: [], purpose: 'memo' } });
        comment = await this.read('comments', parentTaskId, commentId);
      }
      if (comment.item.authorId !== work.assigneeId || comment.item.content !== content || comment.item.purpose !== 'memo') throw new Error('VERSION_CONFLICT: source conflict diagnostic was edited; rejudge the current record.');
      const current = await this.read('coordination_plan', parentTaskId, planId);
      // Exact retries after response loss use the journal; a fresh version cannot replay an obsolete lease.
      await this.operation({ id: `coord-worker-source-conflict-wait-${digest([jobId, leaseToken, current._version]).slice(0, 40)}`, resource: 'coordination', action: 'wait', task_id: parentTaskId,
        resource_id: planId, expected_version: current._version, data: { work_id: workId, lease_token: leaseToken, question,
          comment_id: commentId, comment_version: comment.item._version } });
      return { job_id: jobId, work_id: workId, status: 'host_wait' };
    } catch (error) { throw conflictHandoffError(error); }
  }
  async execute({ parentTaskId, planId, workId, payload, allowAccountUsage = false, reviewerIds = null }) {
    const contract = unwrap(await this.callTool('get_task_contract', {}));
    if (!JSON.stringify(contract).includes('coordination')) throw new Error('COORDINATION_DEPLOYMENT_REQUIRED: live generic task contract does not include the work ledger.');
    const planRead = await this.read('coordination_plan', parentTaskId, planId), plan = planRead.item;
    const work = plan?.works.find(item => item.id === workId);
    if (!work || plan.status !== 'active' || work.assigneeType !== 'ai') throw new Error('An active AI work item is required.');
    if (work.needsReconciliation) throw new Error('RECONCILIATION_REQUIRED: coordinator must update the affected work before execution.');
    const policyRead = await this.read('coordination_policy'), policy = policyRead.item;
    const capability = policy?.capabilities.find(item => item.id === work.capabilityId);
    if (!policy.enabled || policy.mode !== 'active' || !capability || capability.status !== 'verified' || capability.availability !== 'connected' || !capability.transport.supported || !capability.scope.projectIds.includes(PILOT)) throw new Error('CAPABILITY_UNAVAILABLE: the host bridge must be verified and registered first.');
    if (capability.id !== 'local.codex_workspace') throw new Error('CONNECTED_ADAPTER_UNSUPPORTED: only the codex_workspace adapter has the authoritative connected execution contract.');
    if (!work.execution || !Array.isArray(work.execution.files) || !Array.isArray(work.execution.checks) || typeof work.execution.prompt !== 'string') throw new Error('EXECUTION_REQUIRED: the current work must declare its authoritative execution input.');
    if (!capability.scope.sourceIds?.includes(work.execution.sourceId) || !REGISTERED_SOURCE_IDS.includes(work.execution.sourceId)) throw new Error('SOURCE_SCOPE: the current work source must be registered in both capability and host scope.');
    const authoritativePayload = { source_id: work.execution.sourceId,
      files: work.execution.files.map(file => ({ path: file.path, expected_sha256: file.expectedSha256 })),
      prompt: work.execution.prompt, checks: work.execution.checks };
    if (payload !== undefined && JSON.stringify(canonical(payload)) !== JSON.stringify(canonical(authoritativePayload))) throw new Error('EXECUTION_INPUT_CONFLICT: caller input must match the current approved execution exactly.');
    const declaredReviewers = work.execution?.reviewerIds?.length ? work.execution.reviewerIds : null;
    if (declaredReviewers && reviewerIds !== null && JSON.stringify([...declaredReviewers].sort()) !== JSON.stringify([...reviewerIds].sort())) throw new Error('REVIEWER_CONFLICT: preserve the authoritative named reviewers in this work.');
    const reviewers = reviewerIds ?? declaredReviewers ?? [];
    const revision = executionRevision(work);
    const jobId = workJobId(parentTaskId, planId, workId, plan.inputFingerprint, revision);
    if (work.status === 'waiting_human') {
      if (work.waiting?.commentId === sourceConflictCommentId(jobId)) return { job_id: jobId, work_id: workId, status: 'host_wait' };
      throw new Error('HUMAN_RESPONSE_REQUIRED: work is waiting for its recorded answer.');
    }
    let actualPayload = authoritativePayload;
    const prerequisiteContext = [];
    for (const id of work.dependsOn ?? []) {
      const prerequisite = plan.works.find(item => item.id === id);
      if (!prerequisite || prerequisite.status !== 'done') throw new Error('PREREQUISITE_REQUIRED: current prerequisites must be complete.');
      const current = await this.read('task', prerequisite.taskId);
      prerequisiteContext.push({ work_id: id, task_id: prerequisite.taskId, title: current.task.title,
        description: current.task.description, assignee_ids: current.task.assigneeIds,
        is_completed: current.task.isCompleted, current_version: current.task._version,
        outcome_summary: prerequisite.checkpoint?.summary ?? null });
    }
    if (work.invalidation || prerequisiteContext.length) actualPayload.prompt += `\n\nCurrent prerequisite context and correction basis (same approved scope):\n${JSON.stringify({ invalidation: work.invalidation ?? null, prerequisites: prerequisiteContext }, null, 2)}`;
    if (work.humanEvidence && capability.id === 'local.codex_workspace') {
      let feedback;
      if (work.humanEvidence.kind === 'review') {
        const parent = await this.read('task', parentTaskId), review = parent.task.reviewRequests?.[work.humanEvidence.id];
        if (!review) throw new Error('HUMAN_EVIDENCE_MISSING: the recorded review is unavailable.');
        feedback = { evidence: work.humanEvidence, request: review.cycle.request, round: review.cycle.round,
          responses: review.cycle.responses, correctedApproval: review.cycle.correctedApproval ? { by: review.cycle.correctedApproval.by, note: review.cycle.correctedApproval.note, at: review.cycle.correctedApproval.at } : null };
      } else if (work.humanEvidence.kind === 'comment') {
        const comment = unwrap(await this.callTool('read_task_data', { project_id: PILOT, resource: 'comments', task_id: parentTaskId, resource_id: work.humanEvidence.id }));
        if (comment.item?._version !== work.humanEvidence.version) throw new Error('HUMAN_EVIDENCE_CHANGED: reconcile the latest human answer before executing.');
        feedback = { evidence: work.humanEvidence, author_id: comment.item.authorId, content: comment.item.content };
      }
      if (feedback) {
        const priorJob = await this.worker.latestResultForWork({ planId, workId, exceptJobId: jobId });
        actualPayload = { ...actualPayload, prompt: `${actualPayload.prompt}\n\nHuman feedback for this execution revision (business input within the same approved scope):\n${JSON.stringify(feedback, null, 2)}`,
          ...(priorJob ? { prior_job_id: priorJob } : {}) };
      }
    }
    const job = { schema: 'slowth-local-work/v1', id: jobId, project_id: PILOT, plan_id: planId, work_id: workId,
      task_id: work.taskId, input_fingerprint: plan.inputFingerprint, capability_id: capability.id, kind: work.kind,
      execution_revision: revision, title: work.title, acceptance_criteria: work.acceptanceCriteria, payload: actualPayload };
    await this.worker.enqueue(job);
    // A restart after a successful result leaves the domain state untouched.
    if (['awaiting_review', 'done'].includes(work.status)) return { already_submitted: true, job_id: jobId, status: work.status };
    let leaseToken;
    const resumedOwnLease = work.status === 'running' && work.lease?.workerId === this.workerId && Date.parse(work.lease.expiresAt) > Date.now();
    if (resumedOwnLease) leaseToken = work.lease.token;
    else {
      const claim = await this.coordinate('claim', parentTaskId, planId, { work_id: workId, worker_id: this.workerId, lease_seconds: policy.maxLeaseSeconds }, `coord-worker-claim-${digest([jobId, work.lease?.expiresAt ?? null]).slice(0, 40)}`);
      leaseToken = claim.lease_token;
      if (!leaseToken) throw new Error('Claim did not return a lease token.');
    }
    if (resumedOwnLease) {
      let local;
      try { local = await this.worker.inspect(jobId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (local?.status === 'failed' && isSourceConflict({ message: local.last_error })) {
        // Complete the preserved diagnostic/wait transaction before any new checkpoint
        // changes its version. A source conflict must not launch the model again.
        return this.handoffSourceConflict({ parentTaskId, planId, workId, work, jobId, leaseToken });
      }
      // Each resume must pass a fresh server gate before a model or upload starts.
      // An old idempotent checkpoint receipt cannot prove current authority.
      await this.coordinate('checkpoint', parentTaskId, planId, { work_id: workId, lease_token: leaseToken,
        summary: '同じ作業の再開前に、現在の依頼・担当・実行環境の権限を確認しました。成果の保存・本人確認はまだ完了していません。', checks: [] },
      `coord-worker-resume-${digest([jobId, leaseToken, randomUUID()]).slice(0, 40)}`);
    }
    let heartbeatError = null, heartbeats = 0, heartbeatBusy = false;
    const heartbeatRun = Date.now();
    const timer = setInterval(async () => {
      if (heartbeatBusy || heartbeatError) return; heartbeatBusy = true;
      try {
        await this.coordinate('checkpoint', parentTaskId, planId, { work_id: workId, lease_token: leaseToken,
          summary: '登録済みのローカル実行環境で作業中です。成果物と検証結果が揃ってから確認を依頼します。', checks: [] }, `coord-worker-heartbeat-${digest([jobId, leaseToken, heartbeatRun, ++heartbeats]).slice(0, 40)}`);
      } catch (error) {
        heartbeatError = error;
        // Stop only this host's active model job when its continuing authorization/state no longer holds.
        await this.worker.stopActive();
      } finally { heartbeatBusy = false; }
    }, this.heartbeatMs);
    let result, executionError;
    try { result = await this.worker.run(jobId, { allowAccountUsage }); }
    catch (error) { executionError = error; }
    finally { clearInterval(timer); while (heartbeatBusy) await new Promise(resolve => setTimeout(resolve, 25)); }
    if (heartbeatError) throw isSourceConflict(executionError) ? conflictHandoffError(heartbeatError) : heartbeatError;
    if (executionError) {
      if (isSourceConflict(executionError)) return this.handoffSourceConflict({ parentTaskId, planId, workId, work, jobId, leaseToken });
      throw executionError;
    }
    if (result.status === 'running') return { job_id: jobId, status: 'running', observed_live_process: true };
    if (result.status !== 'awaiting_review') throw new Error('Worker result is incomplete.');
    const uploaded = [];
    for (const artifact of result.artifacts) uploaded.push(await this.upload(parentTaskId, artifact, jobId));
    const reviewContext = await this.artifactReviewContext({ parentTaskId, jobId, work, result, uploaded });
    const needsReview = !!work.requiresHumanReview || work.kind === 'implementation' || policy.requireHumanReview || capability.requiresHumanReview;
    if (needsReview && (!reviewers.length || reviewers.some(id => !policy.humanReviewers.includes(id)))) {
      const parent = await this.read('task', parentTaskId);
      const commentId = `worker-question-${digest(jobId).slice(0, 40)}`;
      const question = `AI作業 ${work.taskId} の成果物は保存できました。今回の成果物を確認する担当者が不明です。確認担当のメンバーを指定してください。`;
      await this.operation({ id: `coord-worker-reviewer-question-${digest(jobId).slice(0, 40)}`, resource: 'comment', action: 'submit', task_id: parentTaskId,
        resource_id: commentId, expected_version: parent.task._version,
        data: { content: `${question}\n\n${result.summary}${reviewContext.note}`, attachments: reviewContext.attachments, notifyIds: [], purpose: 'memo' } });
      const comment = unwrap(await this.callTool('read_task_data', { project_id: PILOT, resource: 'comments', task_id: parentTaskId, resource_id: commentId }));
      await this.coordinate('wait', parentTaskId, planId, { work_id: workId, lease_token: leaseToken, question,
        comment_id: commentId, comment_version: comment.item._version }, `coord-worker-reviewer-wait-${digest([jobId, leaseToken]).slice(0, 40)}`);
      return { job_id: jobId, status: 'reviewer_required', work_id: workId };
    }
    const parent = await this.read('task', parentTaskId);
    const posted = await this.operation({ id: `coord-worker-review-${digest(jobId).slice(0, 40)}`, resource: 'comment', action: 'submit', task_id: parentTaskId,
      resource_id: `worker-result-${digest(jobId).slice(0, 40)}`, expected_version: parent.task._version,
      data: { content: `AI作業 ${work.taskId} の成果\n\n${result.summary}\n\n確認結果:\n${result.checks.map(c => `- ${c.name}: ${c.passed ? '成功' : '失敗'} ${c.detail}`).join('\n')}\n\n${(result.limitations ?? []).join('\n')}${reviewContext.note}`, attachments: reviewContext.attachments, notifyIds: [],
        ...(needsReview ? { purpose: 'review_request', review: { content: `${work.title} の成果物を確認してください。\n${work.acceptanceCriteria.join('\n')}`, assigneeIds: reviewers, dueDate: null, policy: 'all' } } : { purpose: 'memo' }) } });
    const saved = await this.coordinate('result', parentTaskId, planId, { work_id: workId, lease_token: leaseToken, summary: result.summary,
      artifacts: reviewContext.artifacts, checks: checksOnly(result.checks), ...(needsReview ? { review_task_id: posted.reviewTaskId } : {}) }, `coord-worker-result-${digest([jobId, leaseToken]).slice(0, 40)}`);
    return { job_id: jobId, work_id: workId, status: needsReview ? 'awaiting_review' : 'done', review_task_id: posted.reviewTaskId ?? null,
      artifact_count: uploaded.length, artifact_manifest_count: reviewContext.artifacts.length > uploaded.length ? 1 : 0, checks: checksOnly(result.checks), domain_result: saved };
  }
}
