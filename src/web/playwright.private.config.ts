import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks for the private pre-launch build (UI plan R6.2h): `e2e/private/` runs against the
 * build `scripts/private-preview.mjs` makes from `placeholders/` (production plus the `placeholders`
 * configuration), served as the private server serves it. It is its own configuration, so `npm run
 * e2e` does not pay for a second production build; `npm run e2e:private` runs these.
 *
 * The build reads whatever the folder holds: with the owner's stand-ins the pictures are drawn,
 * in a fresh clone every stand-in is grey. The checks hold either way.
 */
const port = 4302;

export default defineConfig({
  testDir: './e2e/private',
  testMatch: '**/*.e2e.ts',
  // Its own folder: a run of the main configuration empties ./test-results.
  outputDir: './test-results-private',
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
      name: 'private',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    // Builds into .e2e-private when the sources or the folder are newer than the last build.
    command: `node scripts/private-preview.mjs serve --build --out .e2e-private --port ${port}`,
    url: `http://127.0.0.1:${port}/index.csr.html`,
    reuseExistingServer: !process.env['CI'],
    timeout: 600_000,
  },
});
