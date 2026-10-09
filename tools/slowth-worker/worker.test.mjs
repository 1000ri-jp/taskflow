import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { LocalWorker, PILOT, ROOT } from './worker.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const job = (id, kind, payload) => ({ schema: 'slowth-local-work/v1', id, project_id: PILOT, plan_id: 'fixture-plan', work_id: 'fixture-work', task_id: 'fixture-child', input_fingerprint: hash('fixture-input'), capability_id: { research: 'local.evidence_package', draft: 'local.draft_artifact', implementation: 'local.isolated_patch' }[kind], kind, title: '架空検証', acceptance_criteria: ['成果物が残り、人間の確認を待つ'], payload });
async function context(t) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-worker-test-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  return new LocalWorker({ stateRoot });
}
test('research retains exact source evidence and idempotent replay without changing source', async t => {
  const worker = await context(t), source = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const input = job('research', 'research', { sources: [{ source_id: 'worker-fixture', path: 'example.mjs', start_line: 1, end_line: 3 }], findings_markdown: '現行関数は完了状態を見ずに全件を数えています。' });
  await worker.enqueue(input);
  const result = await worker.run(input.id);
  assert.equal(result.status, 'awaiting_review');
  const evidence = JSON.parse(await fs.readFile(result.artifacts[1].path, 'utf8'));
  assert.equal(evidence[0].sha256, hash(source)); assert.match(evidence[0].excerpt, /tasks.length/);
  assert.equal((await worker.enqueue(input)).already_enqueued, true);
  assert.equal((await worker.run(input.id)).already_completed, true);
  assert.equal((await worker.inspect(input.id)).attempts, 1);
  assert.deepEqual(await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs')), source);
  await assert.rejects(worker.enqueue({ ...input, title: 'changed' }), /IDEMPOTENCY_CONFLICT/);
});
test('draft creates readable artifacts while escaping supplied HTML', async t => {
  const worker = await context(t), input = job('draft', 'draft', { markdown: '# 運用手順\n\n<script>alert(1)</script>\n人間の確認を待ちます。' });
  await worker.enqueue(input); const result = await worker.run(input.id);
  assert.equal(result.artifacts.length, 2);
  assert.match(await fs.readFile(result.artifacts[1].path, 'utf8'), /&lt;script&gt;/);
  assert.equal(await fs.readFile(result.artifacts[0].path, 'utf8'), input.payload.markdown);
});
test('isolated implementation rejects stale source, then applies exact patch with checks', async t => {
  const worker = await context(t), source = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const valid = job('patch', 'implementation', { source_id: 'worker-fixture', files: [{ path: 'example.mjs', expected_sha256: hash(source), content: 'export function pendingCount(tasks) {\n  return tasks.filter(t => t.isCompleted !== true).length;\n}\n' }], checks: [{ type: 'node_syntax', path: 'example.mjs' }] });
  const stale = { ...valid, id: 'stale', payload: { ...valid.payload, files: [{ ...valid.payload.files[0], expected_sha256: '0'.repeat(64) }] } };
  await worker.enqueue(stale); await assert.rejects(worker.run(stale.id), /SOURCE_VERSION_CONFLICT/);
  assert.equal((await worker.inspect(stale.id)).status, 'failed');
  await worker.enqueue(valid); const result = await worker.run(valid.id);
  assert.equal(result.checks[0].passed, true);
  const diff = await fs.readFile(result.artifacts[0].path, 'utf8');
  assert.match(diff, /--- a\/example\.mjs/); assert.match(diff, /\+.*isCompleted/);
  assert.deepEqual(await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs')), source);
});
test('checks that fail keep work open, and active subprocess identity prevents duplicate launch', async t => {
  const worker = await context(t), source = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const input = job('invalid', 'implementation', { source_id: 'worker-fixture', files: [{ path: 'example.mjs', expected_sha256: hash(source), content: 'export function broken( {' }], checks: [{ type: 'node_syntax', path: 'example.mjs' }] });
  await worker.enqueue(input); await assert.rejects(worker.run(input.id), /VALIDATION_FAILED/);
  assert.equal((await worker.inspect(input.id)).status, 'failed');
  const statePath = path.join(worker.directory(input.id), 'state.json'), state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  await fs.writeFile(statePath, JSON.stringify({ ...state, status: 'running', worker_pid: process.pid }));
  const observed = await worker.run(input.id);
  assert.equal(observed.observed_live_process, true); assert.equal((await worker.inspect(input.id)).attempts, 1);
});
test('codex adapter requires explicitly enabled account usage and never silently falls back to API keys', async t => {
  const worker = await context(t), input = { ...job('codex-gate', 'implementation', { prompt: 'fixture', files: [] }), capability_id: 'local.codex_workspace' };
  await worker.enqueue(input); await assert.rejects(worker.run(input.id), /ACCOUNT_USAGE_REQUIRED/);
  const env = worker.localEnvironment();
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_API_KEY, undefined);
});

async function executorFixture(t, rejectConfig, output = {}) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-executor-test-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const callsFile = path.join(stateRoot, 'calls.jsonl'), executable = path.join(stateRoot, 'executor.mjs');
  const files = Object.fromEntries(Object.entries(output.files ?? { 'fixture-result.md': '架空成果物' }).map(([name, contents]) => [name, Buffer.isBuffer(contents) ? { base64: contents.toString('base64') } : contents]));
  await fs.writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args)+'\\n');
