import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureWorkspaceDelta, restorePriorWorkspace } from './workspace-delta.mjs';

const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
const bytes = value => value === null ? null : Buffer.from(value);
const safePath = name => {
  assert.equal(typeof name, 'string');
  assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'));
  return name;
};
async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value instanceof Uint8Array ? value : JSON.stringify(value) + '\n');
}
async function setFile(file, value) {
  if (value === null) await fs.rm(file, { force: true });
  else await write(file, bytes(value));
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-delta-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function revision(root, id, intake, kind = 'implementation') {
  const dir = path.join(root, id), workspace = path.join(dir, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(dir, 'baseline'), { recursive: true });
  const input = [];
  for (const [name, value] of Object.entries(intake)) {
    const contents = bytes(value);
    if (contents !== null) {
      await write(path.join(workspace, name), contents);
      await write(path.join(dir, 'baseline', name), contents);
    }
    input.push({ path: name, sha256: digest(contents), existed: contents !== null });
  }
  await write(path.join(dir, 'source-snapshot.json'), { input });
  return { dir, workspace, input, job: { id, kind, plan_id: 'fixture-plan', work_id: 'fixture-work', payload: { source_id: 'fixture-source' } } };
}
async function recordDelta(previous) {
  const manifest = await captureWorkspaceDelta({ ...previous, safePath });
  const manifestFile = path.join(previous.dir, 'workspace-delta.json');
  await write(manifestFile, manifest);
  const contents = await fs.readFile(manifestFile);
  previous.result = { schema: 'slowth-local-result/v1', status: 'awaiting_review', job_id: previous.job.id,
    work_id: previous.job.work_id, artifacts: [], execution: { workspace_delta: { path: manifestFile,
      sha256: digest(contents), bytes: contents.length, media_type: 'application/json', access: 'local_host_only' } } };
  return manifest;
}
async function restore(target, previous, source, trace = { writes: [], reads: [] }) {
  return restorePriorWorkspace({ ...target, previousDir: previous.dir, previousJob: previous.job,
    previous: previous.result, safePath,
    write: async (file, value) => { trace.writes.push(path.relative(target.dir, file)); await write(file, value); },
    currentSourceBytes: async name => { trace.reads.push(name); return bytes(source[name] ?? null); } });
}
const missing = file => assert.rejects(fs.access(file), { code: 'ENOENT' });

test('a later source conflict prevents every earlier delta and baseline write', async t => {
  const root = await fixture(t), original = { 'a.txt': 'old A', 'z.txt': 'old Z' };
  const previous = await revision(root, 'revision1', original);
  await setFile(path.join(previous.workspace, 'a.txt'), 'output A');
  await setFile(path.join(previous.workspace, 'z.txt'), 'output Z');
  await recordDelta(previous);
  const current = { ...original, 'z.txt': 'new human source Z' };
  const target = await revision(root, 'revision2', current), trace = { writes: [], reads: [] };
  const beforeInput = structuredClone(target.input);
  await assert.rejects(restore(target, previous, current, trace), /PRIOR_SOURCE_CONFLICT: z\.txt/);
  assert.deepEqual(trace.reads, ['a.txt', 'z.txt']);
  assert.deepEqual(trace.writes, []);
  assert.deepEqual(target.input, beforeInput);
  for (const [name, value] of Object.entries(current)) {
    assert.equal(await fs.readFile(path.join(target.workspace, name), 'utf8'), value);
    assert.equal(await fs.readFile(path.join(target.dir, 'baseline', name), 'utf8'), value);
  }
  await missing(path.join(target.dir, 'prior-result-restored.json'));
});

test('already applied edits, additions and deletions remain valid correction inputs', async t => {
  const root = await fixture(t), original = { 'edit.txt': 'old edit', 'deleted.txt': 'old deleted' };
  const previous = await revision(root, 'revision1', original);
  await setFile(path.join(previous.workspace, 'edit.txt'), 'applied edit');
  await setFile(path.join(previous.workspace, 'added.txt'), 'applied addition');
  await setFile(path.join(previous.workspace, 'deleted.txt'), null);
  const manifest = await recordDelta(previous);
  assert.equal(manifest.entries.find(entry => entry.path === 'deleted.txt').after_sha256, null);
  const current = { 'edit.txt': 'applied edit', 'added.txt': 'applied addition' };
  const target = await revision(root, 'revision2', current);
  const restored = await restore(target, previous, current);
  assert.equal(restored.mode, 'complete_recorded_delta');
  assert.deepEqual(restored.paths, ['added.txt', 'deleted.txt', 'edit.txt']);
  assert.equal(await fs.readFile(path.join(target.workspace, 'edit.txt'), 'utf8'), current['edit.txt']);
  assert.equal(await fs.readFile(path.join(target.workspace, 'added.txt'), 'utf8'), current['added.txt']);
  await missing(path.join(target.workspace, 'deleted.txt'));
  assert.deepEqual(target.input.find(item => item.path === 'deleted.txt'), { path: 'deleted.txt', sha256: null, existed: false });
});

test('a retry marker retains partial correction edits and restores omitted baseline records once', async t => {
  const root = await fixture(t), original = { 'selected.txt': 'selected source', 'omitted.txt': 'original omitted source' };
  const previous = await revision(root, 'revision1', original);
  await setFile(path.join(previous.workspace, 'omitted.txt'), 'prior output');
  await recordDelta(previous);
  const target = await revision(root, 'revision2', { 'selected.txt': original['selected.txt'] });
  await restore(target, previous, original);
  await setFile(path.join(target.workspace, 'omitted.txt'), 'partial correction after failure');
  target.input = target.input.filter(item => item.path === 'selected.txt');
  const trace = { writes: [], reads: [] };
  const marker = await restore(target, previous, original, trace);
  assert.equal(marker.prior_job_id, previous.job.id);
  assert.equal(await fs.readFile(path.join(target.workspace, 'omitted.txt'), 'utf8'), 'partial correction after failure');
  assert.deepEqual(trace, { writes: [], reads: [] });
  assert.deepEqual(target.input.find(item => item.path === 'omitted.txt'), { path: 'omitted.txt', sha256: digest(bytes(original['omitted.txt'])), existed: true });
  await restore(target, previous, original, trace);
  assert.equal(target.input.filter(item => item.path === 'omitted.txt').length, 1);
});

test('changed recorded delta or output bytes stop restoration before source reads or writes', async t => {
  const root = await fixture(t);
  for (const changed of ['manifest', 'workspace']) {
    const previous = await revision(root, `previous-${changed}`, { 'result.txt': 'original' });
    await setFile(path.join(previous.workspace, 'result.txt'), 'recorded output');
    await recordDelta(previous);
    if (changed === 'manifest') await fs.appendFile(previous.result.execution.workspace_delta.path, '\nchanged recorded bytes');
    else await setFile(path.join(previous.workspace, 'result.txt'), 'changed after result');
    const target = await revision(root, `next-${changed}`, { 'result.txt': 'original' }), trace = { writes: [], reads: [] };
    await assert.rejects(restore(target, previous, { 'result.txt': 'original' }, trace), changed === 'manifest' ? /PRIOR_ARTIFACT_CHANGED/ : /PRIOR_DELTA_CHANGED/);
    assert.deepEqual(trace, { writes: [], reads: [] });
    assert.equal(await fs.readFile(path.join(target.workspace, 'result.txt'), 'utf8'), 'original');
    await missing(path.join(target.dir, 'prior-result-restored.json'));
  }
});

test('revision3 carries edited and deleted paths omitted from revision2 intake with original baseline hashes', async t => {
  const root = await fixture(t), original = { 'selected.txt': 'same source', 'edited.txt': 'original edit', 'deleted.txt': 'original deleted' };
  const first = await revision(root, 'revision1', original);
  await setFile(path.join(first.workspace, 'edited.txt'), 'revision1 output');
  await setFile(path.join(first.workspace, 'deleted.txt'), null);
  await recordDelta(first);
  const second = await revision(root, 'revision2', { 'selected.txt': original['selected.txt'] });
  const restored = await restore(second, first, original);
  assert.equal(restored.baseline_inputs.length, 2);
  await setFile(path.join(second.workspace, 'edited.txt'), 'revision2 corrected output');
  const secondDelta = await recordDelta(second);
  for (const name of ['edited.txt', 'deleted.txt']) assert.equal(secondDelta.entries.find(item => item.path === name).before_sha256, digest(bytes(original[name])));
  const third = await revision(root, 'revision3', { 'selected.txt': original['selected.txt'] });
  await restore(third, second, original);
  assert.equal(await fs.readFile(path.join(third.workspace, 'edited.txt'), 'utf8'), 'revision2 corrected output');
  await missing(path.join(third.workspace, 'deleted.txt'));
  for (const name of ['edited.txt', 'deleted.txt']) assert.equal(third.input.find(item => item.path === name).sha256, digest(bytes(original[name])));
  const thirdDelta = await captureWorkspaceDelta({ ...third, safePath });
  assert.deepEqual(thirdDelta.entries, secondDelta.entries);
});

test('a legacy restoration marker cannot be reused for a different recorded prior job', async t => {
  const root = await fixture(t), previous = await revision(root, 'prior-job', { 'result.txt': 'original' });
  await setFile(path.join(previous.workspace, 'result.txt'), 'recorded output');
  await recordDelta(previous);
  const target = await revision(root, 'correction-job', { 'result.txt': 'partial retained output' });
  await write(path.join(target.dir, 'prior-result-restored.json'), { prior_job_id: 'different-prior-job' });
  const trace = { writes: [], reads: [] };
  await assert.rejects(restore(target, previous, { 'result.txt': 'original' }, trace), /PRIOR_RESULT_MISMATCH/);
  assert.deepEqual(trace, { writes: [], reads: [] });
  assert.equal(await fs.readFile(path.join(target.workspace, 'result.txt'), 'utf8'), 'partial retained output');
});

test('legacy research results restore only digest-recorded artifacts and explicitly identify that limit', async t => {
  const root = await fixture(t), previous = await revision(root, 'legacy-research', { 'source.txt': 'original source' }, 'research');
  await setFile(path.join(previous.workspace, 'guide.md'), 'recorded guide');
  await setFile(path.join(previous.workspace, 'unlisted.md'), 'unrecorded change');
  const file = path.join(previous.workspace, 'guide.md'), contents = await fs.readFile(file);
  previous.result = { schema: 'slowth-local-result/v1', status: 'awaiting_review', artifacts: [{ path: file, sha256: digest(contents) }] };
  const target = await revision(root, 'research-correction', { 'source.txt': 'original source' }, 'research');
  const marker = await restore(target, previous, { 'source.txt': 'original source' });
  assert.equal(marker.mode, 'legacy_recorded_artifacts');
  assert.match(marker.limitation, /ハッシュ付き成果ファイルだけ/);
  assert.equal(await fs.readFile(path.join(target.workspace, 'guide.md'), 'utf8'), 'recorded guide');
  await missing(path.join(target.workspace, 'unlisted.md'));
});
