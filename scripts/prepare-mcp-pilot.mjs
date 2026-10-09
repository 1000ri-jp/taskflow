import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const source = process.cwd();
const output = path.resolve(process.argv[2] ?? '../production-release');
if (output === source || output.startsWith(source + path.sep)) throw new Error('Choose a separate output directory');
try { await access(output); throw new Error('Output already exists; choose a fresh path'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: file => {
  const relative = path.relative(source, file);
  return !relative.split(path.sep).some(part => ['node_modules', '.git', '.next', 'docs', 'coverage', 'test-results'].includes(part) ||
    part.startsWith('.next-') || part.startsWith('.env') || part.endsWith('.log') || part.endsWith('.tsbuildinfo'));
} });
const yamlPath = path.join(output, 'apphosting.yaml');
let yaml = await readFile(yamlPath, 'utf8');
yaml = yaml.replace(/(variable: SLOWTH_MCP_EVENTS_PRODUCTION\s+value:)\s*"false"/, '$1 "true"')
  .replace(/(variable: SLOWTH_MCP_EVENTS_SYNTHETIC_TEST\s+value:)\s*'true'/, "$1 'false'");
await writeFile(yamlPath, yaml);
const uid = /variable: SLOWTH_MCP_OAUTH_ALLOWED_UID\s+value:\s*(\S+)/.exec(yaml)?.[1];
if (!uid) throw new Error('Allowed UID missing');
// CLI parameter values only; secret values are never copied into the package.
await writeFile(path.join(output, 'mcp-events-functions', '.env.projectmanager-e3308'),
  `SLOWTH_MCP_WORKER_ENABLED=true\nSLOWTH_MCP_EVENTS_PROJECT_ID=SlBpu8BPYgIARk4DoYOV\nSLOWTH_MCP_OAUTH_ALLOWED_UID=${uid}\n`);
const configPath = path.join(output, 'firebase.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.apphosting.forEach(backend => {
  if (!backend.ignore.includes('mcp-events-functions')) backend.ignore.push('mcp-events-functions');
});
// Functions use prebuilt copies in this clean package, whose parent source is present.
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Prepared local pilot release:', output);
console.log('No deployment, account permission change or data transmission was performed.');
