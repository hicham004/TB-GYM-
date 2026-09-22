import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test } from './support';

/**
 * Global-style regression guard for routes that have not been migrated to the design-system
 * primitives. The foundation is additive — new tokens, opt-in `.tb-*` classes — so these routes
 * must render pixel-identically to their baselines. The baselines were captured at c18903f, before
 * any foundation code existed. When a route is migrated on purpose, update its baseline only after
 * inspecting the new image.
 *
 * The exercise library was migrated in the coach-shell slice and has its own checks and baselines
 * in `exercises.e2e.ts`; it is no longer one of the unchanged routes.
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

for (const width of [1440, 390]) {
  for (const route of ROUTES) {
    test(`${route.name} at ${width}px is unchanged`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await route.arrange(page);
      await page.goto(route.path);
      await expect(page.locator(route.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${route.name}-${width}.png`, { fullPage: true });
    });
  }
}

/**
 * The signed-out shell used to scroll sideways at 200% text on every route, because "Coach
 * registration" is a `nowrap` button and nothing in the top bar could give way. The page is
 * otherwise unchanged — this is the one defect the coach-shell slice fixed in it.
 */
for (const route of ROUTES) {
  test(`${route.name} reflows at 200% text without scrolling sideways`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await route.arrange(page);
    await page.goto(route.path);
    await expect(page.locator(route.ready).first()).toBeVisible();
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

    await expectNoHorizontalOverflow(page);
    // The registration link is still one control, and still readable.
    const register = page.locator('.public-nav a[href="/auth/register"]');
    await expect(register).toBeVisible();
    const box = await register.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
}
