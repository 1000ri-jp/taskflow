import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { evaluateAudit, validateAuditReport, parseAuditCommand, runAuditPolicy, readRuntimeSources } from './audit-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Actual npm JSON observed on 2026-10-09; independent of the exception policy.
const full = {
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@next/eslint-plugin-next": {
      "name": "@next/eslint-plugin-next",
      "severity": "high",
      "isDirect": false,
      "via": [
        "fast-glob"
      ],
      "effects": [
        "eslint-config-next"
      ],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/@next/eslint-plugin-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "braces": {
      "name": "braces",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240992,
          "name": "braces",
          "dependency": "braces",
          "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
          "url": "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          "severity": "high",
          "cwe": [
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": "<=3.0.3"
        }
      ],
      "effects": [
        "micromatch"
      ],
      "range": "*",
      "nodes": [
        "node_modules/braces"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "eslint-config-next": {
      "name": "eslint-config-next",
      "severity": "high",
      "isDirect": true,
      "via": [
        "@next/eslint-plugin-next"
      ],
      "effects": [],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/eslint-config-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "fast-glob": {
      "name": "fast-glob",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [
        "@next/eslint-plugin-next"
      ],
      "range": "*",
      "nodes": [
        "node_modules/fast-glob"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "micromatch": {
      "name": "micromatch",
      "severity": "high",
      "isDirect": false,
      "via": [
        "braces"
      ],
      "effects": [
        "fast-glob"
      ],
      "range": ">=0.2.0",
      "nodes": [
        "node_modules/micromatch"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 5,
      "critical": 0,
      "total": 5
    },
    "dependencies": {
      "prod": 495,
      "dev": 531,
      "optional": 199,
      "peer": 8,
      "peerOptional": 0,
      "total": 1120
    }
  }
};
const clean = {
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    },
    "dependencies": {
      "prod": 495,
      "dev": 531,
      "optional": 199,
      "peer": 8,
      "peerOptional": 0,
      "total": 1120
    }
  }
};

const [policy, lockfile, packageJson, eslintConfigBytes] = await Promise.all([
  fs.readFile(path.join(root, 'security/audit-exceptions.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'eslint.config.mjs')),
]);
const runtimeSources = await readRuntimeSources(root);
const fixture = () => ({ fullReport: structuredClone(full), productionReport: structuredClone(clean),
  policy: structuredClone(policy), lockfile: structuredClone(lockfile), packageJson: structuredClone(packageJson),
  eslintConfigBytes: Buffer.from(eslintConfigBytes), runtimeSources: structuredClone(runtimeSources), now: new Date('2026-10-16T14:59:59.999Z') });
const failed = (input, code) => { const result = evaluateAudit(input); assert.equal(result.ok, false); assert.equal(result.exceptionUsed, false); if (code) assert.equal(result.code, code); return result; };
const command = (report, status = report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical ? 1 : 0, stderr = '') => ({ status, stdout: JSON.stringify(report), stderr });
const warning = kind => `npm warn Unknown ${kind} config "minimum-release-age". This will stop working in the next major version of npm. See \`npm help npmrc\` for supported config options.`;
const recount = report => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const finding of Object.values(report.vulnerabilities)) { counts[finding.severity]++; counts.total++; }
  report.metadata.vulnerabilities = counts; return report;
};

test('accepts exactly the observed five high dev lint findings as risk, never as a fix', () => {
  const result = evaluateAudit(fixture());
  assert.equal(result.ok, true); assert.equal(result.exceptionUsed, true); assert.equal(result.findings, 5);
  assert.equal(result.advisory, 'GHSA-vfj7-8cjw-p6xm'); assert.match(result.message, /RISK ACCEPTED, NOT FIXED/);
  assert.match(result.message, /Production audit: zero findings/);
});

test('expiry is exclusive at midnight October 17 JST and cannot be extended in policy', () => {
  failed({ ...fixture(), now: new Date('2026-10-16T15:00:00.000Z') }, 'EXCEPTION_EXPIRED');
  failed({ ...fixture(), now: new Date('2026-10-17T00:00:00.000Z') }, 'EXCEPTION_EXPIRED');
  const changed = fixture(); changed.policy.exceptions[0].expiresAt = '2026-10-18T00:00:00+09:00';
  failed(changed, 'EXCEPTION_POLICY_INVALID');
  failed({ ...fixture(), now: NaN }, 'AUDIT_CLOCK_INVALID');
});

test('clean full and production reports use no exception even after expiry or without policy inputs', () => {
  for (const value of [undefined, null, { malformed: true }, policy]) {
    const result = evaluateAudit({ fullReport: clean, productionReport: clean, policy: value, now: new Date('2030-01-01') });
    assert.equal(result.ok, true); assert.equal(result.exceptionUsed, false); assert.equal(result.findings, 0);
  }
});

test('new advisory, new package and additional sub-high findings are rejected', () => {
  const advisory = fixture(); advisory.fullReport.vulnerabilities.braces.via.push({ ...advisory.fullReport.vulnerabilities.braces.via[0], url: 'https://github.com/advisories/GHSA-new0-new0-new0' });
  failed(advisory, 'UNAPPROVED_FINDINGS');
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    const extra = fixture(); extra.fullReport.vulnerabilities.unapproved = { ...structuredClone(full.vulnerabilities.braces), name: 'unapproved', severity, nodes: ['node_modules/unapproved'] };
    recount(extra.fullReport); failed(extra, 'UNAPPROVED_FINDINGS');
    const alone = fixture(); alone.fullReport = recount({ ...structuredClone(clean), vulnerabilities: { unapproved: extra.fullReport.vulnerabilities.unapproved } });
    failed(alone, 'UNAPPROVED_FINDINGS');
  }
});

test('changed severity, dependency propagation or extra affected node cannot reuse the exception', () => {
  const severity = fixture(); severity.fullReport.vulnerabilities.braces.severity = 'moderate'; recount(severity.fullReport); failed(severity, 'UNAPPROVED_FINDINGS');
  const effect = fixture(); effect.fullReport.vulnerabilities.braces.effects.push('another-consumer'); failed(effect, 'UNAPPROVED_FINDINGS');
  const node = fixture(); node.fullReport.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces'); failed(node, 'UNAPPROVED_FINDINGS');
  const source = fixture(); source.fullReport.vulnerabilities.braces.via[0].source++; failed(source, 'UNAPPROVED_FINDINGS');
});

test('production findings of every severity reject even clean full or approved full reports', () => {
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    const current = fixture(); current.productionReport.vulnerabilities.braces = { ...structuredClone(full.vulnerabilities.braces), severity };
    recount(current.productionReport); failed(current, 'PRODUCTION_FINDINGS');
    failed({ ...current, fullReport: clean }, 'PRODUCTION_FINDINGS');
  }
});

