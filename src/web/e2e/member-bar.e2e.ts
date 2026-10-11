import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * The plain top bar of an account with no coaching space (R5.3e): its Sign out and its phone menu are
 * the kit's buttons, drawn on the brand tokens. Every API call is a per-test mock.
 */
async function openBar(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await mockSession(page, {
    user: { ...SIGNED_IN_USER, displayName: 'Hicham Haddad' },
    memberships: [],
  });
  await page.goto('/account/appearance');
  await waitForFonts(page);
  await expect(page.locator('header.topbar')).toBeVisible();
}

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test('on a wide screen Sign out sits in the bar as a kit button', async ({ page }) => {
  await openBar(page, 1440);
  const signOut = page.locator('header.topbar').getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeVisible();
  await expect(signOut).toHaveClass(/tb-button/);
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeHidden();
  await expectNoViolations(page);
  await page.screenshot({ path: 'test-results/r53e-member-bar-1440.png' });
});

test('on a phone the menu opens to Sign out and stays within the screen', async ({ page }) => {
  await openBar(page, 390);
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/tb-button/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoViolations(page);
  await page.screenshot({ path: 'test-results/r53e-member-bar-390.png' });
});

for (const width of [390, 1440]) {
  test(`the dashboard without a coaching space uses the kit and reflows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSession(page, {
      memberships: [],
      user: { ...SIGNED_IN_USER, roles: ['PlatformAdmin'] },
    });
    await page.goto('/');
    await expect(page.locator('app-empty-state')).toContainText(
      'ask your coach to send you a new invitation',
    );
    await expect(
      page.getByRole('link', { name: 'Open platform billing', exact: true }),
    ).toHaveClass(/tb-button/);
    await waitForFonts(page);
    await expectNoViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/r53f-no-space-${width}.png`, fullPage: true });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
  });
}