if(args.includes('login')) { console.log(${JSON.stringify(rejectConfig ? 'Error loading config.toml: invalid transport' : 'Logged in using ChatGPT')}); process.exit(${rejectConfig ? 1 : 0}); }
for (const [name, expected] of Object.entries(${JSON.stringify(output.verifyFiles ?? {})})) if (expected === null ? fs.existsSync(name) : createHash('sha256').update(fs.readFileSync(name)).digest('hex') !== expected) throw new Error('Restored artifact bytes differ: '+name);
for (const name of ${JSON.stringify(output.removeFiles ?? [])}) fs.rmSync(name, {force:true});
for (const [name, contents] of Object.entries(${JSON.stringify(files)})) { fs.mkdirSync(path.dirname(name), {recursive:true}); fs.writeFileSync(name, typeof contents === 'number' ? Buffer.alloc(contents, 65) : contents?.base64 ? Buffer.from(contents.base64, 'base64') : contents); }
fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify(${JSON.stringify(output.response ?? {summary:'架空成果物',artifacts:[{path:'fixture-result.md',label:'架空成果物'}],checks:[{name:'fixture',passed:true,detail:'test executor'}],limitations:[]})}));
`, { mode: 0o700 });
  return { worker: new LocalWorker({ stateRoot, codexCommand: executable, codexConfigArgs: ['-c', 'mcp_servers.pencil.enabled=false'] }), callsFile };
}

test('invalid executor isolation config stops before a model job is invoked', async t => {
  const { worker, callsFile } = await executorFixture(t, true);
  const input = { ...job('reject-config', 'research', { source_id: 'worker-fixture', prompt: 'fixture', files: ['example.mjs'] }), capability_id: 'local.codex_workspace' };
  await worker.enqueue(input);
  await assert.rejects(worker.run(input.id, { allowAccountUsage: true }), /EXECUTOR_CONFIG_REJECTED/);
  const calls = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('login')); assert.ok(!calls[0].includes('exec'));
  const preflight = JSON.parse(await fs.readFile(path.join(worker.directory(input.id), 'executor-preflight-attempt-1.json'), 'utf8'));
  assert.equal(preflight.configAccepted, false); assert.equal(preflight.modelInvoked, false);
});

test('executor preflight and model invocation use the same policy and fixtures stay offline', async t => {
  const { worker, callsFile } = await executorFixture(t, false);
  const input = { ...job('accepted-config', 'research', { source_id: 'worker-fixture', prompt: 'fixture', files: ['example.mjs'], allowed_domains: ['caller.invalid'] }), capability_id: 'local.codex_workspace' };
  await worker.enqueue(input);
  const result = await worker.run(input.id, { allowAccountUsage: true });
  assert.equal(result.status, 'awaiting_review');
  const calls = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').map(JSON.parse);
  const overrides = args => args.flatMap((value, index) => value === '-c' ? [args[index + 1]] : []);
  assert.deepEqual(overrides(calls[1]), overrides(calls[0]));
  assert.ok(overrides(calls[1]).includes('sandbox_workspace_write.network_access=false'));
  assert.ok(!JSON.stringify(calls).includes('caller.invalid'));
  assert.equal(calls[1][calls[1].indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(!calls[1].includes('--model')); assert.ok(!calls[1].includes('-m'));
});

test('research and draft preserve the work kind and deliver actual files with their correct media types', async t => {
  for (const kind of ['research', 'draft']) {
    const { worker, callsFile } = await executorFixture(t, false, {
      files: { 'result.html': '<!doctype html><title>架空下書き</title>', 'result.json': '{"source":"fixture"}' },
      response: { summary: '架空調査と下書き', artifacts: [{ path: 'result.html', label: 'HTML成果物' }, { path: 'result.json', label: '根拠JSON' }], checks: [], limitations: [] },
    });
    const input = { ...job(`artifact-${kind}`, kind, { source_id: 'worker-fixture', prompt: '架空成果物を保存する', files: [] }), capability_id: 'local.codex_workspace' };
    await worker.enqueue(input);
    const result = await worker.run(input.id, { allowAccountUsage: true });
    assert.equal(result.status, 'awaiting_review');
    assert.deepEqual(result.artifacts.map(item => item.media_type), ['text/html', 'application/json']);
    assert.ok(result.artifacts.every(item => item.bytes > 0 && item.sha256.length === 64));
    const prompt = await fs.readFile(path.join(worker.directory(input.id), 'prompt.txt'), 'utf8');
    assert.match(prompt, new RegExp(`Kind: ${kind}\\n`));
    assert.match(prompt, /10 MiB attachment limit/);
    const snapshot = JSON.parse(await fs.readFile(path.join(worker.directory(input.id), 'source-snapshot.json'), 'utf8'));
    assert.ok(snapshot.input.some(item => item.path === 'example.mjs'));
    const calls = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(args => args.includes('exec')).length, 1);
  }
});

test('missing, empty and oversized outputs stay failed and resumable instead of becoming a completed upload trap', async t => {
  const cases = [
    { name: 'missing', files: {}, artifacts: [], error: /ARTIFACT_REQUIRED/ },
    { name: 'empty', files: { 'result.md': '' }, artifacts: [{ path: 'result.md', label: '成果物' }], error: /ARTIFACT_EMPTY/ },
    { name: 'oversized', files: { 'result.md': 10 * 1024 * 1024 + 1 }, artifacts: [{ path: 'result.md', label: '成果物' }], error: /ARTIFACT_TOO_LARGE/ },
  ];
  for (const item of cases) {
    const { worker } = await executorFixture(t, false, { files: item.files, response: { summary: '架空成果物', artifacts: item.artifacts, checks: [], limitations: [] } });
    const input = { ...job(`output-${item.name}`, 'draft', { source_id: 'worker-fixture', prompt: '架空出力境界検証', files: [] }), capability_id: 'local.codex_workspace' };
    await worker.enqueue(input);
    await assert.rejects(worker.run(input.id, { allowAccountUsage: true }), item.error);
    assert.equal((await worker.inspect(input.id)).status, 'failed');
    await assert.rejects(fs.access(path.join(worker.directory(input.id), 'result.json')), { code: 'ENOENT' });
    if (item.artifacts.length) assert.ok(await fs.readFile(path.join(worker.directory(input.id), 'workspace', item.artifacts[0].path)));
    if (item.name === 'oversized') {
      const executable = await fs.readFile(worker.codexCommand, 'utf8');
      await fs.writeFile(worker.codexCommand, executable.replace(String(item.files['result.md']), JSON.stringify('縮小した架空成果物')));
      const recovered = await worker.run(input.id, { allowAccountUsage: true });
      assert.equal(recovered.status, 'awaiting_review');
      assert.equal((await worker.inspect(input.id)).attempts, 2);
      assert.equal(await fs.readFile(recovered.artifacts[0].path, 'utf8'), '縮小した架空成果物');
    }
  }
});

test('implementation returns a real generated diff when the model artifact list is empty', async t => {
  const original = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const { worker } = await executorFixture(t, false, {
    files: { 'example.mjs': 'export function pendingCount(tasks) { return tasks.filter(task => !task.isCompleted).length; }\n' },
    response: { summary: '架空の実装差分', artifacts: [], checks: [], limitations: [] },
  });
  const input = { ...job('generated-diff', 'implementation', { source_id: 'worker-fixture', prompt: '架空の変更差分を返す', files: [] }), capability_id: 'local.codex_workspace' };
  await worker.enqueue(input);
  const result = await worker.run(input.id, { allowAccountUsage: true });
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].media_type, 'text/x-diff');
  const diff = await fs.readFile(result.artifacts[0].path, 'utf8');
  assert.match(diff, /--- a\/example\.mjs/);
  assert.match(diff, /\+.*filter/);
  assert.deepEqual(await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs')), original);
});

test('same-work correction restores actual PNG/PDF bytes and generated Buffer artifacts without UTF-8 conversion', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  // A valid blank single-page PDF with a binary header marker that cannot round-trip through UTF-8.
  const pdfParts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [0];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\nendstream'];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.concat(pdfParts).length); pdfParts.push(Buffer.from(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`)); }
  const xref = Buffer.concat(pdfParts).length;
  pdfParts.push(Buffer.from(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const pdf = Buffer.concat(pdfParts), binaries = { 'output.png': png, 'output.pdf': pdf };
  for (const bytes of Object.values(binaries)) assert.notEqual(hash(Buffer.from(bytes.toString('utf8'))), hash(bytes));
  const prior = await executorFixture(t, false, {
    files: binaries,
    response: { summary: '架空の画像・PDF成果物', artifacts: Object.keys(binaries).map(name => ({ path: name, label: name })), checks: [], limitations: [] },
  });
  const priorJob = { ...job('binary-revision1', 'draft', { source_id: 'worker-fixture', prompt: '架空のバイナリ成果物', files: [] }), capability_id: 'local.codex_workspace', execution_revision: 'revision:1' };
  await prior.worker.enqueue(priorJob);
  const priorResult = await prior.worker.run(priorJob.id, { allowAccountUsage: true });
  assert.deepEqual(priorResult.artifacts.map(item => item.media_type), ['image/png', 'application/pdf']);
  const correction = await executorFixture(t, false, {
    verifyFiles: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, hash(bytes)])),
    files: { 'correction.md': '同じ仕事の架空修正。元の画像とPDFの内容を保持しました。' },
    response: { summary: '同じ仕事の修正成果', artifacts: [...Object.keys(binaries).map(name => ({ path: name, label: name })), { path: 'correction.md', label: '修正説明' }], checks: [{ name: 'restored-binary-digests', passed: true, detail: 'Fixture executor verified both restored file hashes before processing.' }], limitations: [] },
  });
  const worker = new LocalWorker({ stateRoot: prior.worker.stateRoot, codexCommand: correction.worker.codexCommand, codexConfigArgs: prior.worker.codexConfigArgs });
  const nextJob = { ...priorJob, id: 'binary-revision2', execution_revision: 'revision:2', payload: { ...priorJob.payload, prompt: '同じ仕事の架空修正', prior_job_id: priorJob.id } };
  await worker.enqueue(nextJob);
  const result = await worker.run(nextJob.id, { allowAccountUsage: true }).catch(async error => {
    error.message += `\nFixture executor stderr:\n${await fs.readFile(path.join(worker.directory(nextJob.id), 'codex-attempt-1.stderr.log'), 'utf8')}`;
    throw error;
  });
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.work_id, priorResult.work_id);
  for (const [name, bytes] of Object.entries(binaries)) {
    const artifact = result.artifacts.find(item => path.basename(item.path) === name);
    assert.equal(artifact.sha256, hash(bytes));
    assert.deepEqual(await fs.readFile(artifact.path), bytes);
    assert.deepEqual(await fs.readFile(path.join(prior.worker.directory(priorJob.id), 'workspace', name)), bytes);
  }
  const supplied = await worker.artifact(worker.directory(nextJob.id), 'supplied.png', 'Buffer画像', 'image/png', png);
  assert.equal(supplied.sha256, hash(png));
  assert.deepEqual(await fs.readFile(supplied.path), png);
});

