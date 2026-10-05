import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { catalog } from '../src/testing/client-service-fixtures';
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

async function openProducts(page: Page, width: number, dark = false) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  let currentCatalog = catalog();
  currentCatalog.products = [
    { ...currentCatalog.products[0], offers: [currentCatalog.products[0].offers[0]] },
  ];
  const requests: unknown[] = [];
  let csrfReads = 0;
  await mockSession(page, {
    extra: {
      'GET /api/auth/csrf': (route) => {
        csrfReads++;
        return json(route, 200, { token: 'e2e-csrf' });
      },
      'GET /api/commercial/products': (route) => json(route, 200, currentCatalog),
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
        const product = currentCatalog.products[0];
        const old = product.offers[0];
        const changed = {
          ...product,
          offers: [
            { ...old, isActive: false },
            { ...old, id: 'o-new', priceAmount: body.priceAmount },
          ],
        };
        currentCatalog = { ...currentCatalog, products: [changed] };
        return json(route, 200, changed);
      },
    },
  });
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Coaching products', exact: true })).toBeVisible();
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
  test(`changing a price at ${width}px keeps the original option and passes axe`, async ({
    page,
  }) => {
    const requests = await openProducts(page, width);
    await page.getByRole('button', { name: 'Change price', exact: true }).click();
    await expect(page.locator('.price-change')).toContainText(
      'Existing plans keep their price, dates and payments.',
    );
    await page.getByLabel('New price', { exact: true }).fill('360');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/f1-change-price-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirm new price', exact: true }).click();
    await expect(page.locator('.price-change')).toHaveCount(0);
    await expect(page.locator('.offer-price strong')).toHaveText(['330 USD', '360 USD']);
    await expect(page.getByRole('status')).toContainText(
      'Existing clients keep their agreed price and payments.',
    );
    expect(requests).toEqual([
      { priceAmount: 360, version: 1, idempotencyKey: expect.any(String) },
    ]);
    await axe(page);
  });

  test(`a duplicate duration at ${width}px explains how to change the price`, async ({ page }) => {
    await openProducts(page, width);
    await page.getByRole('button', { name: 'Add price option', exact: true }).click();
    const form = page.locator('.inline-offer');
    await form.getByLabel('Name', { exact: true }).fill('12 weeks new price');
    await form.locator('input[formControlName="durationCount"]').fill('12');
    await form.locator('input[formControlName="priceAmount"]').fill('360');
    await form.getByRole('button', { name: 'Save price option', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Use Change price');
    await expect(form.locator('input[formControlName="priceAmount"]')).toHaveValue('360');
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test(`the price change reflows with 200% text and RTL at ${width}px`, async ({ page }) => {
    await openProducts(page, width, true);
    await page.getByRole('button', { name: 'Change price', exact: true }).click();
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Confirm new price' })).toBeVisible();
    await axe(page);
  });
}
