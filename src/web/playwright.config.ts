import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks for the design-system foundation: the development-only UI lab and a visual guard
 * over representative existing routes. They run against `ng serve` (development configuration),
 * because the lab route only exists there. Every API call is answered by a per-test `page.route`
 * mock, so no backend is needed and no runtime guard is bypassed: the guards run and read the mocks.
 *
 * Files are named `*.e2e.ts`, not `*.spec.ts`, because the Angular unit-test builder collects every
 * `**\/*.spec.ts` under this project and would try to run them in Vitest.
 *
 * Screenshot baselines are environment-dependent: the file name carries the browser and platform
 * (`-chromium-win32.png`). Never accept a new or changed baseline without looking at it.
 */
const port = 4300;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 2,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: {
    command: `npx ng serve --configuration development --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
});