test('diff-only corrections retain unlisted edits, additions and deletions from legacy verified implementation patches', async t => {
  const cases = [
    { name: 'edit-add', files: { 'example.mjs': 'export function pendingCount(tasks) { return tasks.filter(t => !t.isCompleted).length; }\n', 'unlisted.txt': '前回の一覧にない追加成果' }, removeFiles: [] },
    { name: 'delete-add', files: { 'unlisted.bin': Buffer.from([0, 255, 128, 1, 2]) }, removeFiles: ['example.mjs'] },
  ];
  for (const item of cases) await t.test(item.name, async t => {
    const prior = await executorFixture(t, false, { files: item.files, removeFiles: item.removeFiles, response: { summary: '差分のみを返す前回実装', artifacts: [], checks: [], limitations: [] } });
    const priorJob = { ...job(`delta-${item.name}-r1`, 'implementation', { source_id: 'worker-fixture', prompt: '差分だけの架空実装', files: [] }), capability_id: 'local.codex_workspace' };
    await prior.worker.enqueue(priorJob);
    await prior.worker.run(priorJob.id, { allowAccountUsage: true });
    const resultFile = path.join(prior.worker.directory(priorJob.id), 'result.json'), priorResult = JSON.parse(await fs.readFile(resultFile, 'utf8'));
    // Emulate existing history, where only the actual generated patch had a recorded digest.
    delete priorResult.execution.workspace_delta;
    await fs.writeFile(resultFile, JSON.stringify(priorResult));
    const verifyFiles = Object.fromEntries([...item.removeFiles.map(name => [name, null]), ...Object.entries(item.files).map(([name, bytes]) => [name, hash(bytes)])]);
    const correction = await executorFixture(t, false, { files: {}, verifyFiles, response: { summary: '前回の実装を保持して修正する', artifacts: [], checks: [], limitations: [] } });
    const worker = new LocalWorker({ stateRoot: prior.worker.stateRoot, codexCommand: correction.worker.codexCommand, codexConfigArgs: prior.worker.codexConfigArgs });
    const nextJob = { ...priorJob, id: `delta-${item.name}-r2`, payload: { ...priorJob.payload, prior_job_id: priorJob.id } };
    await worker.enqueue(nextJob);
    const result = await worker.run(nextJob.id, { allowAccountUsage: true }).catch(async error => {
      error.message += `\n${await fs.readFile(path.join(worker.directory(nextJob.id), 'codex-attempt-1.stderr.log'), 'utf8')}`; throw error;
    });
    assert.equal(result.status, 'awaiting_review');
    const diff = await fs.readFile(result.artifacts.find(a => a.media_type === 'text/x-diff').path, 'utf8');
    assert.ok(diff.length > 0);
    for (const [name, bytes] of Object.entries(item.files)) assert.deepEqual(await fs.readFile(path.join(worker.directory(nextJob.id), 'workspace', name)), Buffer.from(bytes));
    for (const name of item.removeFiles) await assert.rejects(fs.access(path.join(worker.directory(nextJob.id), 'workspace', name)), { code: 'ENOENT' });
  });
});

