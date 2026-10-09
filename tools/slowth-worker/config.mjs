import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(ROOT, '../..');
const requiredText = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || /REPLACE_|CHANGE_ME|YOUR_|[<>]/i.test(value)) throw new Error(`WORKER_CONFIG_INVALID: supply an explicit ${name}.`);
  return value;
};
const identifier = (value, name) => {
  const text = requiredText(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(text)) throw new Error(`WORKER_CONFIG_INVALID: invalid ${name}.`);
  return text;
};
function canonicalPath(value) {
  try { return fs.realpathSync(value); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(value);
    return parent === value ? value : path.join(canonicalPath(parent), path.basename(value));
  }
}
const within = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);
export function validateMcpEndpoint(value) {
  const endpoint = requiredText(value, 'mcpEndpoint');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('WORKER_CONFIG_INVALID: mcpEndpoint must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('WORKER_CONFIG_INVALID: mcpEndpoint must use HTTPS without credentials, query or fragment.');
  return url.href;
}

/** Explicit local configuration only. Importing this module never loads credentials or starts a worker. */
export function parseWorkerConfig(raw, { file = path.join(ROOT, 'config.local.json') } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WORKER_CONFIG_INVALID: expected a configuration object.');
  const allowed = ['schema', 'projectId', 'workerId', 'stateDirectory', 'sources', 'serverSourceRoot', 'firebase', 'mcpEndpoint', 'codexCommand', 'pythonCommand'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('WORKER_CONFIG_INVALID: unknown fields; keep credentials outside worker configuration.');
  if (raw.schema !== 'slowth-worker-config/v1') throw new Error('WORKER_CONFIG_INVALID: expected slowth-worker-config/v1.');
  const configFile = canonicalPath(path.resolve(file));
  const resolvePath = (value, name) => {
    const text = requiredText(value, name);
    return canonicalPath(path.resolve(path.dirname(configFile), text.startsWith('~/') ? path.join(os.homedir(), text.slice(2)) : text));
  };
  const projectId = identifier(raw.projectId, 'projectId'), workerId = identifier(raw.workerId, 'workerId');
  const stateDirectory = resolvePath(raw.stateDirectory, 'stateDirectory');
  if (!raw.sources || typeof raw.sources !== 'object' || Array.isArray(raw.sources) || !Object.keys(raw.sources).length || Object.keys(raw.sources).length > 30) throw new Error('WORKER_CONFIG_INVALID: register explicit source IDs and paths.');
  const sources = Object.fromEntries(Object.entries(raw.sources).map(([id, location]) => [identifier(id, 'source ID'), resolvePath(location, `source path for ${id}`)]));
  if (Object.values(sources).some(location => within(location, stateDirectory))) throw new Error('WORKER_CONFIG_INVALID: stateDirectory must not contain a registered source.');
  let firebase = null;
  if (raw.firebase !== undefined) {
    if (!raw.firebase || typeof raw.firebase !== 'object' || Array.isArray(raw.firebase) || Object.keys(raw.firebase).some(key => !['projectId', 'storageBucket'].includes(key))) throw new Error('WORKER_CONFIG_INVALID: Firebase settings must not contain credentials.');
    firebase = { projectId: identifier(raw.firebase.projectId, 'Firebase projectId'), storageBucket: requiredText(raw.firebase.storageBucket, 'Firebase storageBucket') };
    if (/[\s/:]/.test(firebase.storageBucket)) throw new Error('WORKER_CONFIG_INVALID: supply a storage bucket name, not a URL.');
  }
  return Object.freeze({ schema: raw.schema, configFile, projectId, workerId, stateDirectory,
    sources: Object.freeze(sources), privatePaths: Object.freeze([configFile, stateDirectory]),
    serverSourceRoot: raw.serverSourceRoot === undefined ? null : resolvePath(raw.serverSourceRoot, 'serverSourceRoot'),
    firebase: firebase && Object.freeze(firebase), mcpEndpoint: raw.mcpEndpoint === undefined ? null : validateMcpEndpoint(raw.mcpEndpoint),
    codexCommand: raw.codexCommand === undefined ? 'codex' : requiredText(raw.codexCommand, 'codexCommand'),
    pythonCommand: raw.pythonCommand === undefined ? 'python3' : requiredText(raw.pythonCommand, 'pythonCommand') });
}
export function readWorkerConfig(file = process.env.SLOWTH_WORKER_CONFIG) {
  if (!file) throw new Error('WORKER_CONFIG_REQUIRED: set SLOWTH_WORKER_CONFIG to your private reviewed configuration. No production defaults are selected.');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('WORKER_CONFIG_INVALID: configuration JSON could not be parsed.');
    throw new Error('WORKER_CONFIG_UNAVAILABLE: the selected configuration file could not be read.', { cause: error });
  }
  return parseWorkerConfig(raw, { file });
}
export function assertPublicSourcePath(candidate, config) {
  if (config.privatePaths.some(root => within(canonicalPath(candidate), root))) throw new Error('PRIVATE_WORKER_SOURCE: local configuration and runtime state are not task source inputs.');
}