test('each pinned version/integrity, dev-only flag and package placement is enforced', () => {
  for (const pin of policy.exceptions[0].packages) {
    for (const [field, value] of [['version', '99.0.0'], ['integrity', 'sha512-AAAA'], ['dev', false], ['optional', true], ['devOptional', true], ['link', true]]) {
      const changed = fixture(); changed.lockfile.packages[pin.path][field] = value; failed(changed, 'LOCKED_PACKAGE_DRIFT');
    }
    const removed = fixture(); delete removed.lockfile.packages[pin.path]; failed(removed, 'LOCKED_PACKAGE_DRIFT');
    const extra = fixture(); extra.lockfile.packages[`node_modules/another/node_modules/${pin.name}`] = structuredClone(extra.lockfile.packages[pin.path]); failed(extra, 'EXTRA_PACKAGE_PATH');
    const alias = fixture(); alias.lockfile.packages['node_modules/new-alias'] = { ...structuredClone(alias.lockfile.packages[pin.path]), name: pin.name }; failed(alias, 'EXTRA_PACKAGE_PATH');
  }
});

test('changed chain range, production/shared root or extra dev consumer is rejected', () => {
  const range = fixture(); range.lockfile.packages['node_modules/micromatch'].dependencies.braces = '*'; failed(range, 'DEPENDENCY_CHAIN_DRIFT');
  const shared = fixture(); shared.lockfile.packages[''].dependencies.braces = '^3.0.3'; failed(shared, 'DEPENDENCY_CHAIN_DRIFT');
  const extra = fixture(); extra.lockfile.packages['node_modules/new-consumer'] = { version: '1.0.0', dev: true, dependencies: { braces: '^3.0.3' } }; failed(extra, 'DEPENDENCY_CHAIN_DRIFT');
  const manifest = fixture(); manifest.packageJson.dependencies.braces = '^3.0.3'; failed(manifest, 'DEPENDENCY_ROOT_DRIFT');
});

