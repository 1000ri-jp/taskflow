import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const slash = value => value.split(path.sep).join('/');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const excluded = file => /\.(test|spec)\.|\/(__tests__|test)\//.test(file);
export function sourceFiles(root) {
  const result = [];
  function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, item.name); if (item.isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(p)) result.push(slash(path.relative(root, p))); } }
  walk(path.join(root, 'src'));
  return result.filter(file => !excluded(file)).sort();
}
export function references(file, text) {
  if (file.endsWith('.css')) return [...text.matchAll(/@import\s+["']([^"']+)["']/g)].map(match => match[1]);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const refs = new Set();
  function walk(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (!(bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every(item => item.isTypeOnly) && !node.importClause?.name)) refs.add(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) refs.add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) refs.add(node.arguments[0].text);
    ts.forEachChild(node, walk);
  }
  walk(source); return [...refs];
}
export function buildGraph(root, files = sourceFiles(root)) {
  const known = new Set(files); const graph = {};
  for (const file of files) {
    graph[file] = references(file, fs.readFileSync(path.join(root, file), 'utf8')).flatMap(ref => {
      const stem = ref.startsWith('@/') ? `src/${ref.slice(2)}` : ref.startsWith('.') ? slash(path.normalize(path.join(path.dirname(file), ref))) : null;
      if (!stem) return [];
      const resolved = [stem, ...['.ts', '.tsx', '/index.ts', '/index.tsx', '.css'].map(ext => stem + ext)].find(candidate => known.has(candidate));
      return resolved ? [resolved] : [];
    }).sort();
  }
  return graph;
}
export function consumers(graph, sources) {
  const visited = new Set(sources); const direct = Object.keys(graph).filter(file => !visited.has(file) && graph[file].some(ref => sources.includes(ref)));
  const queue = [...sources];
  while (queue.length) { const source = queue.shift(); for (const [file, deps] of Object.entries(graph)) if (!visited.has(file) && deps.includes(source)) { visited.add(file); queue.push(file); } }
  return { direct, indirect: [...visited].filter(file => !sources.includes(file) && !direct.includes(file)).sort() };
}
export function dependencies(graph, sources) {
  const found = new Set(sources); const queue = [...sources];
  while (queue.length) for (const dep of graph[queue.shift()] ?? []) if (!found.has(dep)) { found.add(dep); queue.push(dep); }
  return [...found].sort();
}
export function routeFor(file) {
  return '/' + file.replace(/^src\/app\//, '').split('/').filter(segment => !/^\(.*\)$/.test(segment) && !/^(page|layout)\.tsx?$/.test(segment)).join('/');
}
const styleToken = /^(?:(?:[a-z\[\]&@][^\s]*):)*(?:text-(?:xs|sm|base|lg|[2-9]?xl|\[|foreground|muted|primary|secondary|destructive|[a-z]+-\d)|font-|leading-|tracking-|(?:p|m)[xytrblse]?-[\d[\]]|space-[xy]-|gap(?:-[xy])?-|bg-|border-(?:[a-z]+-\d|\[)|rounded-)/;
export function rawStyles(file, text) {
  if (file.endsWith('.css')) return { [`stylesheet:${digest(text)}`]: 1 };
  if (!file.endsWith('.tsx')) return {};
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const found = {};
  function add(value) { found[value] = (found[value] ?? 0) + 1; }
  function walk(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const tokens = node.text.split(/\s+/).filter(token => styleToken.test(token)); if (tokens.length) add(tokens.join(' '));
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style' && node.initializer) {
      const text = node.initializer.getText(source); if (/fontSize|lineHeight|padding|margin|color|background/.test(text)) add(`inline-style:${text}`);
    }
    ts.forEachChild(node, walk);
  }
  walk(source); return found;
}
export function newOverrides(current, baseline) {
  return Object.entries(current).flatMap(([file, values]) => Object.entries(values).filter(([signature, count]) => count > (baseline[file]?.[signature] ?? 0)).map(([signature]) => ({ file, signature })));
}
const isGuide = file => file.includes('/ui-guide/');
function writeJSON(root, name, value) { fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n'); }
export function audit(root) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
  const graph = buildGraph(root); const files = Object.keys(graph); const sources = new Set(catalog.entries.flatMap(entry => entry.sources));
  const errors = [];
  for (const entry of catalog.entries) {
    for (const key of ['id','level','name','purpose','status','sources','variants','scope','impact','links']) if (!entry[key] || !entry[key].length) errors.push(`${entry.id}: missing ${key}`);
    for (const file of entry.sources) if (!files.includes(file)) errors.push(`${entry.id}: missing source ${file}`);
    for (const link of entry.links) if (!files.some(file => /\/page\.tsx?$/.test(file) && routeFor(file) === link.href)) errors.push(`${entry.id}: unresolved live link ${link.href}`);
  }
  const fileHashes = Object.fromEntries(files.map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
  const entries = Object.fromEntries(catalog.entries.map(entry => {
    const found = consumers(graph, entry.sources); const all = [...found.direct, ...found.indirect].filter(file => !isGuide(file));
    const layouts = all.filter(file => /\/layout\.tsx?$/.test(file));
    const routes = files.filter(file => /\/page\.tsx?$/.test(file) && !isGuide(file) && (all.includes(file) || layouts.some(layout => file.startsWith(path.dirname(layout) + '/'))));
    return [entry.id, { sourceHash: digest([...new Set([...dependencies(graph, entry.sources), 'src/app/globals.css', 'src/app/neo-appearance.css', 'src/app/ui-tokens.css', ...all])].sort().map(file => `${file}:${fileHashes[file]}`).join('')), direct: found.direct.filter(file => !isGuide(file)), indirect: found.indirect.filter(file => !isGuide(file)), routes: [...new Set(routes.map(routeFor))].sort() }];
  }));
  const independent = {};
  for (const file of files.filter(file => !sources.has(file) && !isGuide(file))) {
    const styles = rawStyles(file, fs.readFileSync(path.join(root, file), 'utf8')); if (Object.keys(styles).length) independent[file] = styles;
  }
  const usage = { revision: catalog.revision, graphHash: digest(JSON.stringify(graph)), entries,
    limits: ['ファイル単位の静的参照です。同じファイルの別exportの利用を含みます。', '実行時に組み立てるimport、外部コード、表示条件ごとの分岐は完全には追跡できません。', 'コード参照の照合と実画面での確認は別です。'],
    independent: Object.entries(independent).map(([file, signatures]) => ({ file, count: Object.values(signatures).reduce((a,b) => a+b,0) })).sort((a,b) => b.count-a.count),
  };
  return { catalog, graph, sources, errors, usage, independent, fileHashes };
}
function main() {
  const root = process.cwd(); const args = process.argv.slice(2); const data = audit(root);
  const basePath = 'src/lib/ui-guide/legacy-styles.json';
  if (args.includes('--init-baseline')) {
    if (fs.existsSync(path.join(root,basePath))) throw new Error('Baseline already exists. Add a named shared variant or a reviewed narrow exception; do not reset the baseline.');
    writeJSON(root, basePath, data.independent);
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(root, basePath), 'utf8'));
  const overrides = newOverrides(data.independent, baseline);
  data.errors.push(...overrides.map(item => `Unregistered display override: ${item.file}: ${item.signature}`));
  const releasePaths = new Set([...data.sources, ...Object.values(data.usage.entries).flatMap(entry => entry.direct), ...Object.keys(data.graph).filter(isGuide), 'AGENTS.md', 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md', 'scripts/ui-guide.mjs', 'scripts/ui-guide.test.mjs', 'src/components/providers/index.tsx', 'next.config.ts', 'package.json']);
  for (const p of [...releasePaths]) if (p.includes('/ui-guide/') && p.endsWith('.json')) releasePaths.delete(p);
  ['src/lib/ui-guide/catalog.json','src/lib/ui-guide/legacy-styles.json','src/lib/ui-guide/verification.json','src/lib/ui-guide/usage.generated.json','src/components/providers/ui-guide-isolation.test.tsx','src/components/ui-guide/GuidePreview.test.tsx'].forEach(p => releasePaths.add(p));
  // Consumers can depend on hooks/helpers outside the specimen's own sources.
  // Include their transitive implementation dependencies in cross-worktree comparison.
  for (const file of dependencies(data.graph, [...releasePaths])) releasePaths.add(file);
  const release = { revision: data.catalog.revision, files: [...releasePaths].sort().filter(p => p.endsWith('/usage.generated.json') || fs.existsSync(path.join(root,p))).map(p => ({path:p,sha256:digest(p.endsWith('/usage.generated.json') ? JSON.stringify(data.usage, null, 2) + '\n' : fs.readFileSync(path.join(root,p)))})) };
  if (args.includes('--refresh')) {
    if (data.errors.length) throw new Error(data.errors.join('\n'));
    writeJSON(root, 'src/lib/ui-guide/usage.generated.json', data.usage);
    writeJSON(root, 'src/lib/ui-guide/release.generated.json', release);
    console.log(`Updated static usage for ${data.catalog.entries.length} specimens; ${data.usage.independent.length} files retain legacy local styling.`);
    return;
  }
  for (const [file,value] of [['usage.generated.json',data.usage],['release.generated.json',release]]) {
    const saved = JSON.parse(fs.readFileSync(path.join(root,'src/lib/ui-guide',file),'utf8'));
    if (JSON.stringify(saved) !== JSON.stringify(value)) data.errors.push(`${file} is stale. Inspect changes, then run npm run ui:refresh.`);
  }
  const compare = args.indexOf('--compare-worktree');
  if (compare >= 0) {
    if (!args[compare+1]) throw new Error('--compare-worktree requires the receiving checkout path');
    const target = path.resolve(args[compare+1]);
    for (const file of release.files) { const p = path.join(target,file.path); if (!fs.existsSync(p) || digest(fs.readFileSync(p)) !== file.sha256) data.errors.push(`Not incorporated in ${target}: ${file.path}`); }
    const receivingManifest = path.join(target, 'src/lib/ui-guide/release.generated.json');
    if (!fs.existsSync(receivingManifest) || JSON.stringify(JSON.parse(fs.readFileSync(receivingManifest, 'utf8'))) !== JSON.stringify(release)) data.errors.push(`Receiving release manifest is missing or different in ${target}.`);
  }
  if (data.errors.length) { console.error(data.errors.join('\n')); process.exitCode=1; }
  else console.log(`UI guide check passed: ${data.catalog.entries.length} specimens, usage current, no new unregistered display overrides${compare>=0?', receiving checkout matches':''}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
