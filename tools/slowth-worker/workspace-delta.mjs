import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { changedWorkspaceFiles } from './source-snapshot.mjs';

const sha = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
const read = async file => { try { return await fs.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } };
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };

async function baselineBytes(dir, inputs, name) {
  const bytes = await read(path.join(dir, 'baseline', name));
  let record = inputs.find(item => item.path === name);
  if (!record) {
    const marker = await read(path.join(dir, 'baseline', `${name}.baseline.json`));
    if (marker) record = JSON.parse(marker);
  }
  if (record ? sha(bytes) !== record.sha256 : bytes !== null) fail('PRIOR_BASELINE_CHANGED', name);
  return bytes;
}

export async function captureWorkspaceDelta({ dir, workspace, input, job, safePath, artifactPaths = [] }) {
  const entries = [];
  const names = new Set([...await changedWorkspaceFiles(workspace, path.join(dir, 'baseline'), input.map(item => item.path)), ...artifactPaths]);
  for (const name of [...names].sort()) {
    safePath(name);
    const before = await baselineBytes(dir, input, name), after = await read(path.join(workspace, name));
    if (sha(before) === sha(after)) continue;
    entries.push({ path: name, before_sha256: sha(before), after_sha256: sha(after), after_bytes: after?.length ?? 0 });
  }
  return { schema: 'slowth-workspace-delta/v1', job_id: job.id, source_id: job.payload.source_id ?? 'worker-fixture', entries };
}

async function oldInputs(previousDir) {
  for (const [name, key] of [['source-snapshot.json', 'input'], ['invocation.json', 'source_inputs']]) {
    const bytes = await read(path.join(previousDir, name));
    if (bytes) return JSON.parse(bytes)[key];
  }
  return [];
}

async function recordedArtifactBytes(artifact) {
  const bytes = await fs.readFile(artifact.path);
  if (sha(bytes) !== artifact.sha256) fail('PRIOR_ARTIFACT_CHANGED', path.basename(artifact.path));
  return bytes;
}

function gitApply(staging, patchFile, options) {
  const result = spawnSync('git', ['apply', ...options, '--', patchFile], { cwd: staging, encoding: 'utf8' });
  if (result.status !== 0) fail('PRIOR_PATCH_INVALID', 'The recorded patch does not apply to its verified baseline.');
  return result.stdout;
}

