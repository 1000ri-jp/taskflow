#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotRegisteredSource, changedWorkspaceFiles } from './source-snapshot.mjs';
import { captureWorkspaceDelta, restorePriorWorkspace } from './workspace-delta.mjs';
import { readWorkerConfig, assertPublicSourcePath } from './config.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_CONFIG = readWorkerConfig();
export const PILOT = WORKER_CONFIG.projectId;
const SOURCES = WORKER_CONFIG.sources;
export const REGISTERED_SOURCE_IDS = Object.freeze(Object.keys(SOURCES));
const ADAPTERS = {
  'local.evidence_package': 'research',
  'local.draft_artifact': 'draft',
  'local.isolated_patch': 'implementation',
  'local.codex_workspace': null,
};
// Match the existing MCP attachment.upload contract before persisting a completed result.
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ARTIFACT_MEDIA_TYPES = {
  '.md': 'text/markdown', '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.patch': 'text/x-diff',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const now = () => new Date().toISOString();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  : value;
const fingerprint = value => sha(JSON.stringify(stable(value)));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fail = message => { throw new Error(message); };

function isolationArgs() {
  const configNames = spawnSync(WORKER_CONFIG.pythonCommand, ['-c', "import pathlib,tomllib,json,os;p=pathlib.Path(os.environ.get('CODEX_HOME',str(pathlib.Path.home()/'.codex')))/'config.toml';d=tomllib.loads(p.read_text()) if p.exists() else {};print(json.dumps({'mcp':list(d.get('mcp_servers',{})),'plugins':list(d.get('plugins',{}))}))"], { encoding: 'utf8' });
  if (configNames.status !== 0) fail('Cannot inspect configured executor tool names; refusing an uncontrolled job.');
  const names = JSON.parse(configNames.stdout);
  return [
    ...names.mcp.flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]),
    ...names.plugins.flatMap(name => ['-c', `plugins.${name}.enabled=false`]),
  ];
}

// Registered build resources are executor context, never caller-selected destinations.
export function registeredNetworkPolicy(sourceId) {
  if (!REGISTERED_SOURCE_IDS.includes(sourceId)) fail('Unknown source_id.');
  const domains = sourceId === 'slowth-source' ? ['fonts.googleapis.com', 'fonts.gstatic.com'] : [];
  return {
    source_id: sourceId,
    proxy_enforced: domains.length > 0,
    allowed_domains: domains,
    purpose: domains.length ? 'Existing Next compiler Google Fonts resources only' : 'Offline registered-source work',
    args: [
      '-c', `features.network_proxy.enabled=${domains.length > 0}`,
      '-c', `features.network_proxy.domains=${domains.length ? '{ "fonts.googleapis.com" = "allow", "fonts.gstatic.com" = "allow" }' : '{}'}`,
      '-c', `sandbox_workspace_write.network_access=${domains.length > 0}`,
    ],
  };
}

