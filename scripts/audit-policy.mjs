#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADVISORY = 'GHSA-vfj7-8cjw-p6xm';
const EXPIRY = '2026-10-17T00:00:00+09:00';
const NAMES = ['eslint-config-next', '@next/eslint-plugin-next', 'fast-glob', 'micromatch', 'braces'];
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const RUNTIME_ROOTS = ['src', 'scripts/mcp-events', 'mcp-events-functions', 'tools/slowth-worker'];
const ROOT_RUNTIME_FILES = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'middleware.ts', 'middleware.js', 'instrumentation.ts', 'instrumentation.js'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const deny = code => { throw new Error(code); };
const exactKeys = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
const integer = value => Number.isSafeInteger(value) && value >= 0;
const knownWarning = /^npm warn Unknown (?:user|env) config "minimum-release-age"\. This will stop working in the next major version of npm\. See `npm help npmrc` for supported config options\.$/;
const acceptedStderr = stderr => stderr.split(/\r?\n/).every(line => !line || knownWarning.test(line));

/** Reject incomplete/error-shaped reports rather than treating missing findings as clean. */
export function validateAuditReport(report) {
  if (!object(report) || Object.hasOwn(report, 'error') || report.auditReportVersion !== 2 ||
      !object(report.vulnerabilities) || !object(report.metadata) || !object(report.metadata.vulnerabilities) ||
      !object(report.metadata.dependencies)) deny('AUDIT_REPORT_INVALID');
  const counts = Object.fromEntries(SEVERITIES.map(severity => [severity, 0]));
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!object(finding) || finding.name !== name || !SEVERITIES.includes(finding.severity) ||
        typeof finding.isDirect !== 'boolean' || typeof finding.range !== 'string' || !Array.isArray(finding.via) ||
        !finding.via.length || finding.via.some(via => typeof via !== 'string' && !object(via)) ||
        !Array.isArray(finding.effects) || finding.effects.some(effect => typeof effect !== 'string') ||
        !Array.isArray(finding.nodes) || !finding.nodes.length || finding.nodes.some(node => typeof node !== 'string' || !node.startsWith('node_modules/')))
      deny('AUDIT_REPORT_INVALID');
    counts[finding.severity]++;
  }
  const reported = report.metadata.vulnerabilities;
  if (!exactKeys(reported, [...SEVERITIES, 'total']) || SEVERITIES.some(severity => !integer(reported[severity]) || reported[severity] !== counts[severity]) ||
      !integer(reported.total) || reported.total !== Object.keys(report.vulnerabilities).length) deny('AUDIT_REPORT_CONTRADICTORY');
  const dependencies = report.metadata.dependencies;
  if (['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'].some(key => !integer(dependencies[key]))) deny('AUDIT_REPORT_INVALID');
  return report;
}

/** npm audit legitimately exits 1 for high findings; command/registry/JSON failures never qualify. */
export function parseAuditCommand(result) {
  if (!object(result) || result.error || result.signal || ![0, 1].includes(result.status) ||
      typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || !acceptedStderr(result.stderr)) deny('AUDIT_COMMAND_FAILED');
  let report;
  try { report = JSON.parse(result.stdout); } catch { deny('AUDIT_JSON_INVALID'); }
  validateAuditReport(report);
  const high = report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical;
  if (result.status !== (high ? 1 : 0)) deny('AUDIT_EXIT_CONTRADICTORY');
  return report;
}