async function legacyPatchDelta({ previousDir, previous, oldWorkspace, dir, input, safePath }) {
  const generatedPath = path.join(previousDir, 'artifacts', 'changes.patch');
  let patch = previous.artifacts.find(item => path.resolve(item.path) === path.resolve(generatedPath));
  if (!patch && await read(generatedPath) !== null) {
    const generatedReal = await fs.realpath(generatedPath);
    for (const item of previous.artifacts) if (await fs.realpath(item.path) === generatedReal) { patch = item; break; }
  }
  if (!patch) return null;
  const bytes = await recordedArtifactBytes(patch);
  if (!bytes.length) return [];
  const staging = await fs.mkdtemp(path.join(dir, 'prior-delta-stage-'));
  try {
    const names = gitApply(staging, patch.path, ['--numstat', '-z']).split('\0').filter(Boolean).map(row => safePath(row.split('\t').slice(2).join('\t')));
    const entries = [];
    for (const name of [...new Set(names)]) {
      const before = await baselineBytes(previousDir, input, name);
      entries.push({ path: name, before_sha256: sha(before) });
      if (before !== null) { await fs.mkdir(path.dirname(path.join(staging, name)), { recursive: true }); await fs.writeFile(path.join(staging, name), before); }
    }
    gitApply(staging, patch.path, ['--check', '--no-index']);
    gitApply(staging, patch.path, ['--no-index']);
    for (const entry of entries) {
      const bytes = await read(path.join(staging, entry.path));
      entry.after_sha256 = sha(bytes); entry.bytes = bytes;
    }
    return entries;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Restore only recorded prior output, validating all source conflicts before any workspace mutation. */
export async function restorePriorWorkspace({ dir, workspace, input, previousDir, previousJob, previous, job, safePath, write, currentSourceBytes }) {
  const markerFile = path.join(dir, 'prior-result-restored.json'), marker = await read(markerFile);
  const mergeInputs = records => { for (const record of records ?? []) if (!input.some(item => item.path === record.path)) input.push(record); };
  if (marker) {
    const restored = JSON.parse(marker);
    if (restored.prior_job_id !== previousJob.id) fail('PRIOR_RESULT_MISMATCH', 'Restoration marker belongs to a different prior job.');
    mergeInputs(restored.baseline_inputs); return restored;
  }
  if ((previousJob.payload.source_id ?? 'worker-fixture') !== (job.payload.source_id ?? 'worker-fixture')) fail('PRIOR_SOURCE_MISMATCH', 'The same work must use the same registered source for correction.');
  const oldWorkspace = await fs.realpath(path.join(previousDir, 'workspace'));
  let entries, mode, limitation;
  const descriptor = previous.execution?.workspace_delta;
  if (descriptor) {
    const manifestBytes = await recordedArtifactBytes(descriptor), manifest = JSON.parse(manifestBytes);
    if (manifest.schema !== 'slowth-workspace-delta/v1' || manifest.job_id !== previousJob.id || manifest.source_id !== (previousJob.payload.source_id ?? 'worker-fixture') || !Array.isArray(manifest.entries)) fail('PRIOR_DELTA_INVALID', 'Prior delta does not belong to this recorded job.');
    entries = [];
    for (const entry of manifest.entries) {
      const name = safePath(entry.path), bytes = await read(path.join(oldWorkspace, name));
      if (sha(bytes) !== entry.after_sha256 || (bytes?.length ?? 0) !== entry.after_bytes) fail('PRIOR_DELTA_CHANGED', name);
      entries.push({ ...entry, path: name, bytes });
    }
    mode = 'complete_recorded_delta';
  } else {
    const previousInputs = await oldInputs(previousDir);
    entries = previousJob.kind === 'implementation' ? await legacyPatchDelta({ previousDir, previous, oldWorkspace, dir, input: previousInputs, safePath }) : null;
    mode = entries === null ? 'legacy_recorded_artifacts' : 'legacy_verified_patch';
    entries ??= [];
    for (const artifact of previous.artifacts) {
      const real = await fs.realpath(artifact.path);
      if (!real.startsWith(oldWorkspace + path.sep)) continue;
      const name = safePath(path.relative(oldWorkspace, real)), bytes = await recordedArtifactBytes(artifact);
      const existing = entries.find(entry => entry.path === name);
      if (existing) { if (existing.after_sha256 !== sha(bytes)) fail('PRIOR_RESULT_INCONSISTENT', name); continue; }
      entries.push({ path: name, before_sha256: sha(await baselineBytes(previousDir, previousInputs, name)), after_sha256: sha(bytes), bytes });
    }
    if (mode === 'legacy_recorded_artifacts') limitation = '旧結果には全変更の記録がないため、ハッシュ付き成果ファイルだけを引き継ぎました。';
  }
  const seen = new Set(), actions = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) fail('PRIOR_DELTA_INVALID', 'Duplicate delta path.'); seen.add(entry.path);
    const current = await currentSourceBytes(entry.path), local = await read(path.join(workspace, entry.path));
    const matches = bytes => [entry.before_sha256, entry.after_sha256].includes(sha(bytes));
    if (!matches(current) || (local !== null || input.some(item => item.path === entry.path)) && !matches(local)) fail('PRIOR_SOURCE_CONFLICT', entry.path);
    actions.push({ ...entry, current });
  }
  const baseline_inputs = [];
  for (const entry of actions) {
    if (!input.some(item => item.path === entry.path)) {
      const record = { path: entry.path, sha256: sha(entry.current), existed: entry.current !== null };
      if (entry.current !== null) await write(path.join(dir, 'baseline', entry.path), entry.current);
      await write(path.join(dir, 'baseline', `${entry.path}.baseline.json`), record);
      baseline_inputs.push(record);
    }
    const target = path.join(workspace, entry.path);
    if (entry.bytes === null) await fs.rm(target, { force: true });
    else await write(target, entry.bytes);
  }
  mergeInputs(baseline_inputs);
  const restored = { prior_job_id: previousJob.id, mode, paths: entries.map(entry => entry.path), baseline_inputs, ...(limitation ? { limitation } : {}) };
  await write(markerFile, restored);
  return restored;
}
