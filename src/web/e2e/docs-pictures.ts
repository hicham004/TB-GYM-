import { test, type Page, type PageScreenshotOptions } from '@playwright/test';

/**
 * A picture for the design record in `docs/design`, written only when `TB_GYM_DOCS_PICTURES` is 1 and
 * only by the main browser project (audit WEB-17). A plain run checks the same screen and leaves the
 * committed pictures alone; the far-zone project never writes them. To refresh a spec's pictures:
 *
 *   $env:TB_GYM_DOCS_PICTURES = '1'; npx playwright test --project=chromium e2e/foods.e2e.ts; Remove-Item Env:TB_GYM_DOCS_PICTURES
 */
export async function docsPicture(
  page: Page,
  name: string,
  options: Pick<PageScreenshotOptions, 'clip' | 'fullPage'> = {},
): Promise<void> {
  if (process.env['TB_GYM_DOCS_PICTURES'] !== '1' || test.info().project.name !== 'chromium')
    return;
  await page.screenshot({ path: `../../docs/design/${name}`, ...options });
}
