import { defineConfig } from 'vitest/config';
import { REPO_ROOT, ROOT } from './config.mjs';
import path from 'node:path';
export default defineConfig({
  root: ROOT,
  cacheDir: path.join(ROOT, 'state', 'test-cache'),
  test: { environment: 'node', include: ['bridge.test.ts'], testTimeout: 30000 },
  resolve: { alias: { '@': path.join(REPO_ROOT, 'src') } },
});
