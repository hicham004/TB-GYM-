import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { CoachingProductView, ProductCatalog } from '../src/app/core/api/generated';
import { atlasCatalog, offer } from '../src/testing/product-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  useRtl,
  waitForFonts,
} from './support';

test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/commercial\//] } });

/** Plans you sell (C8, R5.1a) on the Atlas catalog, with the writes answered in place. */
async function openPlans(page: Page, width: number, dark = false) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  let catalog: ProductCatalog = atlasCatalog();
  const requests: unknown[] = [];
  let csrfReads = 0;
  const online = () => catalog.products[0];
  const replaceOnline = (changed: CoachingProductView) => {
    catalog = { ...catalog, products: [changed, ...catalog.products.slice(1)] };
    return changed;
  };
  await mockSession(page, {
    extra: {
      'GET /api/auth/csrf': (route) => {
        csrfReads++;
        return json(route, 200, { token: 'e2e-csrf' });
      },
      'GET /api/commercial/products': (route) => json(route, 200, catalog),
      'POST /api/commercial/products/p-online/offers': (route) =>
        json(route, 409, {
          code: 'active_offer_slot_conflict',
          message: 'Duplicate active option.',
        }),
      'POST /api/commercial/offers/o-12/price-changes': (route) => {
        expect(csrfReads).toBeGreaterThan(1);
        expect(route.request().headers()['x-tenant-id']).toBe(OWNER_MEMBERSHIP.tenantId);
        const body = route.request().postDataJSON() as {
          priceAmount: number;
          version: number;
          idempotencyKey: string;
        };
        requests.push(body);
        const old = online().offers.find((item) => item.id === 'o-12')!;
        return json(
          route,
          200,
          replaceOnline({
            ...online(),
            offers: [
              ...online().offers.map((item) =>
                item.id === 'o-12' ? { ...old, isActive: false } : item,
              ),
              offer({ id: 'o-12-new', priceAmount: body.priceAmount, version: 1 }),
            ],
          }),
        );
      },
    },
  });
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Plans you sell', exact: true })).toBeVisible();
  await waitForFonts(page);
  return requests;
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

for (const width of [390, 1440]) {
  test(`plans show their clients and price options at ${width}px and pass axe`, async ({
    page,
  }) => {
    await openPlans(page, width);
    await expect(page.locator('.lede')).toHaveText('2 plans for sale · 8 clients on them now');
    const online = page.locator('.plans > .cards > .card').first();
    await expect(online.locator('.clients')).toHaveText('6 clients · 1 starting');
    await expect(online.locator(':scope > .options .price')).toHaveText(['USD 130', 'USD 330']);
    await expect(online.locator(':scope > .includes .chip')).toHaveText([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r51a-plans-${width}.png`, fullPage: true });
  });

  test(`changing a price at ${width}px keeps the old option and passes axe`, async ({ page }) => {
    const requests = await openPlans(page, width);
    await page.getByRole('button', { name: 'More for 12 weeks at USD 330' }).click();
    await page.getByRole('button', { name: 'Change price', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Clients already on this option keep their price');
    await sheet.getByLabel('New price', { exact: true }).fill('360');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await sheet.getByRole('button', { name: 'Change price', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    const online = page.locator('.plans > .cards > .card').first();
    await expect(online.locator(':scope > .options .price')).toHaveText(['USD 130', 'USD 360']);
    await expect(online.locator('details.retired > summary')).toHaveText(/Old price options \(2\)/);
    await expect(page.getByText('New price saved.')).toBeVisible();
    expect(requests).toEqual([
      { priceAmount: 360, version: 1, idempotencyKey: expect.any(String) },
    ]);
    await axe(page);
  });

  test(`a duplicate length at ${width}px is explained in the sheet, keeping the entry`, async ({
    page,
  }) => {
    await openPlans(page, width);
    await page
      .locator('.plans > .cards > .card')
      .first()
      .getByRole('button', { name: 'Add price option' })
      .click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Length in weeks').fill('12');
    await sheet.getByLabel('Price', { exact: true }).fill('360');
    await sheet.getByRole('button', { name: 'Add price option' }).click();
    await expect(sheet.getByRole('alert')).toContainText('Change its price instead');
    await expect(sheet.getByLabel('Price', { exact: true })).toHaveValue('360');
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test(`the new plan sheet reflows with 200% text, dark and RTL at ${width}px`, async ({
    page,
  }) => {
    await openPlans(page, width, true);
    await page.getByRole('button', { name: 'New plan', exact: true }).click();
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Create plan' })).toBeVisible();
    await axe(page);
  });
}
