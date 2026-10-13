import { defineConfig, devices } from '@playwright/test';

// A separate mock-only server prevents this suite from reusing real Firebase state.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'pdf-preview.spec.ts',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: 'test-results/pdf-preview',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    launchOptions: process.env.PDF_PREVIEW_CHROMIUM_PATH
      ? { executablePath: process.env.PDF_PREVIEW_CHROMIUM_PATH }
      : undefined,
    baseURL: 'http://127.0.0.1:3020',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3020',
    url: 'http://127.0.0.1:3020',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_E2E_MOCK_AUTH: 'true',
      NEXT_PUBLIC_ENABLE_TEST_AUTH: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DEV_DIST_DIR: '.next-pdf-e2e',
      NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-pdf-project.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-pdf-project',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-pdf-project.appspot.com',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abcdef123456',
      NEXT_PUBLIC_DEMO_EMAIL: 'pdf-preview@example.test',
      NEXT_PUBLIC_DEMO_PASSWORD: 'mock-pdf-preview-password',
    },
  },
});