function validatePolicy(policy) {
  if (!exactKeys(policy, ['schema', 'exceptions']) || policy.schema !== 'taskflow-audit-exceptions/v1' ||
      !Array.isArray(policy.exceptions) || policy.exceptions.length !== 1) deny('EXCEPTION_POLICY_INVALID');
  const entry = policy.exceptions[0];
  if (!exactKeys(entry, ['advisory', 'expiresAt', 'scope', 'acceptedRisk', 'eslintConfig', 'lintCommand', 'runtimeUseGuard', 'packages', 'incomingEdges', 'findings']) ||
      entry.advisory !== ADVISORY || entry.expiresAt !== EXPIRY || entry.scope !== 'dev-only-current-eslint-chain' ||
      typeof entry.acceptedRisk !== 'string' || !entry.acceptedRisk.trim() || typeof entry.lintCommand !== 'string' || !entry.lintCommand.trim() ||
      !exactKeys(entry.eslintConfig, ['path', 'sha256']) || entry.eslintConfig.path !== 'eslint.config.mjs' || !/^[a-f0-9]{64}$/.test(entry.eslintConfig.sha256) ||
      !Array.isArray(entry.packages) || entry.packages.length !== NAMES.length || !Array.isArray(entry.incomingEdges) || entry.incomingEdges.length !== NAMES.length ||
      !object(entry.findings) || !same(Object.keys(entry.findings).sort(), [...NAMES].sort())) deny('EXCEPTION_POLICY_INVALID');
  const guard = entry.runtimeUseGuard;
  if (!exactKeys(guard, ['requiredRoots', 'rootFiles', 'computedImportAllowlist']) || !same(guard.requiredRoots, RUNTIME_ROOTS) || !same(guard.rootFiles, ROOT_RUNTIME_FILES) ||
      !Array.isArray(guard.computedImportAllowlist) || guard.computedImportAllowlist.length !== 1 ||
      !exactKeys(guard.computedImportAllowlist[0], ['path', 'sha256']) || guard.computedImportAllowlist[0].path !== 'tools/slowth-worker/domain-loader.mjs' ||
      !/^[a-f0-9]{64}$/.test(guard.computedImportAllowlist[0].sha256)) deny('EXCEPTION_POLICY_INVALID');
  for (const [index, name] of NAMES.entries()) {
    const pin = entry.packages[index], edge = entry.incomingEdges[index];
    if (!exactKeys(pin, ['name', 'path', 'version', 'integrity', 'dev']) || pin.name !== name || pin.path !== `node_modules/${name}` ||
        typeof pin.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin.version) || typeof pin.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pin.integrity) || pin.dev !== true ||
        !exactKeys(edge, ['from', 'field', 'dependency', 'range']) || edge.from !== (index ? `node_modules/${NAMES[index - 1]}` : '') ||
        edge.field !== (index ? 'dependencies' : 'devDependencies') || edge.dependency !== name || typeof edge.range !== 'string' || !edge.range)
      deny('EXCEPTION_POLICY_INVALID');
  }
  const expected = { auditReportVersion: 2, vulnerabilities: entry.findings,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 5, critical: 0, total: 5 },
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 } } };
  validateAuditReport(expected);
  const advisories = Object.values(entry.findings).flatMap(finding => finding.via.filter(object));
  if (advisories.length !== 1 || advisories[0].url !== `https://github.com/advisories/${ADVISORY}` ||
      advisories[0].source !== 1240992 || advisories[0].name !== 'braces' || advisories[0].dependency !== 'braces' || advisories[0].severity !== 'high') deny('EXCEPTION_POLICY_INVALID');
  return entry;
}

const sortedEdges = edges => edges.sort((left, right) => JSON.stringify(canonical(left)).localeCompare(JSON.stringify(canonical(right))));
function edgesFor(packages) {
  const edges = [];
  for (const [from, pkg] of Object.entries(packages)) {
    if (!object(pkg)) deny('LOCKFILE_INVALID');
    for (const field of DEPENDENCY_FIELDS) {
      if (pkg[field] !== undefined && !object(pkg[field])) deny('LOCKFILE_INVALID');
      for (const [dependency, range] of Object.entries(pkg[field] ?? {})) if (NAMES.includes(dependency)) edges.push({ from, field, dependency, range });
    }
  }
  return sortedEdges(edges);
}

function validateLockedScope(entry, lockfile, packageJson, eslintConfigBytes) {
  if (!object(lockfile) || lockfile.lockfileVersion !== 3 || !object(lockfile.packages) || !object(lockfile.packages['']) ||
      !object(packageJson) || !object(packageJson.scripts)) deny('LOCKFILE_INVALID');
  if (packageJson.scripts.lint !== entry.lintCommand || !eslintConfigBytes || sha256(eslintConfigBytes) !== entry.eslintConfig.sha256) deny('LINT_REACHABILITY_CHANGED');
  for (const pin of entry.packages) {
    const pkg = lockfile.packages[pin.path];
    if (!object(pkg) || pkg.version !== pin.version || pkg.integrity !== pin.integrity || pkg.dev !== true || pkg.optional === true || pkg.devOptional === true || pkg.link === true)
      deny('LOCKED_PACKAGE_DRIFT');
    const paths = Object.entries(lockfile.packages).filter(([node, candidate]) => node && (node === pin.path || node.endsWith(`/node_modules/${pin.name}`) || candidate.name === pin.name)).map(([node]) => node);
    if (!same(paths, [pin.path])) deny('EXTRA_PACKAGE_PATH');
  }
  if (!same(edgesFor(lockfile.packages), sortedEdges([...entry.incomingEdges]))) deny('DEPENDENCY_CHAIN_DRIFT');
  if (!same(edgesFor({ '': packageJson }), sortedEdges(entry.incomingEdges.filter(edge => edge.from === '')))) deny('DEPENDENCY_ROOT_DRIFT');
}

