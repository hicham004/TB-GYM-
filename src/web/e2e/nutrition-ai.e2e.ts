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

test.use({ allowedConsoleErrors: { patterns: [/status of 503 .*\/api\/nutrition\/ai-drafts/] } });

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
      'GET /api/nutrition/foods': (route) => json(route, 200, { total: 0, items: [] }),
      'GET /api/nutrition/recipes': (route) => json(route, 200, { total: 0, items: [] }),
      'GET /api/nutrition/settings': (route) =>
        json(route, 200, {
          energyPolicyKey: 'AtwaterSpecific',
          energyPolicyVersion: 'v1',
          providerCalorieTolerance: 5,
          aiMonthlyRequestLimit: 10,
          aiMonthlyCostLimit: 20,
          aiCostCurrency: 'USD',
          version: 1,
        }),
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
    await page.goto('/nutrition/library');
    const button = page.getByRole('button', { name: 'Generate meal suggestion', exact: true });
    await expect(button).toBeDisabled();
    await expect(
      page.getByText("AI meal suggestions aren't set up yet.", { exact: false }),
    ).toBeVisible();
    configured = true;
    await page.reload();
    await expect(button).toBeEnabled();
    await page.getByLabel('Prompt', { exact: true }).fill('A breakfast with oats');
    await button.click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('AI suggestions took too long');
    await expect(alert).toBeFocused();
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `../../docs/design/f2-ai-${width}.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
