import { defineConfig, devices } from '@playwright/test';

// Intentionally uses an already running isolated mock server. Every test checks its mock banner before writes.
export default defineConfig({
  testDir: './e2e', testMatch: ['companion-notifications.spec.ts', 'secretary.spec.ts', 'scoped-conversation.spec.ts', 'dashboard-appearance.spec.ts', 'work-evidence-flow.spec.ts', 'authenticated-smoke.spec.ts'], workers: 1,
  timeout: 30000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3010', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