test('changed ESLint source or lint CLI flags cannot preserve reachability approval', () => {
  failed({ ...fixture(), eslintConfigBytes: Buffer.concat([eslintConfigBytes, Buffer.from('\n// changed\n')]) }, 'LINT_REACHABILITY_CHANGED');
  const script = fixture(); script.packageJson.scripts.lint += ' --no-ignore'; failed(script, 'LINT_REACHABILITY_CHANGED');
});

test('runtime imports, subpaths, renamed require and computed module loading cannot turn dev lint risk into production use', () => {
  for (const prefix of ['src/app/api', 'scripts/mcp-events', 'mcp-events-functions', 'tools/slowth-worker']) {
    for (const contents of ["import braces from 'braces';", "export * from 'micromatch/lib/scan.js';", "const load = createRequire(import.meta.url); load('fast-glob');", "require('/tmp/node_modules/braces/index.js');", "import('braces?runtime');", "import('raw-loader!micromatch#resource');"]) {
      const current = fixture(); current.runtimeSources.push({ path: `${prefix}/unapproved.mjs`, contents }); failed(current, 'RUNTIME_DEV_CHAIN_REFERENCE');
    }
    for (const contents of ["const pkg = 'br' + 'aces'; import(pkg);", "require(process.env.MODULE);", "const load = createRequire(import.meta.url); load(variable);", "import { createRequire as makeLoader } from 'node:module'; const load = makeLoader(import.meta.url); const pkg = 'braces'; load(pkg);", "const first = require; const second = first; const pkg = 'braces'; second(pkg);"]) {
      const current = fixture(); current.runtimeSources.push({ path: `${prefix}/computed.mjs`, contents }); failed(current, 'RUNTIME_COMPUTED_IMPORT');
    }
  }
  const rootImport = fixture(); rootImport.runtimeSources.push({ path: 'instrumentation.ts', contents: "import('micromatch');" }); failed(rootImport, 'RUNTIME_DEV_CHAIN_REFERENCE');
  const changed = fixture(); changed.runtimeSources.find(file => file.path === 'tools/slowth-worker/domain-loader.mjs').contents += '\n// changed loader'; failed(changed, 'RUNTIME_COMPUTED_IMPORT');
});

test('runtime source coverage must be complete and parseable; missing reviewed loader fails', () => {
  failed({ ...fixture(), runtimeSources: [] }, 'RUNTIME_SOURCE_UNAVAILABLE');
  failed({ ...fixture(), runtimeSources: undefined }, 'RUNTIME_SOURCE_UNAVAILABLE');
  const missing = fixture(); missing.runtimeSources = missing.runtimeSources.filter(file => !file.path.startsWith('mcp-events-functions/')); failed(missing, 'RUNTIME_SOURCE_UNAVAILABLE');
  const parsed = fixture(); parsed.runtimeSources.push({ path: 'src/invalid.ts', contents: 'export const broken = {' }); failed(parsed, 'RUNTIME_SOURCE_UNPARSEABLE');
  const loader = fixture(); loader.runtimeSources = loader.runtimeSources.filter(file => file.path !== 'tools/slowth-worker/domain-loader.mjs'); failed(loader, 'REVIEWED_RUNTIME_LOADER_DRIFT');
});

