#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, ROOT } from './config.mjs';

// The only test project/configuration is fictional; never inherit production configuration.
const env = { ...process.env, SLOWTH_WORKER_CONFIG: path.join(ROOT, 'fixtures/config.json'),
  SLOWTH_MCP_COORDINATION_PROJECT_IDS: 'fixture-project',
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'SLOWTH_MCP_TOKEN_FILE', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[key];
const tests = ['config.test.mjs', 'worker.test.mjs', 'workspace-delta.test.mjs', 'source-snapshot.test.mjs', 'mcp-client.test.mjs', 'host-status.test.mjs', 'host-recovery.test.mjs'];
for (const [args, cwd] of [
  [['--test', ...tests], ROOT],
  [[path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', path.join(ROOT, 'vitest.config.mjs')], REPO_ROOT],
]) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
