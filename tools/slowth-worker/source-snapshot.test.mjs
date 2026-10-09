import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registeredSourceFiles, snapshotRegisteredSource, changedWorkspaceFiles } from './source-snapshot.mjs';
test('registered source can be captured without per-file intake, keeping rules/dependency docs and excluding credentials/build output', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-source-snapshot-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), job = path.join(root, 'job');
  for (const [name, content] of Object.entries({ 'AGENTS.md': 'Read relevant Next guides before changes.', 'package.json': '{"name":"fixture"}', 'src/auth/token/route.mjs': 'export const taskAccess = true;', '.env.local': 'private fixture', 'service-account.json': 'private fixture', '.next/build-manifest.json': 'generated fixture', 'node_modules/next/package.json': '{"version":"16.3.6"}', 'node_modules/next/dist/docs/guide.md': 'Registered Next docs.' })) {
    const file = path.join(source, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
  }
  const selection = await registeredSourceFiles(source); assert.deepEqual(selection.map(f => f.path).sort(), ['AGENTS.md', 'package.json', 'src/auth/token/route.mjs']);
  const captured = await snapshotRegisteredSource(source, job); assert.equal(captured.input.length, 3); assert.equal(captured.mapping.nextVersion, '16.3.6');
  assert.equal(await fs.readFile(path.join(captured.workspace, 'node_modules/next/dist/docs/guide.md'), 'utf8'), 'Registered Next docs.');
  await fs.writeFile(path.join(captured.workspace, 'src/auth/token/route.mjs'), 'export const taskAccess = false;');
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"later source"}');
  const resumed = await snapshotRegisteredSource(source, job); assert.deepEqual(resumed.input, captured.input);
  assert.equal(await fs.readFile(path.join(resumed.workspace, 'package.json'), 'utf8'), '{"name":"fixture"}');
  assert.deepEqual(await changedWorkspaceFiles(captured.workspace, captured.baseline, captured.input.map(f => f.path)), ['src/auth/token/route.mjs']);
});
test('explicit private config and runtime roots are excluded even with ordinary filenames', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-private-intake-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), config = path.join(source, 'settings.json'), state = path.join(source, 'ordinary');
  for (const [name, content] of Object.entries({ 'src/public.mjs': 'export const publicValue = true;', 'settings.json': '{"private":"fictional settings"}', 'ordinary/bridge-operations/retry.json': '{"private":"fictional operation"}', 'ordinary/jobs/example/prompt.txt': 'fictional private business input' })) {
    const file = path.join(source, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
  }
  const captured = await snapshotRegisteredSource(source, path.join(root, 'job'), { excludeRoots: [config, state] });
  assert.deepEqual(captured.input.map(file => file.path), ['src/public.mjs']);
  await assert.rejects(fs.access(path.join(captured.workspace, 'settings.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(captured.workspace, 'ordinary')), { code: 'ENOENT' });
});
