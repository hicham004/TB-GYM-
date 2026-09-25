import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

/**
 * Visual guard for sign-in and coach registration, the two signed-out routes a visitor reaches from
 * the homepage. Both were migrated to the signed-out redesign (the shared `app-auth-frame`, the
 * homepage brand and the design-system form primitives), and these baselines were captured from
 * that design after inspection. Update a baseline only after inspecting the new image.
 *
 * `auth.e2e.ts` covers every signed-out screen's states, keyboard focus and accessibility; this file
 * keeps the pixel comparison for the two routes that have always had one.
 */
const ROUTES: {
  name: string;
  path: string;
  ready: string;
  arrange: (page: Page) => Promise<void>;
}[] = [
  { name: 'sign-in', path: '/auth/sign-in', ready: 'h1', arrange: mockSignedOut },
  { name: 'coach-registration', path: '/auth/register', ready: 'h1', arrange: mockSignedOut },
];

async function open(page: Page, route: (typeof ROUTES)[number]): Promise<void> {
  await route.arrange(page);
  await page.goto(route.path);
  await expect(page.locator(route.ready).first()).toBeVisible();
  await waitForFonts(page);
  await page.evaluate(() => document.fonts.load('italic 400 14px "TB Home Serif"'));
}

for (const width of [1440, 390]) {
  for (const route of ROUTES) {
    test(`${route.name} at ${width}px matches its baseline`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, route);
      await expect(page).toHaveScreenshot(`${route.name}-${width}.png`, { fullPage: true });
    });
  }
}

/**
 * Enlarged text (200%) on a phone: the page reflows to one column without scrolling sideways, and
 * the way to the other form (registration from sign-in, sign-in from registration) is still one
 * readable link inside the screen.
 */
for (const route of ROUTES) {
  test(`${route.name} reflows at 200% text without scrolling sideways`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, route);
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

    await expectNoHorizontalOverflow(page);
    const other = page.locator(
      route.name === 'sign-in' ? 'a[href="/auth/register"]' : 'a[href="/auth/sign-in"]',
    );
    await expect(other).toBeVisible();
    const box = await other.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
}
