import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The coach's brand (R3.5a) in a real browser: Karim, owner of Atlas Performance, chooses a look and
 * a logo for his clients. Every read the page makes is answered, so the console guard stays
 * meaningful; the logo is a real PNG so the image actually draws.
 */
const owner = { ...SIGNED_IN_USER, displayName: 'Karim Haddad' };
const LOGO = readFileSync(join(__dirname, '..', 'public', 'icons', 'icon-192.png'));

interface Brand {
  brandColor: string | null;
  accentColor: string | null;
  logoAssetId: string | null;
}

const NAVY: Brand = { brandColor: '#15233f', accentColor: '#ffb48c', logoAssetId: 'logo-1' };

const workspace = (brand: Brand, version = 7) => ({
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-04',
  version,
  ...brand,
});

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

async function openBrand(
  page: Page,
  width: number,
  height: number,
  options: {
    saved?: Brand;
    requests?: Recorded[];
    path?: string;
    extra?: Record<string, (route: Route) => unknown>;
  } = {},
) {
  await page.setViewportSize({ width, height });
  let saved = options.saved ?? NAVY;
  let version = 7;
  const logo = (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: LOGO });
  if (options.requests) {
    page.on('request', (request) => {
      const url = new URL(request.url());
      // Logo grants are reads in all but method; the writes are what these checks are about.
      if (
        url.pathname.startsWith('/api/') &&
        request.method() !== 'GET' &&
        !url.pathname.endsWith('/access')
      ) {
        options.requests!.push({
          method: request.method(),
          path: url.pathname,
          body: request.headers()['content-type']?.includes('json') ? request.postDataJSON() : null,
        });
      }
    });
  }
  await mockSession(page, {
    user: owner,
    extra: {
      'GET /api/tenants': (route) => json(route, 200, [{ ...OWNER_MEMBERSHIP, ...saved }]),
      'GET /api/workspace': (route) => json(route, 200, workspace(saved, version)),
      'PUT /api/workspace/brand': (route) => {
        saved = route.request().postDataJSON() as Brand;
        version += 1;
        return json(route, 200, workspace(saved, version));
      },
      'POST /api/media/workspace-logo': (route) =>
        json(route, 200, {
          id: 'logo-2',
          title: 'logo',
          kind: 'Image',
          status: 'Ready',
          version: 1,
        }),
      'POST /api/media/logo-1/access': (route) =>
        json(route, 200, { assetId: 'logo-1', url: '/api/media/logo-1/content' }),
      'POST /api/media/logo-2/access': (route) =>
        json(route, 200, { assetId: 'logo-2', url: '/api/media/logo-2/content' }),
      'GET /api/media/logo-1/content': logo,
      'GET /api/media/logo-2/content': logo,
      ...options.extra,
    },
  });
  await page.goto(options.path ?? '/workspace/brand');
  if (!options.path) {
    await expect(page.getByRole('heading', { level: 2, name: 'Colours' })).toBeVisible();
  }
  await waitForFonts(page);
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

const rootToken = (page: Page, name: string) =>
  page.evaluate((token) => document.documentElement.style.getPropertyValue(token), name);

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Brand at ${width}px opens on the saved look and logo and passes axe`, async ({ page }) => {
    await openBrand(page, width, height);

    await expect(page.locator('input[name="look"][value="navy"]')).toBeChecked();
    await expect(page.locator('.logo-tile img')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save brand' })).toBeDisabled();
    // The whole app wears the saved brand, from the list of workspaces.
    expect(await rootToken(page, '--tb-brand')).toBe('#15233f');
    if (width === 1440) {
      await expect(page.locator('aside .brand-mark img')).toBeVisible();
      await expect(page.locator('aside .brand-name')).toHaveText('Atlas Performance');
    }
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r35a-brand-${width}.png`, fullPage: true });
  });
}

test('a new look shows in the preview first, and in the whole app once saved', async ({ page }) => {
  const requests: Recorded[] = [];
  await openBrand(page, 1440, 900, { requests });

  await page.getByText('Charcoal and orange').click();
  await expect(page.locator('app-brand-preview')).toHaveAttribute('style', /--tb-brand: #221b18/);
  expect(await rootToken(page, '--tb-brand')).toBe('#15233f');

  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(
    page.getByText('Brand saved. Your clients see it the next time they open the app.'),
  ).toBeVisible();
  await expect.poll(() => rootToken(page, '--tb-brand')).toBe('#221b18');
  expect(requests).toEqual([
    {
      method: 'PUT',
      path: '/api/workspace/brand',
      body: { brandColor: '#221b18', accentColor: '#ff8a4c', logoAssetId: 'logo-1', version: 7 },
    },
  ]);
  await expect(page.getByRole('button', { name: 'Save brand' })).toBeDisabled();
});

test('a new logo is uploaded, previewed and saved with the brand', async ({ page }) => {
  const requests: Recorded[] = [];
  await openBrand(page, 1440, 900, { requests });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: LOGO,
  });
  await expect(page.locator('.logo-tile img')).toHaveAttribute('src', '/api/media/logo-2/content');
  await expect(page.locator('app-brand-preview .sidebar img')).toHaveAttribute(
    'src',
    '/api/media/logo-2/content',
  );
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(/Brand saved/)).toBeVisible();

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    'POST /api/media/workspace-logo',
    'PUT /api/workspace/brand',
  ]);
  expect(requests[1].body).toMatchObject({ logoAssetId: 'logo-2' });
  await axe(page);
});

test('own colours say when one is adjusted to read well', async ({ page }) => {
  await openBrand(page, 1440, 900);

  await page.getByText('Your own colours').click();
  await page.getByLabel('Brand colour', { exact: true }).fill('#7fb3ff');
  await expect(page.locator('.note')).toHaveText(
    'Your brand colour is shown a little darker, so white text on it stays easy to read.',
  );
  const accent = page.getByLabel('Accent colour', { exact: true });
  await accent.fill('coral');
  await accent.blur();
  await expect(page.getByText('Enter a colour as six digits, such as #ffb48c.')).toBeVisible();
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByRole('alert')).toHaveText('Check the colours marked above.');
  await expect(accent).toBeFocused();
  await axe(page);
  await page.screenshot({ path: 'test-results/r35a-brand-custom-1440.png', fullPage: true });
});

test('Brand follows dark mode, and its preview starts in it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openBrand(page, 1440, 900);

  await expect(page.locator('app-brand-preview')).toHaveAttribute('data-mode', 'dark');
  await axe(page);
  await page.screenshot({ path: 'test-results/r35a-brand-dark-1440.png', fullPage: true });
});

test('Brand reads right to left', async ({ page }) => {
  await openBrand(page, 1440, 900);
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
});

for (const width of [390, 1440]) {
  test(`Brand reflows at 200% text at ${width}px`, async ({ page }) => {
    await openBrand(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Save brand' })).toBeVisible();
  });
}

test.describe('a TB Gym screen', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 503 .*\/api\/billing/],
    },
  });

  test('keeps TB Gym’s own colours on billing, and the coach’s everywhere else', async ({
    page,
  }) => {
    await openBrand(page, 1440, 900, {
      path: '/billing',
      extra: { 'GET /api/billing': (route) => json(route, 503, { title: 'Unavailable' }) },
    });

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(() => rootToken(page, '--tb-brand')).toBe('');
    await expect(page.locator('aside .brand-name')).toHaveText('Atlas Performance');

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Name and region' })).toBeVisible();
    await expect.poll(() => rootToken(page, '--tb-brand')).toBe('#15233f');
  });
});