const toolingSource = name => RUNTIME_ROOTS.slice(1).some(root => name.startsWith(root + '/'));
const excludedToolSource = name => ['tools/slowth-worker/fixtures', 'tools/slowth-worker/state'].some(root => name === root || name.startsWith(root + '/')) ||
  toolingSource(name) && /\.(?:test|spec|fixture)(?:\.|$)/.test(name);
const runtimeFile = name => /\.(?:[cm]?[jt]sx?|mdx)$/.test(name) && !excludedToolSource(name);
/** Read every required runtime source tree; a skipped symlink cannot hide an import. */
export async function readRuntimeSources(root = ROOT) {
  const sources = [];
  async function walk(relative) {
    const absolute = path.join(root, relative), stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) deny('RUNTIME_SOURCE_UNAVAILABLE');
    let count = 0;
    for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (['node_modules', '.git'].includes(entry.name) || excludedToolSource(name)) continue;
      if (entry.isSymbolicLink()) deny('RUNTIME_SOURCE_UNAVAILABLE');
      if (entry.isDirectory()) count += await walk(name);
      else if (entry.isFile() && runtimeFile(name)) { sources.push({ path: name, contents: await fs.readFile(path.join(root, name), 'utf8') }); count++; }
    }
    return count;
  }
  for (const relative of RUNTIME_ROOTS) if (!await walk(relative)) deny('RUNTIME_SOURCE_UNAVAILABLE');
  for (const relative of ROOT_RUNTIME_FILES) {
    let stat;
    try { stat = await fs.lstat(path.join(root, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || !stat.isFile()) deny('RUNTIME_SOURCE_UNAVAILABLE');
    sources.push({ path: relative, contents: await fs.readFile(path.join(root, relative), 'utf8') });
  }
  return sources;
}

/** npm dev flags do not prevent Next from bundling an imported dev dependency. */
function validateRuntimeUse(entry, sources) {
  if (!Array.isArray(sources) || RUNTIME_ROOTS.some(root => !sources.some(file => file?.path?.startsWith(root + '/')))) deny('RUNTIME_SOURCE_UNAVAILABLE');
  const paths = new Set();
  for (const file of sources) {
    if (!exactKeys(file, ['path', 'contents']) || typeof file.path !== 'string' || typeof file.contents !== 'string' || paths.has(file.path) ||
        !runtimeFile(file.path) || !(RUNTIME_ROOTS.some(root => file.path.startsWith(root + '/')) || ROOT_RUNTIME_FILES.includes(file.path)) || file.path.split('/').some(part => ['.', '..', ''].includes(part))) deny('RUNTIME_SOURCE_UNAVAILABLE');
    paths.add(file.path);
    const source = ts.createSourceFile(file.path, file.contents, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) deny('RUNTIME_SOURCE_UNPARSEABLE');
    const aliases = new Set(['require', 'module.require']), factories = new Set(['createRequire']);
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ['module', 'node:module'].includes(statement.moduleSpecifier.text) &&
        statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const binding of statement.importClause.namedBindings.elements) if ((binding.propertyName?.text ?? binding.name.text) === 'createRequire') factories.add(binding.name.text);
    }
    let aliasesChanged;
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = node.initializer.getText(source);
        const factory = ts.isCallExpression(node.initializer) && (factories.has(node.initializer.expression.getText(source)) || /(?:^|\.)createRequire$/.test(node.initializer.expression.getText(source)));
        if ((aliases.has(value) || factory) && !aliases.has(node.name.text)) { aliases.add(node.name.text); aliasesChanged = true; }
      }
      ts.forEachChild(node, collect);
    }
    do { aliasesChanged = false; collect(source); } while (aliasesChanged);
    const reviewedComputed = entry.runtimeUseGuard.computedImportAllowlist.some(pin => pin.path === file.path && pin.sha256 === sha256(file.contents));
    const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
    function check(specifier, moduleTarget = false) {
      specifier = specifier.split('!').at(-1).split(/[?#]/)[0];
      if (NAMES.some(name => specifier === name || specifier.startsWith(name + '/') || specifier.includes(`/node_modules/${name}/`) || specifier.endsWith(`/node_modules/${name}`))) deny('RUNTIME_DEV_CHAIN_REFERENCE');
      const target = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier)) : specifier;
      if (moduleTarget && excludedToolSource(target)) deny('RUNTIME_EXCLUDED_SOURCE_REFERENCE');
    }
    function inspect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const value = literal(node.moduleSpecifier); if (value === null) deny('RUNTIME_COMPUTED_IMPORT'); else check(value, true);
      }
      if (ts.isCallExpression(node)) {
        const target = node.expression.getText(source), base = target.replace(/\.(?:resolve|require)$/, '');
        const moduleCall = node.expression.kind === ts.SyntaxKind.ImportKeyword || aliases.has(target) || aliases.has(base) || target === 'module.require';
        if (moduleCall) { const value = literal(node.arguments[0]); if (value === null && !reviewedComputed) deny('RUNTIME_COMPUTED_IMPORT'); if (value !== null) check(value, true); }
        // Even a renamed loader cannot hide a literal use of an accepted package.
        for (const argument of node.arguments) { const value = literal(argument); if (value !== null) check(value); }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  for (const pin of entry.runtimeUseGuard.computedImportAllowlist) if (!sources.some(file => file.path === pin.path && sha256(file.contents) === pin.sha256)) deny('REVIEWED_RUNTIME_LOADER_DRIFT');
}

