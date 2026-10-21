import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks for the design-system foundation: the development-only UI lab and a visual guard
 * over representative existing routes. They run against `ng serve` (development configuration),
 * because the lab route only exists there. Every API call is answered by a per-test `page.route`
 * mock, so no backend is needed and no runtime guard is bypassed: the guards run and read the mocks.
 *
 * The `built` project is the exception (UI plan R6.2a): `e2e/built/` runs against a real build of
 * the app, served by `scripts/serve-built.mjs` the way `nginx.conf` serves it. The dev server renders
 * `/` on request too, but only a build writes the two documents (`index.html`, `index.csr.html`) and
 * only nginx chooses between them by address and cookie, which is what that project checks.
 *
 * Files are named `*.e2e.ts`, not `*.spec.ts`, because the Angular unit-test builder collects every
 * `**\/*.spec.ts` under this project and would try to run them in Vitest.
 *
 * Screenshot baselines are environment-dependent: the file name carries the browser and platform
 * (`-chromium-win32.png`). Never accept a new or changed baseline without looking at it.
 */
const port = 4300;
const builtPort = 4301;
const builtFiles = /[\\/]built[\\/].*\.e2e\.ts$/;
// The live checks (playwright.live.config.ts) need a running API, so the mocked projects skip them.
const liveFiles = /[\\/]live[\\/].*\.e2e\.ts$/;
// The edge checks (playwright.edge.config.ts) need a real nginx; scripts/edge-proof.ps1 runs them.
const edgeFiles = /[\\/]edge[\\/].*\.e2e\.ts$/;

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
  projects: [
    {
      name: 'chromium',
      testIgnore: [builtFiles, liveFiles, edgeFiles],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    {
      name: 'built',
      testMatch: builtFiles,
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        baseURL: `http://127.0.0.1:${builtPort}`,
      },
    },
  ],
  webServer: [
    {
      command: `npx ng serve --configuration development --host 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
    {
      // Builds into .e2e-dist when the sources are newer than the last build, then serves it.
      command: `node scripts/serve-built.mjs --build --port ${builtPort}`,
      url: `http://127.0.0.1:${builtPort}/index.csr.html`,
      reuseExistingServer: !process.env['CI'],
      timeout: 300_000,
    },
  ],
});
