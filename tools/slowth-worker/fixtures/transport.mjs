import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const temporaryRoots = [];
export function fixtureCapability(projectId) {
  return { id: 'local.codex_workspace', name: 'Fictional isolated executor', kinds: ['research', 'draft', 'implementation'],
    executor: 'local_worker', status: 'verified', availability: 'connected',
    evidence: ['Fixture-only transport tests; no account or live capability verification.'],
    scope: { projectIds: [projectId], sourceIds: ['worker-fixture', 'slowth-source'] },
    constraints: ['Fictional temporary files only'], transport: { type: 'file_job', supported: true }, requiresHumanReview: true };
}
export async function fictionalResult() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-bridge-artifact-fixture-'));
  temporaryRoots.push(dir);
  const artifacts = [];
  for (const [name, mediaType, content] of [
    ['fixture.md', 'text/markdown', '# Fictional result\nGenerated locally for transport tests only.\n'],
    ['fixture.json', 'application/json', JSON.stringify({ fixture_only: true }) + '\n'],
    ['fixture.patch', 'text/x-diff', 'Fixture-only implementation diff placeholder.\n'],
  ]) {
    const file = path.join(dir, name); await fs.writeFile(file, content);
    artifacts.push({ label: name, path: file, media_type: mediaType, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), access: 'local_host_only' });
  }
  return { schema: 'slowth-local-result/v1', status: 'awaiting_review', summary: '架空のtransport成果物です。モデル実行や本番検証はありません。', artifacts,
    checks: [{ name: 'fixture-output', passed: true, detail: 'Synthetic successful executor response for transport tests.' }],
    limitations: ['Fixture only; no actual model call or human acceptance.'], execution: { actual_model_invocation: false, fixture_only: true } };
}
export async function cleanupFictionalResults() {
  await Promise.all(temporaryRoots.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
}
