import { defineConfig } from '@playwright/test';

/**
 * The edge's headers (audit WEB-4, WEB-14): `e2e/edge/` reads what nginx sends with each kind of
 * answer, against `TB_GYM_EDGE_URL`. `scripts/edge-proof.ps1` starts nginx from `nginx.conf` and a
 * production build and runs these against it, or runs them against a deployment it is given, such
 * as the test copy. The checks read headers and documents only, so no browser is started.
 */
const baseURL = process.env['TB_GYM_EDGE_URL'];
if (!baseURL) {
  throw new Error(
    'Set TB_GYM_EDGE_URL to the site to check, or run scripts/edge-proof.ps1, which starts one.',
  );
}

export default defineConfig({
  testDir: './e2e/edge',
  testMatch: '**/*.e2e.ts',
  // Its own folder: a run of the main configuration empties ./test-results.
  outputDir: './test-results-edge',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: { baseURL },
});
