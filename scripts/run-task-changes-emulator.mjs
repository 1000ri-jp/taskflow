import { spawn } from 'node:child_process';
import { accessSync, constants, createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaHome = process.env.JAVA_HOME;
if (!javaHome) throw new Error('Set JAVA_HOME to a Java 21+ runtime for this process only.');
const java = path.join(javaHome, 'bin/java');
const jar = process.env.FIRESTORE_EMULATOR_JAR ?? path.join(homedir(), '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar');
accessSync(java, constants.X_OK);
accessSync(jar, constants.R_OK);
const port = Number(process.env.TASK_CHANGES_EMULATOR_PORT ?? '8187');
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Invalid loopback emulator port.');
const host = `127.0.0.1:${port}`;
const project = 'demo-taskflow-delta';
const evidence = path.resolve(root, process.env.TASK_CHANGES_EVIDENCE_DIR ?? 'test-results/task-changes-emulator');
mkdirSync(evidence, { recursive: true });

// Allowlist environment values; do not inherit credentials, Firebase config,
// real project IDs, auth-emulator settings, or a developer's dotenv files.
const env = {
  JAVA_HOME: javaHome,
  PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  NODE_OPTIONS: '--no-experimental-webstorage',
  FIRESTORE_EMULATOR_HOST: host,
  TASK_CHANGES_EMULATOR_PROJECT: project,
  GCLOUD_PROJECT: project,
  GOOGLE_CLOUD_PROJECT: project,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
};
if (process.env.TASK_CHANGES_VERIFY_LONG_CURSOR === 'true') env.TASK_CHANGES_VERIFY_LONG_CURSOR = 'true';
for (const key of ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot']) if (process.env[key]) env[key] = process.env[key];
const canConnect = () => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const finish = available => { socket.destroy(); resolve(available); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(500, () => finish(false));
});
if (await canConnect()) throw new Error(`Port ${port} is already in use; do not attach to an existing service.`);

function start(command, args, logName) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(path.join(evidence, logName));
  child.stdout.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  const done = new Promise((resolve, reject) => {
    child.once('error', error => { log.end(); reject(error); });
    child.once('close', (code, signal) => { log.end(); resolve({ code, signal }); });
  });
  // Retain startup errors without an unhandled rejection during readiness checks.
  done.catch(() => {});
  return { child, done };
}
const emulator = start(java, ['-Xmx512m', '-jar', jar, '--host', '127.0.0.1', '--port', String(port), '--webchannel_port', String(port + 1), '--project_id', project, '--single_project_mode', 'true', '--single_project_mode_error', 'true', '--rules', path.join(root, 'firestore.rules')], 'emulator.log');
let tests;
const stop = () => {
  tests?.child.kill('SIGTERM');
  emulator.child.kill('SIGTERM');
};
const onInterrupt = () => { process.exitCode = 130; stop(); };
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
try {
  const deadline = Date.now() + 20_000;
  while (!(await canConnect())) {
    if (emulator.child.exitCode !== null || emulator.child.signalCode !== null) throw new Error('Emulator exited before readiness.');
    if (Date.now() >= deadline) throw new Error('Emulator readiness timed out.');
    await delay(250);
  }
  console.log(`Running against ${project} at ${host}; the aged-cursor check can take about a minute.`);
  if (env.TASK_CHANGES_VERIFY_LONG_CURSOR) console.log('Optional real-time 45-minute retention/expiry check enabled.');
  tests = start(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.task-changes-emulator.config.ts', '--reporter', 'verbose'], 'tests.log');
  const result = await tests.done;
  process.exitCode = result.code ?? 1;
} finally {
  stop();
  await Promise.race([emulator.done.catch(() => {}), delay(5_000)]);
  if (emulator.child.exitCode === null && emulator.child.signalCode === null) emulator.child.kill('SIGKILL');
  await emulator.done.catch(() => {});
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
}
