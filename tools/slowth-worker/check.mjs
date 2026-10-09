#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './config.mjs';

for (const name of fs.readdirSync(ROOT).filter(name => name.endsWith('.mjs'))) {
  const checked = spawnSync(process.execPath, ['--check', path.join(ROOT, name)], { stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}
for (const name of ['codex-output.schema.json', 'config.example.json', 'fixtures/config.json']) JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
console.log('Worker JavaScript syntax and checked-in JSON passed. No worker, credentials, model or cloud operation started.');
