import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKER_CONFIG } from './worker.mjs';
const sourceRoot = WORKER_CONFIG.serverSourceRoot;
if (!sourceRoot) throw new Error('WORKER_CONFIG_INVALID: host execution requires a reviewed serverSourceRoot.');
const requireSource = createRequire(path.join(sourceRoot, 'package.json'));

/** Compile current trusted server source using already-installed esbuild, no install or remote executor. */
export async function loadDomain({ outputRoot = path.join(WORKER_CONFIG.stateDirectory, 'domain'), initializeCredentials = false } = {}) {
  if (initializeCredentials) {
    if (!WORKER_CONFIG.firebase) throw new Error('WORKER_CONFIG_INVALID: host execution requires explicit Firebase project and bucket settings.');
    const { initializeApp, applicationDefault, getApps } = requireSource('firebase-admin/app');
    if (getApps().length && getApps()[0].options.projectId !== WORKER_CONFIG.firebase.projectId) throw new Error('FIREBASE_PROJECT_CONFLICT: the initialized application does not match worker configuration.');
    if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: WORKER_CONFIG.firebase.projectId, storageBucket: WORKER_CONFIG.firebase.storageBucket });
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = WORKER_CONFIG.firebase.projectId;
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = WORKER_CONFIG.firebase.storageBucket;
  }
  const esbuild = requireSource('esbuild');
  await fs.mkdir(outputRoot, { recursive: true });
  const outfile = path.join(outputRoot, 'source-domain.cjs');
  const exports = [
    `export {readTaskData,writeTaskData,requireTaskScope} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/mcp/taskData.ts'))};`,
    `export {taskContract} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/mcp/taskContract.ts'))};`,
    `export {validateCoordinationPolicy} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/mcp/coordinator.ts'))};`,
    `export {coordinationFingerprint} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/mcp/coordinatorProvenance.ts'))};`,
    `export {getAdminDb} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/firebase/admin.ts'))};`,
    `export {loadCoordinationDelegation,heartbeatCoordinationWorker,stopCoordinationWorker} from ${JSON.stringify(path.join(sourceRoot, 'src/lib/mcp/coordinatorTransport.ts'))};`,
  ].join('\n');
  await esbuild.build({ stdin: { contents: exports, resolveDir: sourceRoot, sourcefile: 'coordination-host-entry.ts', loader: 'ts' },
    outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', alias: { '@': path.join(sourceRoot, 'src') },
    plugins: [{ name: 'existing-source-dependencies', setup(build) {
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('@/')) return;
        if (args.path.startsWith('node:')) return { path: args.path, external: true };
        try { return { path: requireSource.resolve(args.path), external: true }; }
        catch { return { path: args.path, external: true }; }
      });
    } }], logLevel: 'silent' });
  return (await import(pathToFileURL(outfile).href)).default;
}