async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temp, file);
}
async function previousExecutorReport(dir, attempt) {
  for (let prior = attempt - 1; prior > 0; prior--) {
    try { return await json(path.join(dir, `codex-result-attempt-${prior}.json`)); }
    catch (error) { if (error instanceof SyntaxError) return null; if (error.code !== 'ENOENT') throw error; }
  }
  if (attempt < 2) return null;
  let legacy;
  try { legacy = await fs.readFile(path.join(dir, 'codex-result.json')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const archive = path.join(dir, 'codex-result-legacy.json');
  try {
    if (sha(await fs.readFile(archive)) !== sha(legacy)) fail('EXECUTOR_HISTORY_CONFLICT: preserve the original legacy response.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; await atomic(archive, legacy); }
  // Legacy output has no trusted attempt identity. Preserve its bytes without inventing one.
  try { return JSON.parse(legacy); } catch (error) { if (error instanceof SyntaxError) return null; throw error; }
}
function relative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(p => ['..', '.', '', 'node_modules', '.git', '.next'].includes(p))) fail('Use an explicit safe relative file path.');
  if (value.split('/').some(p => p.startsWith('.env') || /\.(pem|key|p12|pfx)$/i.test(p) || /(?:service.?account|credential|secret|token|auth)[^/]*\.json$/i.test(p))) fail('Credential/config source files are not job inputs.');
  return value;
}
async function sourceFile(sourceId, name) {
  if (!SOURCES[sourceId]) fail('Unknown source_id.');
  const base = await fs.realpath(SOURCES[sourceId]);
  const resolved = await fs.realpath(path.join(base, relative(name)));
  if (!resolved.startsWith(base + path.sep)) fail('Source file leaves its registered source.');
  assertPublicSourcePath(resolved, WORKER_CONFIG);
  const bytes = await fs.readFile(resolved);
  if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) fail('Use a text source file smaller than 2 MiB.');
  return { bytes, path: resolved };
}
function validateJob(job) {
  if (job.schema !== 'slowth-local-work/v1' || job.project_id !== PILOT) fail('Job schema or project scope is invalid.');
  if (typeof job.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(job.id)) fail('Use a stable job ID.');
  for (const key of ['plan_id', 'work_id', 'task_id', 'input_fingerprint', 'title']) if (typeof job[key] !== 'string' || !job[key].trim()) fail(`${key} is required.`);
  if (!Array.isArray(job.acceptance_criteria) || !job.acceptance_criteria.length || job.acceptance_criteria.some(v => typeof v !== 'string' || !v.trim())) fail('Acceptance criteria are required.');
  if (!(job.capability_id in ADAPTERS) || !['research', 'draft', 'implementation'].includes(job.kind) || ADAPTERS[job.capability_id] && ADAPTERS[job.capability_id] !== job.kind) fail('Capability and work kind do not match.');
  if (!job.payload || typeof job.payload !== 'object') fail('payload is required.');
  if (job.payload.checks?.some(check => check.type === 'node_test')) fail('EXECUTABLE_CHECK_ISOLATION_REQUIRED: node_test is disabled until an enforced host execution sandbox is available. Run behavioral checks inside the isolated executor and report their observed results.');
  if (job.capability_id === 'local.codex_workspace' && typeof job.payload.prompt !== 'string') fail('Codex work needs an explicit prompt.');
}

export class LocalWorker {
  constructor(options = {}) {
    this.stateRoot = path.resolve(options.stateRoot ?? WORKER_CONFIG.stateDirectory);
    this.codexCommand = options.codexCommand ?? WORKER_CONFIG.codexCommand;
    this.codexConfigArgs = options.codexConfigArgs ?? null;
  }
  directory(id) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id)) fail('Invalid job ID.');
    return path.join(this.stateRoot, 'jobs', id);
  }
  async enqueue(job) {
    validateJob(job);
    const dir = this.directory(job.id), hash = fingerprint(job);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'job.json');
    try {
      const current = await json(file);
      if (fingerprint(current) !== hash) fail('IDEMPOTENCY_CONFLICT: same job ID has different input.');
      return { already_enqueued: true, ...(await this.inspect(job.id)) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // exclusive creation prevents two different inputs racing for one identity
    const handle = await fs.open(file, 'wx');
    try { await handle.writeFile(JSON.stringify(job, null, 2) + '\n'); } finally { await handle.close(); }
    await atomic(path.join(dir, 'state.json'), { schema: 'slowth-local-state/v1', id: job.id, input_hash: hash, status: 'queued', attempts: 0, created_at: now(), updated_at: now() });
    return this.inspect(job.id);
  }
  async inspect(id) {
    const state = await json(path.join(this.directory(id), 'state.json'));
    return { ...state, process_alive: state.status === 'running' && [state.worker_pid, state.child_pid].some(pid => Number.isInteger(pid) && alive(pid)) };
  }
  async latestResultForWork({ planId, workId, exceptJobId }) {
    let names;
    try { names = await fs.readdir(path.join(this.stateRoot, 'jobs')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const candidates = [];
    for (const name of names) {
      if (name === exceptJobId) continue;
      try {
        const job = await json(path.join(this.directory(name), 'job.json')), result = await json(path.join(this.directory(name), 'result.json'));
        if (job.project_id === PILOT && job.plan_id === planId && job.work_id === workId && result.status === 'awaiting_review') candidates.push({ id: name, at: result.completed_at });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return candidates.sort((a, b) => b.at.localeCompare(a.at))[0]?.id ?? null;
  }
  async stopActive() {
    try {
      const active = await json(path.join(this.stateRoot, 'active.json'));
      if (active.worker_pid === process.pid && active.child_pid && alive(active.child_pid)) {
        process.kill(active.child_pid, 'SIGTERM'); return { signalled: true, job_id: active.job_id };
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { signalled: false };
  }
  async run(id, options = {}) {
    const dir = this.directory(id), job = await json(path.join(dir, 'job.json'));
    validateJob(job);
    let state = await this.inspect(id);
    if (state.status === 'awaiting_review') return { already_completed: true, ...(await json(path.join(dir, 'result.json'))) };
    if (state.process_alive) return { status: 'running', observed_live_process: true, worker_pid: state.worker_pid, child_pid: state.child_pid };
    const lock = path.join(this.stateRoot, 'active.json');
    await fs.mkdir(this.stateRoot, { recursive: true });
    try {
      const previous = await json(lock);
      if (alive(previous.worker_pid) || previous.child_pid && alive(previous.child_pid)) fail(`WORKER_BUSY: live job ${previous.job_id}.`);
      await fs.unlink(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lockHandle = await fs.open(lock, 'wx');
    await lockHandle.writeFile(JSON.stringify({ job_id: id, worker_pid: process.pid, started_at: now() }));
    await lockHandle.close();
    state = { ...state, status: 'running', attempts: state.attempts + 1, worker_pid: process.pid, child_pid: null, updated_at: now() };
    delete state.process_alive;
    const update = async patch => { state = { ...state, ...patch, updated_at: now() }; await atomic(path.join(dir, 'state.json'), state); };
    await update({});
    try {
      await fs.mkdir(path.join(dir, 'artifacts'), { recursive: true });
      const outcome = job.capability_id === 'local.codex_workspace'
        ? await this.codex(job, dir, update, lock, options)
        : job.kind === 'research' ? await this.research(job, dir)
          : job.kind === 'draft' ? await this.draft(job, dir) : await this.patch(job, dir);
      const result = {
        schema: 'slowth-local-result/v1', status: 'awaiting_review', job_id: id,
        plan_id: job.plan_id, work_id: job.work_id, task_id: job.task_id,
        input_fingerprint: job.input_fingerprint, completed_at: now(), ...outcome,
        coordinator_checkpoint: { work_id: job.work_id, summary: `${outcome.summary}\n成果物はローカル保存。Slowthへの添付・確認依頼には接続済みの返却経路が必要です。`, checks: outcome.checks.map(({ name, passed, detail }) => ({ name, passed, detail })) },
        integration_note: 'Local paths are not Dot-readable URLs. Upload using verified MCP file operations before coordination.result. Preserve the claim lease in the caller; this worker never writes or acknowledges Slowth.',
      };
      await atomic(path.join(dir, 'result.json'), result);
      await update({ status: 'awaiting_review', worker_pid: null, child_pid: null, result_path: path.join(dir, 'result.json'), last_error: null });
      return result;
    } catch (error) {
      await update({ status: 'failed', worker_pid: null, child_pid: null, last_error: error.message });
      await atomic(path.join(dir, 'error.json'), { schema: 'slowth-local-result/v1', status: 'failed', job_id: id, work_id: job.work_id, error: error.message, observed_at: now() });
      throw error;
    } finally {
      try { const current = await json(lock); if (current.job_id === id && current.worker_pid === process.pid) await fs.unlink(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  async artifact(dir, name, label, mediaType, contents) {
    const file = path.join(dir, 'artifacts', relative(name));
    await atomic(file, contents);
    return this.describeArtifact(file, label, mediaType);
  }
  async describeArtifact(file, label, mediaType = 'text/plain') {
    const bytes = await fs.readFile(file);
    return { label, path: file, sha256: sha(bytes), bytes: bytes.length, media_type: mediaType, access: 'local_host_only' };
  }
  async registeredSourceBytes(sourceId, name) {
    if (!SOURCES[sourceId]) fail('Unknown source_id.');
    const base = await fs.realpath(SOURCES[sourceId]);
    try {
      const real = await fs.realpath(path.join(base, relative(name)));
      if (!real.startsWith(base + path.sep)) fail('Source file leaves its registered source.');
      assertPublicSourcePath(real, WORKER_CONFIG);
      return await fs.readFile(real);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async research(job, dir) {
    if (!Array.isArray(job.payload.sources) || !job.payload.sources.length || typeof job.payload.findings_markdown !== 'string') fail('Research needs sources and supplied findings.');
    const evidence = [];
    for (const item of job.payload.sources) {
      const original = await sourceFile(item.source_id, item.path), lines = original.bytes.toString('utf8').split('\n');
      const start = item.start_line ?? 1, end = item.end_line ?? Math.min(lines.length, 200);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length || end - start > 500) fail('Invalid source line range.');
      evidence.push({ source_id: item.source_id, path: item.path, sha256: sha(original.bytes), start_line: start, end_line: end, excerpt: lines.slice(start - 1, end).join('\n') });
    }
    const report = `# ${job.title}\n\n${job.payload.findings_markdown}\n\n## 根拠\n\n` + evidence.map(e => `### ${e.source_id}/${e.path}:${e.start_line}\n\nSHA-256: ${e.sha256}\n\n\`\`\`text\n${e.excerpt}\n\`\`\`\n`).join('\n');
    return { summary: '登録済みの資料から根拠を採取し、提供された調査結果と出典・ハッシュを保存しました。', artifacts: [await this.artifact(dir, 'research.md', '調査結果と根拠', 'text/markdown', report), await this.artifact(dir, 'evidence.json', '根拠の原文・範囲・ハッシュ', 'application/json', evidence)], checks: [{ name: 'source-provenance', passed: true, detail: `${evidence.length} registered text sources captured with exact digest and line ranges.` }] };
  }
  async draft(job, dir) {
    const markdown = job.payload.markdown;
    if (typeof markdown !== 'string' || !markdown.trim()) fail('Draft text is required.');
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${escapeHtml(job.title)}</title><style>body{font:16px/1.8 system-ui;max-width:900px;margin:40px auto;padding:0 24px}pre{white-space:pre-wrap;font:inherit}</style><h1>${escapeHtml(job.title)}</h1><pre>${escapeHtml(markdown)}</pre></html>\n`;
    return { summary: '提供された下書きをMarkdownとHTMLとして保存しました。内容の新規生成や公開は行っていません。', artifacts: [await this.artifact(dir, 'draft.md', '下書き Markdown', 'text/markdown', markdown), await this.artifact(dir, 'draft.html', '下書き HTML', 'text/html', html)], checks: [{ name: 'draft-content', passed: true, detail: 'Non-empty draft preserved; HTML markup in supplied content escaped.' }] };
  }
  async prepareFiles(dir, sourceId, files) {
    if (!SOURCES[sourceId]) fail('Unknown source_id.');
    if (!files.length) return snapshotRegisteredSource(SOURCES[sourceId], dir, { excludeRoots: [WORKER_CONFIG.configFile, this.stateRoot] });
    const workspace = path.join(dir, 'workspace'), baseline = path.join(dir, 'baseline');
    await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(baseline, { recursive: true });
    const input = [];
    for (const file of files) {
      const name = relative(typeof file === 'string' ? file : file.path);
      let original;
      try { original = await sourceFile(sourceId, name); } catch (error) { if (error.code !== 'ENOENT' || typeof file === 'string' || file.expected_sha256 !== null) throw error; }
      const expected = typeof file === 'string' ? original && sha(original.bytes) : file.expected_sha256;
      if (original && expected !== sha(original.bytes) || !original && expected !== null) fail(`SOURCE_VERSION_CONFLICT: ${name}`);
      const marker = path.join(baseline, `${name}.baseline.json`);
      let old;
      try { old = await json(marker); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (old && old.sha256 !== expected) fail(`SOURCE_VERSION_CONFLICT: ${name} changed since initial intake.`);
      if (!old) {
        await atomic(marker, { path: name, sha256: expected, existed: !!original });
        if (original) { await atomic(path.join(baseline, name), original.bytes.toString('utf8')); await atomic(path.join(workspace, name), original.bytes.toString('utf8')); }
      }
      input.push({ path: name, sha256: expected, existed: !!original });
    }
    return { workspace, baseline, input };
  }
  async patch(job, dir) {
    if (!Array.isArray(job.payload.files) || !job.payload.files.length) fail('Implementation needs explicit edited files.');
    const { workspace, baseline, input } = await this.prepareFiles(dir, job.payload.source_id, job.payload.files);
    for (const file of job.payload.files) {
      if (typeof file.content !== 'string') fail('Each patch file needs complete desired content.');
      await atomic(path.join(workspace, relative(file.path)), file.content);
    }
    const checks = await this.checks(workspace, job.payload.checks ?? [], job.payload.files.map(f => f.path));
    if (checks.some(c => !c.passed)) fail(`VALIDATION_FAILED: ${checks.filter(c => !c.passed).map(c => c.name).join(', ')}`);
    const diff = await this.diff(workspace, baseline, input.map(f => f.path));
    return { summary: '元資料を変更せず、別の作業領域に変更を適用し、差分と指定された確認結果を保存しました。', artifacts: [await this.artifact(dir, 'changes.patch', '実装差分（未適用）', 'text/x-diff', diff), await this.artifact(dir, 'baseline.json', '変更前の資料ハッシュ', 'application/json', input)], checks };
  }
  async checks(workspace, specs, allowedFiles = null) {
    const checks = [];
    for (const spec of specs) {
      const name = relative(spec.path);
      if (allowedFiles && !allowedFiles.includes(name)) fail('Check path must name an edited file.');
      const file = await fs.realpath(path.join(workspace, name));
      if (!file.startsWith(await fs.realpath(workspace) + path.sep)) fail('CHECK_OUTSIDE_WORKSPACE: checks cannot read outside the isolated workspace.');
      if (spec.type === 'json_validate') {
        try { await json(file); checks.push({ name: `json:${name}`, passed: true, detail: 'Valid JSON.' }); }
        catch (error) { checks.push({ name: `json:${name}`, passed: false, detail: error.message }); }
      } else if (spec.type === 'node_test') {
        fail('EXECUTABLE_CHECK_ISOLATION_REQUIRED: generated code must not execute as the privileged host.');
      } else if (spec.type === 'node_syntax') {
        // Syntax validation never evaluates generated source. Use an allowlist so
        // NODE_OPTIONS/NODE_PATH cannot preload host code or inherit credentials.
        const result = spawnSync(process.execPath, ['--check', file], { cwd: workspace, encoding: 'utf8', timeout: 30000, env: { LANG: 'C.UTF-8' } });
        checks.push({ name: `${spec.type}:${name}`, passed: result.status === 0, detail: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`.slice(-8000) || 'Passed.' });
      } else fail('Unsupported check type.');
    }
    return checks;
  }
  localEnvironment() {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('SLOWTH_MCP_') || ['SLOWTH_WORKER_CONFIG',
      'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
      'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'GCLOUD_SERVICE_ACCOUNT_KEY',
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
    return env;
  }
  async diff(workspace, baseline, names) {
    let text = '';
    for (const name of names) {
      const before = path.join(baseline, name), after = path.join(workspace, name);
      const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
      const result = spawnSync('git', ['diff', '--no-index', '--binary', '--src-prefix=', '--dst-prefix=', '--', await exists(before) ? `baseline/${name}` : '/dev/null', await exists(after) ? `workspace/${name}` : '/dev/null'], { cwd: path.dirname(workspace), encoding: 'utf8' });
      if (![0, 1].includes(result.status)) fail(`Diff failed for ${name}: ${result.stderr}`);
      text += (result.stdout ?? '').split('\n').map(line => line.startsWith('diff --git ')
        ? `diff --git a/${name} b/${name}`
        : line.startsWith('--- ') ? line.replace('--- baseline/', '--- a/')
          : line.startsWith('+++ ') ? line.replace('+++ workspace/', '+++ b/') : line).join('\n');
    }
    return text;
  }
  async codex(job, dir, update, lock, options) {
    const attempt = (await this.inspect(job.id)).attempts;
    const previousReport = await previousExecutorReport(dir, attempt);
    if (!options.allowAccountUsage) fail('ACCOUNT_USAGE_REQUIRED: run with --allow-account-usage after confirming existing ChatGPT-backed auth.');
    const networkPolicy = registeredNetworkPolicy(job.payload.source_id ?? 'worker-fixture');
    const isolationOverrides = [...(this.codexConfigArgs ?? isolationArgs()), ...networkPolicy.args];
    const login = spawnSync(this.codexCommand, [...isolationOverrides, 'login', 'status'], { encoding: 'utf8', env: this.localEnvironment() });
    const configRejected = /Error loading config|invalid transport|failed to parse|unknown field/i.test(`${login.stdout}${login.stderr}`);
    await atomic(path.join(dir, `executor-preflight-attempt-${(await this.inspect(job.id)).attempts}.json`), {
      observed_at: now(), configAccepted: login.status === 0 && !configRejected,
      chatGPTLogin: login.status === 0 && `${login.stdout}${login.stderr}`.includes('Logged in using ChatGPT'),
      modelInvoked: false, networkPolicy: { ...networkPolicy, args: undefined },
    });
    if (configRejected) fail('EXECUTOR_CONFIG_REJECTED: isolation configuration must parse before any model invocation.');
    if (login.status !== 0 || !`${login.stdout}${login.stderr}`.includes('Logged in using ChatGPT')) fail('CHATGPT_LOGIN_REQUIRED: API billing fallback is disabled.');
    const files = job.payload.files ?? [];
    if (!Array.isArray(files)) fail('Codex file intake must be explicit.');
    const { workspace, baseline, input } = await this.prepareFiles(dir, job.payload.source_id ?? 'worker-fixture', files);
    let restored;
    if (job.payload.prior_job_id) {
      const previousDir = this.directory(job.payload.prior_job_id), previousJob = await json(path.join(previousDir, 'job.json'));
      const previous = await json(path.join(previousDir, 'result.json'));
      if (previousJob.plan_id !== job.plan_id || previousJob.work_id !== job.work_id || previousJob.project_id !== PILOT || previous.status !== 'awaiting_review') fail('PRIOR_RESULT_MISMATCH: correction must continue the same work.');
      restored = await restorePriorWorkspace({ dir, workspace, input, previousDir, previousJob, previous, job, safePath: relative, write: atomic,
        currentSourceBytes: name => this.registeredSourceBytes(job.payload.source_id ?? 'worker-fixture', name) });
    }
    const resultFile = path.join(dir, `codex-result-attempt-${attempt}.json`);
    try { await fs.access(resultFile); fail('EXECUTOR_HISTORY_CONFLICT: never overwrite an existing attempt response.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const outputRule = job.kind === 'implementation' ? 'The worker generates an implementation diff from actual workspace changes even when your artifacts list is empty. List any additional output files explicitly.' : 'Save at least one non-empty actual artifact file for the requested research or draft output.';
    const prompt = `You are executing one approved Slowth work item. Write results in Japanese.\nWork ID: ${job.work_id}\nKind: ${job.kind}\nTitle: ${job.title}\nAcceptance: ${job.acceptance_criteria.join('; ')}\n\nWork only within this isolated workspace. Do not access parent source snapshots, credentials, production, web browsers, external MCP tools, paid APIs, package installs, release systems or unrelated jobs. Existing source rules copied into this workspace apply. A registered node_modules link, when present, is read-only; use its existing dependencies and node_modules/next/dist/docs for relevant Next guides without modifying/installing dependencies. Network is ${networkPolicy.proxy_enforced ? 'restricted by an enforced proxy to fonts.googleapis.com and fonts.gstatic.com for existing compiler resources only; do not make separate network requests or change the network policy' : 'disabled'}. Do the actual requested work and relevant checks. Do not claim human acceptance. Preserve partial progress on retry; inspect existing files before repeating work. ${outputRule} Each returned artifact must fit the existing 10 MiB attachment limit; split larger output into separate files. Return actual relative artifact paths and observed checks.\n\nExecution and publication are separate stages. Your checks cover only work and content you actually verified inside this workspace. Keep every failed content or execution check false; fix those failures before returning. The connected host uploads artifacts, saves the parent comment, creates the human review request, and records coordination.result AFTER your successful response. You cannot verify those host actions or human acceptance here. Describe those pending actions in limitations, not as failed checks, and never claim they have happened. On a retry, inspect the preserved artifacts and previous attempt response; reuse valid work instead of repeating completed research.\n\nBusiness request:\n${job.payload.prompt}\n`;
    const retryContext = previousReport ? `\nPrevious attempt report (historical evidence, not proof of host publication; inspect the preserved workspace artifacts and fix actual content failures):\n${JSON.stringify(previousReport, null, 2)}\n` : '';
    await atomic(path.join(dir, 'prompt.txt'), prompt + retryContext);
    const args = ['exec', '--ephemeral', '--json', '--color', 'never', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', workspace, '--output-schema', path.join(ROOT, 'codex-output.schema.json'), '--output-last-message', resultFile, ...isolationOverrides, '-'];
    await atomic(path.join(dir, 'invocation.json'), { executable: this.codexCommand, args, model: 'configured default; no model override', authentication: 'existing ChatGPT CLI login; no API-key fallback', network_policy: { ...networkPolicy, args: undefined }, source_inputs: input });
    const stdout = await fs.open(path.join(dir, `codex-attempt-${(await this.inspect(job.id)).attempts}.jsonl`), 'w');
    const stderr = await fs.open(path.join(dir, `codex-attempt-${(await this.inspect(job.id)).attempts}.stderr.log`), 'w');
    let child, code;
    try {
      child = spawn(this.codexCommand, args, { cwd: workspace, env: this.localEnvironment(), stdio: ['pipe', stdout.fd, stderr.fd] });
      await update({ child_pid: child.pid, execution_started_at: now() });
      await atomic(lock, { job_id: job.id, worker_pid: process.pid, child_pid: child.pid, started_at: now() });
      child.stdin.end(prompt + retryContext);
      code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => signal ? reject(new Error(`Codex interrupted: ${signal}`)) : resolve(code)); });
    } finally { await stdout.close(); await stderr.close(); }
    try { await atomic(path.join(dir, 'codex-result.json'), await fs.readFile(resultFile)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (code !== 0) fail(`CODEX_EXIT_${code}: inspect this job's attempt log; same job remains resumable.`);
    const response = await json(resultFile);
    if (typeof response.summary !== 'string' || !Array.isArray(response.artifacts) || !Array.isArray(response.checks)) fail('Codex final response did not match the result contract.');
    if (['research', 'draft'].includes(job.kind) && !response.artifacts.length) fail('ARTIFACT_REQUIRED: save the requested output as an actual workspace file before returning a result.');
    const checks = [...response.checks.map(c => ({ ...c, origin: 'executor_report' })), ...(await this.checks(workspace, job.payload.checks ?? [])).map(c => ({ ...c, origin: 'worker_verified' }))];
    if (checks.some(c => !c.passed)) fail('VALIDATION_FAILED: preserve workspace and review failed checks.');
    const artifacts = [];
    for (const item of response.artifacts) {
      const name = relative(item.path), real = await fs.realpath(path.join(workspace, name));
      if (!real.startsWith(await fs.realpath(workspace) + path.sep)) fail('Artifact leaves isolated workspace.');
      const artifact = await this.describeArtifact(real, item.label, ARTIFACT_MEDIA_TYPES[path.extname(name).toLowerCase()] ?? 'text/plain');
      if (['research', 'draft'].includes(job.kind) && !artifact.bytes) fail(`ARTIFACT_EMPTY: ${name} must contain the requested output.`);
      artifacts.push(artifact);
    }
    const names = await changedWorkspaceFiles(workspace, baseline, input.map(i => i.path));
    if (job.kind === 'implementation') artifacts.push(await this.artifact(dir, 'changes.patch', 'Codexによる実装差分（未適用）', 'text/x-diff', await this.diff(workspace, baseline, names)));
    for (const artifact of artifacts) if (artifact.bytes > MAX_ARTIFACT_BYTES) fail(`ARTIFACT_TOO_LARGE: ${path.basename(artifact.path)} exceeds the existing 10 MiB attachment limit; split or reduce the output before resuming.`);
    const actualWorkspace = await fs.realpath(workspace);
    const artifactPaths = artifacts.filter(item => item.path.startsWith(actualWorkspace + path.sep)).map(item => relative(path.relative(actualWorkspace, item.path)));
    const delta = await captureWorkspaceDelta({ dir, workspace, input, job, safePath: relative, artifactPaths });
    const deltaFile = path.join(dir, 'workspace-delta.json');
    await atomic(deltaFile, delta);
    const workspace_delta = await this.describeArtifact(deltaFile, '修正引き継ぎ用の実変更記録', 'application/json');
    return { summary: response.summary, artifacts, checks, limitations: [...(response.limitations ?? []), ...(restored?.limitation ? [restored.limitation] : [])], execution: { adapter: 'codex exec', authentication: 'ChatGPT', model: 'configured default', isolated_workspace: workspace, actual_model_invocation: true, workspace_delta } };
  }
}

async function cli() {
  const [command, value, ...flags] = process.argv.slice(2), worker = new LocalWorker();
  if (command === 'registry') return { schema: 'slowth-worker-adapters/v1', project_id: PILOT,
    registered_source_ids: REGISTERED_SOURCE_IDS, automatic_registration: false,
    adapters: Object.entries(ADAPTERS).map(([id, kind]) => ({ id, kinds: kind ? [kind] : ['research', 'draft', 'implementation'],
      usage: id === 'local.codex_workspace' ? 'connected_contract_after_server_verification' : 'offline_utility_only',
      server_verification_required: true, requires_human_review: true })) };
  if (command === 'enqueue') return worker.enqueue(await json(path.resolve(value)));
  if (command === 'inspect') return worker.inspect(value);
  if (command === 'run') {
    return worker.run(value, { allowAccountUsage: flags.includes('--allow-account-usage') });
  }
  if (command === 'result') return json(path.join(worker.directory(value), 'result.json'));
  fail('Usage: node worker.mjs registry | enqueue <job.json> | inspect <job-id> | run <job-id> [--allow-account-usage] | result <job-id>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
