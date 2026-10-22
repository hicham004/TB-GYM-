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
 * The `far-zone` project (audit WEB-17) runs the same screens with the browser in Kiritimati (UTC+14,
 * no daylight saving) while the mocked workspaces keep Asia/Beirut, so from 10:00 UTC, the suites'
 * fixed noon among them, the device's day is the workspace's tomorrow: a screen that reads a day from
 * the device where the workspace's belongs fails there for an instant in that window, and in `chromium`'s
 * UTC for one from 21:00 UTC. It compares no pixels, and leaves out what reads no workspace day: the
 * kit's labs, the homepage, the private build, and Messages and Notifications, whose days are the
 * reader's own by design.
 *
 * Screenshot baselines are environment-dependent: the file name carries the browser and platform
 * (`-chromium-win32.png`). Never accept a new or changed baseline without looking at it. The pictures
 * in `docs/design` are written only when asked (`e2e/docs-pictures.ts`).
 */
const port = 4300;
const builtPort = 4301;
const builtFiles = /[\\/]built[\\/].*\.e2e\.ts$/;
// The live checks (playwright.live.config.ts) need a running API, so the mocked projects skip them.
const liveFiles = /[\\/]live[\\/].*\.e2e\.ts$/;
// The edge checks (playwright.edge.config.ts) need a real nginx; scripts/edge-proof.ps1 runs them.
const edgeFiles = /[\\/]edge[\\/].*\.e2e\.ts$/;
// The private build's checks need its own server (npm run e2e:private).
const privateFiles = /[\\/]private[\\/].*\.e2e\.ts$/;
// Screens with no workspace day, or whose days are the reader's own (chat-timeline.ts, the inbox).
const noWorkspaceDay = /[\\/](ui-lab|hero-lab|home|messages|notifications)\.e2e\.ts$/;

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
      name: 'far-zone',
      testIgnore: [builtFiles, liveFiles, edgeFiles, privateFiles, noWorkspaceDay],
      ignoreSnapshots: true,
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        timezoneId: 'Pacific/Kiritimati',
      },
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
