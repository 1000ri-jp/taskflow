import { defineConfig, devices } from '@playwright/test';
// Use an already-built candidate running locally; never attach to production.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'release-smoke.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/release-smoke',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3105', screenshot: 'only-on-failure' },
});
