import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseWorkerConfig, readWorkerConfig, assertPublicSourcePath, validateMcpEndpoint, ROOT } from './config.mjs';
const valid = () => ({ schema: 'slowth-worker-config/v1', projectId: 'fixture-project', workerId: 'fixture-worker', stateDirectory: 'private/state',
  sources: { 'worker-fixture': 'source' }, serverSourceRoot: '.', firebase: { projectId: 'demo-slowth-worker', storageBucket: 'demo-slowth-worker.invalid' }, mcpEndpoint: 'https://mcp.invalid/api/mcp' });

test('requires explicit project, worker, state and registered sources without choosing production defaults', () => {
  assert.throws(() => readWorkerConfig(null), /WORKER_CONFIG_REQUIRED/);
  for (const key of ['projectId', 'workerId', 'stateDirectory', 'sources']) { const config = valid(); delete config[key]; assert.throws(() => parseWorkerConfig(config), /WORKER_CONFIG_INVALID/); }
  const placeholder = valid(); placeholder.projectId = 'REPLACE_WITH_PROJECT_ID'; assert.throws(() => parseWorkerConfig(placeholder), /explicit projectId/);
});
test('resolves relative paths against the selected configuration and protects config/state from source intake', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-worker-config-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.local.json'); await fs.writeFile(file, JSON.stringify(valid()));
  const config = readWorkerConfig(file);
  assert.equal(config.sources['worker-fixture'], path.join(await fs.realpath(dir), 'source'));
  assert.throws(() => assertPublicSourcePath(file, config), /PRIVATE_WORKER_SOURCE/);
  assert.throws(() => assertPublicSourcePath(path.join(config.stateDirectory, 'bridge-operations', 'fixture.json'), config), /PRIVATE_WORKER_SOURCE/);
  assert.doesNotThrow(() => assertPublicSourcePath(path.join(config.sources['worker-fixture'], 'example.mjs'), config));
});
test('rejects inline credential fields, unsafe endpoints and a state directory containing registered sources', () => {
  assert.throws(() => parseWorkerConfig({ ...valid(), accessToken: 'fixture-only-value' }), /credentials outside/);
  assert.throws(() => parseWorkerConfig({ ...valid(), stateDirectory: '.' }), /must not contain/);
  for (const endpoint of ['http://mcp.invalid/api/mcp', 'https://user:password@mcp.invalid/api/mcp', 'https://mcp.invalid/api/mcp?token=fixture', 'https://mcp.invalid/api/mcp#secret']) assert.throws(() => validateMcpEndpoint(endpoint), /HTTPS without credentials/);
});
test('checked-in example remains deliberately incomplete and cannot activate a host', async () => {
  const file = path.join(ROOT, 'config.example.json'); assert.throws(() => readWorkerConfig(file), /WORKER_CONFIG_INVALID/);
  const env = { ...process.env }; delete env.SLOWTH_WORKER_CONFIG;
  const result = spawnSync(process.execPath, [path.join(ROOT, 'host.mjs'), '--run', '--allow-account-usage'], { env, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /WORKER_CONFIG_REQUIRED/); assert.doesNotMatch(result.stdout, /started|heartbeat/);
});