test('runtime modules cannot import tooling fixture or test sources that the reader excludes', () => {
  for (const contents of ["import '../../../tools/slowth-worker/foo.test.mjs';", "export * from '../../../tools/slowth-worker/fixtures/source/example.mjs';", "require('../../../tools/slowth-worker/state/generated.mjs');"]) {
    const current = fixture(); current.runtimeSources.push({ path: 'src/app/api/hidden-dependency.mjs', contents }); failed(current, 'RUNTIME_EXCLUDED_SOURCE_REFERENCE');
  }
});

test('reader scans auto-discovered App/Pages routes and app helpers despite test/state/fixture names', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-audit-app-boundary-')); t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  for (const relative of policy.exceptions[0].runtimeUseGuard.requiredRoots) { const dir = path.join(temporary, relative); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'safe.mjs'), 'export const safe = true;'); }
  for (const name of ['src/app/test/route.ts', 'src/lib/state/store.ts', 'src/pages/api/debug.fixture.ts', 'src/lib/helper.fixture.ts']) {
    const target = path.join(temporary, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, "import braces from 'braces';");
    const observed = await readRuntimeSources(temporary); assert.ok(observed.some(file => file.path === name));
    const current = fixture(); current.runtimeSources.push(observed.find(file => file.path === name)); failed(current, 'RUNTIME_DEV_CHAIN_REFERENCE');
    await fs.unlink(target);
  }
  const target = path.join(temporary, 'src/app/test/route.ts'); await fs.symlink(path.join(temporary, 'src/safe.mjs'), target);
  await assert.rejects(readRuntimeSources(temporary), /RUNTIME_SOURCE_UNAVAILABLE/);
});

test('runtime reader rejects missing or symlinked required source trees without reading an external source', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-audit-runtime-')); t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await assert.rejects(readRuntimeSources(temporary));
  for (const relative of policy.exceptions[0].runtimeUseGuard.requiredRoots) { const dir = path.join(temporary, relative); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'module.mjs'), 'export const safe = true;'); }
  assert.equal((await readRuntimeSources(temporary)).length, 4);
  await fs.symlink(path.join(temporary, 'scripts/mcp-events/module.mjs'), path.join(temporary, 'src/outside.mjs'));
  await assert.rejects(readRuntimeSources(temporary), /RUNTIME_SOURCE_UNAVAILABLE/);
});

test('missing, malformed, widened or expired policy cannot authorize findings', () => {
  for (const value of [undefined, null, {}, { schema: policy.schema, exceptions: [] }]) failed({ ...fixture(), policy: value }, 'EXCEPTION_POLICY_INVALID');
  for (const change of [
    p => p.exceptions.push(structuredClone(p.exceptions[0])),
    p => p.exceptions[0].advisory = 'GHSA-other-other-other',
    p => p.exceptions[0].scope = 'all-dev-dependencies',
    p => p.exceptions[0].packages.pop(),
    p => p.exceptions[0].packages[0].dev = false,
    p => p.exceptions[0].incomingEdges[0].field = 'dependencies',
    p => p.exceptions[0].findings.braces.via[0].url = 'https://github.com/advisories/GHSA-other-other-other',
  ]) { const changed = fixture(); change(changed.policy); failed(changed, 'EXCEPTION_POLICY_INVALID'); }
});

