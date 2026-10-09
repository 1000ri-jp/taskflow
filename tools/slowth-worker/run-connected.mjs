#!/usr/bin/env node
import fs from 'node:fs/promises';
import { SlowthMcpClient } from './mcp-client.mjs';
import { CoordinationWorkerBridge } from './bridge.mjs';
const [specFile, ...flags] = process.argv.slice(2);
try {
  if (!specFile) throw new Error('Usage: node run-connected.mjs <work-spec.json> [--allow-account-usage]. Spec: {parentTaskId,planId,workId,payload,reviewerIds?}.');
  const spec = JSON.parse(await fs.readFile(specFile, 'utf8'));
  const client = SlowthMcpClient.fromTokenFile(process.env.SLOWTH_MCP_TOKEN_FILE);
  const bridge = new CoordinationWorkerBridge({ callTool: client.callTool.bind(client) });
  const result = await bridge.execute({ ...spec, allowAccountUsage: flags.includes('--allow-account-usage') });
  // Keep lease tokens and storage download URLs in private bridge state; output only operational evidence.
  const { status, job_id, work_id, review_task_id, artifact_count, checks, already_submitted, observed_live_process } = result;
  process.stdout.write(JSON.stringify({ status, job_id, work_id, review_task_id, artifact_count, checks, already_submitted, observed_live_process }, null, 2) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
