import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const excludedDirectories = name => ['node_modules', '.git', '.firebase', '.cache', '.turbo', 'coverage', 'dist', 'build', '.codex'].includes(name) || name.startsWith('.next');
const excludedFile = name => name.startsWith('.env') || /\.(pem|key|p12|pfx)$/i.test(name) || /(?:service.?account|credential|secret|token|auth)[^/]*\.json$/i.test(name);

export async function registeredSourceFiles(sourceRoot, { excludeRoots = [] } = {}) {
  const files = []; let bytes = 0;
  const actualSourceRoot = await fs.realpath(sourceRoot);
  const privateRoots = await Promise.all(excludeRoots.map(async root => {
    try { return await fs.realpath(root); } catch (error) { if (error.code !== 'ENOENT') throw error; return path.resolve(root); }
  }));
  async function walk(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (privateRoots.some(root => absolute === root || absolute.startsWith(root + path.sep))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!excludedDirectories(entry.name)) await walk(path.join(dir, entry.name), name); }
      else if (entry.isFile() && !excludedFile(entry.name)) {
        const contents = await fs.readFile(path.join(dir, entry.name));
        bytes += contents.length;
        if (contents.length > 20 * 1024 * 1024 || bytes > 200 * 1024 * 1024 || files.length >= 5000) throw new Error('SOURCE_SNAPSHOT_LIMIT: registered source is too large for this executor.');
        files.push({ path: name, sha256: hash(contents), bytes: contents.length });
      }
    }
  }
  await walk(actualSourceRoot); return files;
}

/** Copy only the registered source once; preserve its exact byte manifest and isolated edit directory. */
export async function snapshotRegisteredSource(sourceRoot, jobDir, { excludeRoots = [] } = {}) {
  const workspace = path.join(jobDir, 'workspace'), baseline = path.join(jobDir, 'baseline'), manifestFile = path.join(jobDir, 'source-snapshot.json');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!manifest) {
    const input = await registeredSourceFiles(sourceRoot, { excludeRoots });
    for (const file of input) {
      const bytes = await fs.readFile(path.join(sourceRoot, file.path));
      if (hash(bytes) !== file.sha256) throw new Error(`SOURCE_CHANGED_DURING_SNAPSHOT: ${file.path}`);
      for (const dir of [workspace, baseline]) { const target = path.join(dir, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); }
    }
    let dependencies = null;
    const registeredDependencies = path.join(sourceRoot, 'node_modules');
    try {
      await fs.access(registeredDependencies);
      try { await fs.symlink(registeredDependencies, path.join(workspace, 'node_modules'), 'dir'); }
      catch (error) { if (error.code !== 'EEXIST' || await fs.realpath(path.join(workspace, 'node_modules')) !== await fs.realpath(registeredDependencies)) throw error; }
      const nextFile = path.join(registeredDependencies, 'next/package.json');
      let next = null; try { next = JSON.parse(await fs.readFile(nextFile, 'utf8')).version; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      dependencies = { path: registeredDependencies, usage: 'Read-only dependency link; Codex sandbox only permits edits inside isolated workspace. Do not install or change dependencies.', nextVersion: next,
        nextDocs: next ? 'node_modules/next/dist/docs' : null };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    manifest = { sourceRoot, capturedAt: new Date().toISOString(), input: input.map(item => ({ ...item, existed: true })), dependencies, credentialAndBuildArtifactsExcluded: true };
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  return { workspace, baseline, input: manifest.input, mapping: manifest.dependencies };
}

export async function changedWorkspaceFiles(workspace, baseline, originalFiles) {
  const present = await registeredSourceFiles(workspace), names = new Set([...originalFiles, ...present.map(item => item.path)]);
  const changed = [];
  for (const name of names) {
    let before = null, after = null;
    try { before = await fs.readFile(path.join(baseline, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { after = await fs.readFile(path.join(workspace, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!before || !after || hash(before) !== hash(after)) changed.push(name);
  }
  return changed;
}
