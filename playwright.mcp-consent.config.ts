import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'mcp-consent.spec.ts', workers: 1,
  reporter: 'list', outputDir: 'tmp/mcp-project-consent/browser',
  use: { ...devices['Desktop Chrome'], headless: true },
});