async function priorDeltaFixture(t, files = { 'a-output.txt': '前回の追加', 'example.mjs': 'export function pendingCount(tasks) { return 2; }\n' }) {
  const fixture = await executorFixture(t, false, { files, response: { summary: '実際の前回変更', artifacts: [], checks: [], limitations: [] } });
  const input = { ...job('delta-prior', 'implementation', { source_id: 'worker-fixture', prompt: '前回の実変更', files: [] }), capability_id: 'local.codex_workspace' };
  await fixture.worker.enqueue(input); const result = await fixture.worker.run(input.id, { allowAccountUsage: true });
  return { ...fixture, input, result, files };
}

test('complete delta carries omitted existing-source baseline through revision2 and revision3', async t => {
  const original = await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs'));
  const prior = await priorDeltaFixture(t);
  const correction = await executorFixture(t, false, { files: {}, verifyFiles: Object.fromEntries(Object.entries(prior.files).map(([name, bytes]) => [name, hash(bytes)])), response: { summary: '変更を引き継いだ修正版', artifacts: [], checks: [], limitations: [] } });
  const worker = new LocalWorker({ stateRoot: prior.worker.stateRoot, codexCommand: correction.worker.codexCommand, codexConfigArgs: prior.worker.codexConfigArgs });
  let previous = prior.input.id;
  for (const revision of [2, 3]) {
    const input = { ...prior.input, id: `delta-r${revision}`, payload: { ...prior.input.payload, prior_job_id: previous, files: [{ path: 'never-created.txt', expected_sha256: null }] } };
    await worker.enqueue(input); const result = await worker.run(input.id, { allowAccountUsage: true });
    const delta = JSON.parse(await fs.readFile(result.execution.workspace_delta.path, 'utf8'));
    assert.equal(delta.entries.find(entry => entry.path === 'example.mjs').before_sha256, hash(original));
    assert.ok(!delta.entries.some(entry => entry.path === 'never-created.txt'));
    assert.ok(!result.artifacts.some(item => item.path === result.execution.workspace_delta.path));
    previous = input.id;
  }
  assert.deepEqual(await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs')), original);
});

test('source conflicts including omitted additions abort before any restoration or model execution', async t => {
  for (const conflictPath of ['example.mjs', 'a-output.txt']) await t.test(conflictPath, async t => {
    const prior = await priorDeltaFixture(t);
    const correction = await executorFixture(t, false, { files: {}, response: { summary: '未起動の修正', artifacts: [], checks: [], limitations: [] } });
    const worker = new LocalWorker({ stateRoot: prior.worker.stateRoot, codexCommand: correction.worker.codexCommand, codexConfigArgs: prior.worker.codexConfigArgs });
    const current = worker.registeredSourceBytes.bind(worker);
    worker.registeredSourceBytes = (sourceId, name) => name === conflictPath ? Promise.resolve(Buffer.from('人間が別の内容に変更しました')) : current(sourceId, name);
    const input = { ...prior.input, id: 'conflicting-correction', payload: { ...prior.input.payload, prior_job_id: prior.input.id } };
    await worker.enqueue(input); await assert.rejects(worker.run(input.id, { allowAccountUsage: true }), /PRIOR_SOURCE_CONFLICT/);
    const workspace = path.join(worker.directory(input.id), 'workspace');
    await assert.rejects(fs.access(path.join(workspace, 'a-output.txt')), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(path.join(workspace, 'example.mjs')), await fs.readFile(path.join(ROOT, 'fixtures/source/example.mjs')));
    const calls = (await fs.readFile(correction.callsFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(args => args.includes('exec')).length, 0);
    await assert.rejects(fs.access(path.join(worker.directory(input.id), 'prior-result-restored.json')), { code: 'ENOENT' });
  });
});

test('declared binary output in excluded build directory participates in complete correction delta', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const prior = await executorFixture(t, false, { files: { 'dist/report.png': png }, response: { summary: '画像下書き', artifacts: [{ path: 'dist/report.png', label: '画像' }], checks: [], limitations: [] } });
  const input = { ...job('dist-prior', 'draft', { source_id: 'worker-fixture', prompt: '画像下書き', files: [] }), capability_id: 'local.codex_workspace' };
  await prior.worker.enqueue(input); const priorResult = await prior.worker.run(input.id, { allowAccountUsage: true });
  const delta = JSON.parse(await fs.readFile(priorResult.execution.workspace_delta.path, 'utf8'));
  assert.equal(delta.entries.find(entry => entry.path === 'dist/report.png').after_sha256, hash(png));
  const next = await executorFixture(t, false, { files: {}, verifyFiles: { 'dist/report.png': hash(png) }, response: { summary: '画像を保持した修正', artifacts: [{ path: 'dist/report.png', label: '画像' }], checks: [], limitations: [] } });
  const worker = new LocalWorker({ stateRoot: prior.worker.stateRoot, codexCommand: next.worker.codexCommand, codexConfigArgs: prior.worker.codexConfigArgs });
  const correction = { ...input, id: 'dist-correction', payload: { ...input.payload, prior_job_id: input.id } };
  await worker.enqueue(correction); const result = await worker.run(correction.id, { allowAccountUsage: true });
  assert.equal(result.artifacts[0].sha256, hash(png));
});

test('worker checks finish before artifact, generated diff and delta are captured from the same final bytes', async t => {
  const final = 'export function pendingCount(tasks) { return 9; }\n';
  const fixture = await executorFixture(t, false, { files: { 'example.mjs': final }, response: { summary: '検証後の実成果', artifacts: [{ path: 'example.mjs', label: '実装' }], checks: [], limitations: [] } });
  const input = { ...job('post-check-delta', 'implementation', { source_id: 'worker-fixture', prompt: '検証後の成果', files: [], checks: [{ type: 'node_syntax', path: 'example.mjs' }] }), capability_id: 'local.codex_workspace' };
  await fixture.worker.enqueue(input); const result = await fixture.worker.run(input.id, { allowAccountUsage: true });
  assert.equal(result.checks.find(check => check.name === 'node_syntax:example.mjs').passed, true);
  assert.equal(result.artifacts[0].sha256, hash(final));
  const delta = JSON.parse(await fs.readFile(result.execution.workspace_delta.path, 'utf8'));
  assert.equal(delta.entries.find(entry => entry.path === 'example.mjs').after_sha256, hash(final));
  assert.match(await fs.readFile(result.artifacts[1].path, 'utf8'), /\+export function pendingCount\(tasks\) \{ return 9;/);
});

test('executable host checks fail before execution and syntax checks cannot inherit Node preloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-postcheck-isolation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const marker = path.join(root, 'must-not-exist');
  await fs.writeFile(path.join(workspace, 'danger.test.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran');`);
  const preload = path.join(root, 'preload.cjs'); await fs.writeFile(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'preloaded');`);
  const worker = new LocalWorker({ stateRoot: path.join(root, 'state') });
  const check = { type: 'node_test', path: 'danger.test.mjs' };
  await assert.rejects(worker.enqueue(job('unsafe-check', 'implementation', { source_id: 'worker-fixture', files: [], checks: [check] })), /EXECUTABLE_CHECK_ISOLATION_REQUIRED/);
  await assert.rejects(worker.checks(workspace, [check]), /EXECUTABLE_CHECK_ISOLATION_REQUIRED/);
  await fs.symlink(preload, path.join(workspace, 'outside.cjs'));
  await assert.rejects(worker.checks(workspace, [{ type: 'node_syntax', path: 'outside.cjs' }]), /CHECK_OUTSIDE_WORKSPACE/);
  const original = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--require=${preload}`;
  try { assert.equal((await worker.checks(workspace, [{ type: 'node_syntax', path: 'danger.test.mjs' }]))[0].passed, true); }
  finally { if (original === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = original; }
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});

test('failed executor checks stay rejected and immutable attempt evidence survives same-job recovery', async t => {
  const first = { summary: '既存資料からの調査', artifacts: [{ path: 'report.md', label: '調査' }], checks: [
    { name: 'source-evidence', passed: true, detail: 'Registered source checked.' },
    { name: 'host-publication', passed: false, detail: 'The isolated executor cannot verify a future host publication.' },
  ], limitations: [] };
  const fixture = await executorFixture(t, false, { files: { 'report.md': '# 調査\n根拠付き成果' }, response: first });
  const input = { ...job('publication-recovery', 'research', { source_id: 'worker-fixture', prompt: '調査を保存して確認を依頼する', files: [] }), capability_id: 'local.codex_workspace' };
  await fixture.worker.enqueue(input);
  await assert.rejects(fixture.worker.run(input.id, { allowAccountUsage: true }), /VALIDATION_FAILED/);
  const dir = fixture.worker.directory(input.id), firstBytes = await fs.readFile(path.join(dir, 'codex-result.json'));
  assert.deepEqual(await fs.readFile(path.join(dir, 'codex-result-attempt-1.json')), firstBytes);
  assert.equal(JSON.parse(firstBytes).checks[1].passed, false);
  await assert.rejects(fs.access(path.join(dir, 'result.json')), { code: 'ENOENT' });
  const outputHash = hash(await fs.readFile(path.join(dir, 'workspace/report.md')));
  const rejected = await executorFixture(t, true);
  const preflightWorker = new LocalWorker({ stateRoot: fixture.worker.stateRoot, codexCommand: rejected.worker.codexCommand, codexConfigArgs: fixture.worker.codexConfigArgs });
  await assert.rejects(preflightWorker.run(input.id, { allowAccountUsage: true }), /EXECUTOR_CONFIG_REJECTED/);
  await assert.rejects(fs.access(path.join(dir, 'codex-result-attempt-2.json')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(dir, 'codex-result-attempt-1.json')), firstBytes);
  const second = { ...first, checks: first.checks.slice(0, 1), limitations: ['Host upload, review request and coordination.result are pending.'] };
  const resumed = await executorFixture(t, false, { files: {}, verifyFiles: { 'report.md': outputHash }, response: second });
  const recoveryWorker = new LocalWorker({ stateRoot: fixture.worker.stateRoot, codexCommand: resumed.worker.codexCommand, codexConfigArgs: fixture.worker.codexConfigArgs });
  const result = await recoveryWorker.run(input.id, { allowAccountUsage: true });
  assert.equal(result.status, 'awaiting_review');
  assert.equal((await fixture.worker.inspect(input.id)).attempts, 3);
  assert.equal(result.artifacts[0].sha256, outputHash);
  assert.deepEqual(await fs.readFile(path.join(dir, 'codex-result-attempt-1.json')), firstBytes);
  await assert.rejects(fs.access(path.join(dir, 'codex-result-attempt-2.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'codex-result-attempt-3.json'), 'utf8')), second);
  const prompt = await fs.readFile(path.join(dir, 'prompt.txt'), 'utf8');
  assert.match(prompt, /Your checks cover only work and content you actually verified inside this workspace/);
  assert.match(prompt, /Previous attempt report \(historical evidence/);
  assert.match(prompt, /"passed": false/);
});
