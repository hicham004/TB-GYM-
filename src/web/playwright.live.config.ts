import { defineConfig, devices } from '@playwright/test';

/**
 * Live checks (full audit, October 2026): real sign-ins against a running API on a fresh Atlas demo
 * (`.\scripts\demo-workspace.ps1`), with no mocks, so the rules the mocked suite answers for itself
 * (antiforgery, tenancy, money, dates) are proved against PostgreSQL. They run only when
 * `TB_GYM_LIVE_URL` names the origin that serves the app with its API behind it (for example
 * http://127.0.0.1:4401, the way nginx serves it), so `npm run e2e` never needs a backend:
 *
 *   TB_GYM_LIVE_URL=http://127.0.0.1:4401 npx playwright test -c playwright.live.config.ts
 *
 * Every spec signs in through the real sign-in page as a demo account (e2e/live/support.ts) and
 * creates what it changes (a new client, a new program), so a rebuilt demo runs it again. A test that
 * fails here because of a real defect stays failing: the audit report names it.
 */
const baseURL = process.env['TB_GYM_LIVE_URL'];

export default defineConfig({
  testDir: './e2e/live',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Beirut',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
