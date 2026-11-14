import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachingProductView, ProductCatalog } from '../src/app/core/api/generated';
import { maxProduct } from '../src/testing/max-staff-fixtures';
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

interface PlansOptions {
  /** What the coach sells; the Atlas catalog when left out. */
  readonly catalog?: ProductCatalog;
  /** More answers, or other ones, for the page's requests. */
  readonly extra?: Record<string, (route: Route) => unknown>;
}

/** Plans you sell (C8, R5.1a) on the Atlas catalog, with the writes answered in place. */
async function openPlans(page: Page, width: number, dark = false, options: PlansOptions = {}) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  let catalog: ProductCatalog = options.catalog ?? atlasCatalog();
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
      ...options.extra,
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
    await expect(online.locator('.retired summary')).toHaveText(/Old price options \(2\)/);
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

for (const width of [390, 1440]) {
  test(`a session pack is set up in the new plan sheet at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openPlans(page, width);
    await page.getByRole('button', { name: 'New plan', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'New plan' });
    await sheet.getByRole('radio', { name: 'Session pack' }).check({ force: true });
    await sheet.getByLabel('Price', { exact: true }).fill('300');

    await expect(sheet.getByRole('spinbutton', { name: 'Sessions' })).toHaveValue('10');
    await expect(sheet.getByLabel('Valid for (days)')).toHaveValue('90');
    await expect(sheet.getByRole('checkbox', { name: '1-on-1 sessions' })).toBeChecked();
    await expect(sheet.getByRole('checkbox', { name: '1-on-1 sessions' })).toBeDisabled();
    await expect(sheet.getByText('Clients pay USD 300 for 10 sessions')).toBeVisible();

    await sheet.getByRole('spinbutton', { name: 'Sessions' }).fill('1');
    await expect(sheet.getByLabel('Valid for (days)')).toHaveValue('30');
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });
}

/** The house's Max plan (notes plan N9c5a): every price option covers its four, and only them. */
test.describe('the house’s Max plan', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 400 .*\/api\/commercial\//] } });
  const LINE = 'A Max plan covers Training, Nutrition, Check-ins and Messaging, all four.';
  const houseCatalog = (): ProductCatalog => ({
    ...atlasCatalog(),
    products: [maxProduct(), ...atlasCatalog().products],
  });
  const MAX_BOXES = [
    ['Training', true],
    ['Nutrition', true],
    ['Check-ins', true],
    ['Messaging', true],
    ['Resources', false],
  ] as const;

  for (const width of [390, 1440]) {
    test(`Add price option on Max at ${width}px locks its four, and sends exactly them`, async ({
      page,
    }) => {
      const sent: unknown[] = [];
      await openPlans(page, width, false, {
        catalog: houseCatalog(),
        extra: {
          'POST /api/commercial/products/p-max/offers': (route) => {
            sent.push(route.request().postDataJSON());
            return json(route, 200, maxProduct());
          },
        },
      });
      await page
        .locator('.plans > .cards > .card', { hasText: 'Max coaching' })
        .getByRole('button', { name: 'Add price option' })
        .click();
      const sheet = page.getByRole('dialog', { name: 'New price option' });
      for (const [name, ticked] of MAX_BOXES) {
        const box = sheet.getByRole('checkbox', { name, exact: true });
        await expect(box).toBeDisabled();
        if (ticked) await expect(box).toBeChecked();
        else await expect(box).not.toBeChecked();
      }
      await expect(sheet.locator('#plan-features-max')).toHaveText(LINE);
      await expect(sheet.locator('fieldset.features')).toHaveAttribute(
        'aria-describedby',
        'plan-features-max',
      );
      await sheet.getByLabel('Length in weeks').fill('8');
      await sheet.getByLabel('Price', { exact: true }).fill('220');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: test.info().outputPath(`n9c5b-max-option-${width}.png`) });

      await sheet.getByRole('button', { name: 'Add price option' }).click();
      await expect(sheet).toHaveCount(0);
      expect(sent).toEqual([
        {
          label: '8 weeks',
          durationCount: 8,
          durationUnit: 'Week',
          priceAmount: 220,
          priceCurrency: 'USD',
          features: ['Training', 'Nutrition', 'CheckIns', 'Messaging'].map((feature) => ({
            feature,
            allowsConcurrentCoverage: false,
          })),
        },
      ]);
    });
  }

  test('a Max option refused for what it includes says the server’s sentence under What’s included', async ({
    page,
  }) => {
    await openPlans(page, 390, true, {
      catalog: houseCatalog(),
      extra: {
        'POST /api/commercial/products/p-max/offers': (route) =>
          json(route, 400, {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: { offer: [LINE] },
          }),
      },
    });
    await page
      .locator('.plans > .cards > .card', { hasText: 'Max coaching' })
      .getByRole('button', { name: 'Add price option' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'New price option' });
    await sheet.getByLabel('Price', { exact: true }).fill('120');
    await sheet.getByRole('button', { name: 'Add price option' }).click();

    await expect(sheet.locator('#plan-features-error')).toHaveText(LINE);
    await expect(sheet.locator('fieldset.features')).toHaveAttribute(
      'aria-describedby',
      'plan-features-max plan-features-error',
    );
    await expect(sheet.getByRole('alert')).toHaveText('Check the fields marked above.');
    await expect(sheet.getByLabel('Price', { exact: true })).toHaveValue('120');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test('any other plan’s boxes stay free beside Max', async ({ page }) => {
    await openPlans(page, 1440, false, { catalog: houseCatalog() });
    await page
      .locator('.plans > .cards > .card', { hasText: 'Online Coaching' })
      .getByRole('button', { name: 'Add price option' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'New price option' });
    await expect(sheet.getByRole('checkbox', { name: 'Resources', exact: true })).toBeEnabled();
    await expect(sheet.locator('#plan-features-max')).toHaveCount(0);
  });
});
