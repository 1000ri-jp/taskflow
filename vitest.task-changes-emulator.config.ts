import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Never load a developer's .env files for this dummy-project integration run.
  envDir: false,
  test: {
    environment: 'node',
    include: ['src/lib/task/changeRepository.emulator.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
