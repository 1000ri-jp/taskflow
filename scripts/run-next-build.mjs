import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nextBin = path.resolve(__dirname, '../node_modules/next/dist/bin/next');
const ignoredPrefix = '[baseline-browser-mapping] The data in this module is over two months old.';

const args = process.argv.slice(2);
// Use the same verified bundler locally and in App Hosting. Turbopack can
// still be checked explicitly with `npm run build -- --turbopack`.
const bundler = args.some(arg => ['--webpack', '--turbopack', '--turbo'].includes(arg)) ? [] : ['--webpack'];
const child = spawn(process.execPath, [nextBin, 'build', ...bundler, ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
    BROWSERSLIST_IGNORE_OLD_DATA: 'true',
  },
});

const forwardLines = (stream, target) => {
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => {
    if (!line.startsWith(ignoredPrefix)) {
      target.write(`${line}\n`);
    }
  });
};

forwardLines(child.stdout, process.stdout);
forwardLines(child.stderr, process.stderr);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