/** Pure, network-free evaluation. A clean audit needs no exception, including after expiry. */
export function evaluateAudit({ fullReport, productionReport, lockfile, packageJson, eslintConfigBytes, runtimeSources, policy, now = new Date() }) {
  try {
    validateAuditReport(fullReport); validateAuditReport(productionReport);
    if (productionReport.metadata.vulnerabilities.total !== 0) deny('PRODUCTION_FINDINGS');
    if (fullReport.metadata.vulnerabilities.total === 0) return { ok: true, exceptionUsed: false, findings: 0, message: 'Audit passed: zero findings; no risk exception used.' };
    const entry = validatePolicy(policy);
    const instant = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN;
    if (!Number.isFinite(instant)) deny('AUDIT_CLOCK_INVALID');
    if (instant >= Date.parse(entry.expiresAt)) deny('EXCEPTION_EXPIRED');
    if (!same(fullReport.vulnerabilities, entry.findings)) deny('UNAPPROVED_FINDINGS');
    validateLockedScope(entry, lockfile, packageJson, eslintConfigBytes);
    validateRuntimeUse(entry, runtimeSources);
    return { ok: true, exceptionUsed: true, advisory: ADVISORY, findings: 5, expiresAt: entry.expiresAt,
      message: `RISK ACCEPTED, NOT FIXED: ${ADVISORY}; exactly 5 known high findings in the pinned dev-only lint chain. Production audit: zero findings. Exception expires exclusively at ${EXPIRY}.` };
  } catch (error) {
    return { ok: false, exceptionUsed: false, code: error.message, message: `Audit failed closed: ${error.message}. No risk exception applied.` };
  }
}

/** Injectable orchestration permits command/network/read failures to be tested without network. */
export async function runAuditPolicy({ root = ROOT, runner = (command, args, options) => spawnSync(command, args, options), readFile = fs.readFile, runtimeReader = readRuntimeSources, clock = () => new Date() } = {}) {
  try {
    const options = { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 12 * 1024 * 1024 };
    const fullReport = parseAuditCommand(await runner('npm', ['audit', '--omit=optional', '--audit-level=high', '--json'], options));
    const productionReport = parseAuditCommand(await runner('npm', ['audit', '--omit=dev', '--omit=optional', '--audit-level=high', '--json'], options));
    if (fullReport.metadata.vulnerabilities.total === 0) return evaluateAudit({ fullReport, productionReport });
    let policy, lockfile, packageJson, eslintConfigBytes, runtimeSources;
    try {
      [policy, lockfile, packageJson, eslintConfigBytes, runtimeSources] = await Promise.all([
        readFile(path.join(root, 'security/audit-exceptions.json'), 'utf8').then(JSON.parse),
        readFile(path.join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
        readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
        readFile(path.join(root, 'eslint.config.mjs')),
        runtimeReader(root),
      ]);
    } catch { deny('AUDIT_POLICY_INPUT_UNAVAILABLE'); }
    return evaluateAudit({ fullReport, productionReport, policy, lockfile, packageJson, eslintConfigBytes, runtimeSources, now: clock() });
  } catch (error) {
    const known = /^(?:AUDIT_[A-Z_]+)$/.test(error?.message ?? '') ? error.message : 'AUDIT_COMMAND_FAILED';
    return { ok: false, exceptionUsed: false, code: known, message: `Audit failed closed: ${known}. No risk exception applied.` };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runAuditPolicy();
  (result.ok ? process.stdout : process.stderr).write(result.message + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
