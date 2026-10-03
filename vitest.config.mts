import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      SESSION_SECRET: 'test-secret-test-secret-test-secret-1234',
      DATABASE_URL: 'pglite://memory',
      DEMO_MODE: 'true',
      AI_PROVIDER: 'template',
    },
  },
});
