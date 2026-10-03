import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a running dev server (http://localhost:3100) — start it with `npm run dev`,
 * or let Playwright start it (reuses an existing server when present).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3100/api/v1/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
