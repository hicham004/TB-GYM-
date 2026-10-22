import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockOwnerSession,
  test,
  useRtl,
  waitForFonts,
} from './support';
import { docsPicture } from './docs-pictures';

test.use({ allowedConsoleErrors: { patterns: [/status of 503 .*\/api\/nutrition\/ai-drafts/] } });

/**
 * AI suggestions inside New recipe (ADR 0035, R4.4b): when they are not set up the card says so where
 * they would be; when the provider fails, the failure is said beside the button and focused.
 */
for (const width of [390, 1440]) {
  test(`AI configuration and local failure at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let configured = false;
    let csrfReads = 0;
    await mockOwnerSession(page, {
      'GET /api/auth/csrf': (route) => {
        csrfReads++;
        return json(route, 200, { token: 'csrf-test' });
      },
      'GET /api/nutrition/ai-drafts/availability': (route) =>
        json(route, 200, { isConfigured: configured }),
      'POST /api/nutrition/ai-drafts': (route) => {
        expect(csrfReads).toBeGreaterThan(1);
        return json(route, 503, {
          code: 'ai_provider_timeout',
          message: 'AI suggestions took too long. No recipe was created. Try again later.',
        });
      },
    });
    await page.goto('/nutrition/recipes/new');
    const card = page.locator('section.ai');
    await expect(card).toContainText('AI suggestions aren’t set up for this coaching space yet.');
    await expect(card.getByRole('button')).toHaveCount(0);
    configured = true;
    await page.reload();
    await card.getByRole('button', { name: 'Describe a meal' }).click();
    await page.getByLabel('The meal, in a sentence or two').fill('A breakfast with oats');
    await card.getByRole('button', { name: 'Suggest ingredients' }).click();
    const alert = card.getByRole('alert');
    await expect(alert).toContainText('AI suggestions took too long');
    await expect(alert).toBeFocused();
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await docsPicture(page, `r44b-ai-${width}.png`, { fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