test('audit JSON shape, zero totals and status cannot disguise missing or contradictory data', () => {
  for (const report of [null, {}, { error: { code: 'ENETWORK', summary: 'private registry detail' } }, { ...clean, auditReportVersion: 1 }, { ...clean, vulnerabilities: null }]) assert.throws(() => validateAuditReport(report));
  const count = structuredClone(full); count.metadata.vulnerabilities.total = 0; assert.throws(() => validateAuditReport(count), /AUDIT_REPORT_CONTRADICTORY/);
  assert.throws(() => parseAuditCommand(command(clean, 1)), /AUDIT_EXIT_CONTRADICTORY/);
  assert.throws(() => parseAuditCommand(command(full, 0)), /AUDIT_EXIT_CONTRADICTORY/);
  assert.throws(() => parseAuditCommand({ status: 0, stdout: '{truncated', stderr: '' }), /AUDIT_JSON_INVALID/);
});

test('only the exact known npm minimum-release-age warnings are permitted on stderr', () => {
  for (const stderr of ['', warning('user') + '\n', warning('env') + '\n', warning('env') + '\n' + warning('user') + '\n']) assert.deepEqual(parseAuditCommand(command(full, 1, stderr)), full);
  for (const stderr of ['npm error code ENETWORK', warning('user') + '\nnpm error network unavailable', warning('user').replace('minimum-release-age', 'another-key'), warning('user') + ' extra']) assert.throws(() => parseAuditCommand(command(full, 1, stderr)), /AUDIT_COMMAND_FAILED/);
});

test('command/network failures never count as an accepted vulnerability audit', () => {
  for (const change of [{ status: 2 }, { status: null }, { error: new Error('ENETWORK private credential') }, { signal: 'SIGTERM' }, { stdout: null }, { stderr: null }]) assert.throws(() => parseAuditCommand({ ...command(full), ...change }), /AUDIT_COMMAND_FAILED/);
});

const orchestration = () => {
  const requests = [], reads = [];
  const files = new Map([
    [path.join(root, 'security/audit-exceptions.json'), JSON.stringify(policy)],
    [path.join(root, 'package-lock.json'), JSON.stringify(lockfile)],
    [path.join(root, 'package.json'), JSON.stringify(packageJson)],
    [path.join(root, 'eslint.config.mjs'), eslintConfigBytes],
  ]);
  return { requests, reads, files, options: { root, clock: () => new Date('2026-10-09T00:00:00Z'), runtimeReader: async () => structuredClone(runtimeSources),
    runner: async (name, args, options) => { requests.push({ name, args, options }); return command(requests.length === 1 ? full : clean); },
    readFile: async file => { reads.push(file); if (!files.has(file)) throw new Error('private credential marker'); return files.get(file); } } };
};

test('CLI orchestration uses full optional baseline and separate production audit before applying policy', async () => {
  const current = orchestration(); assert.equal((await runAuditPolicy(current.options)).ok, true);
  assert.deepEqual(current.requests.map(item => [item.name, item.args]), [
    ['npm', ['audit', '--omit=optional', '--audit-level=high', '--json']],
    ['npm', ['audit', '--omit=dev', '--omit=optional', '--audit-level=high', '--json']],
  ]);
  assert.ok(current.requests.every(item => item.options.cwd === root && item.options.timeout === 60000));
  assert.equal(current.reads.length, 4);
});

test('clean CLI reports need no exception file and do not fail merely because old policy expired', async () => {
  const result = await runAuditPolicy({ root, clock: () => new Date('2030-01-01'), runner: async () => command(clean), readFile: async () => { throw new Error('must not read policy'); } });
  assert.equal(result.ok, true); assert.equal(result.exceptionUsed, false);
});

test('missing/malformed policy inputs and thrown runner/read errors fail without printing private details', async () => {
  for (const change of [
    current => current.options.runner = async () => { throw new Error('private credential marker'); },
    current => current.files.delete(path.join(root, 'security/audit-exceptions.json')),
    current => current.files.set(path.join(root, 'security/audit-exceptions.json'), '{truncated'),
  ]) {
    const current = orchestration(); change(current); const result = await runAuditPolicy(current.options);
    assert.equal(result.ok, false); assert.equal(result.exceptionUsed, false); assert.doesNotMatch(result.message, /private credential marker/);
  }
});
