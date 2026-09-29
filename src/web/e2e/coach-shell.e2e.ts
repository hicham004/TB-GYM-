import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The coach shell in a real browser: the locked sidebar at desktop widths, the navigation dialog
 * below them, keyboard operation of both, and the automated accessibility scan. Every API call is
 * a per-test mock; the application's guards, interceptors and stores run unchanged.
 */
const ACCENT = 'rgb(15, 118, 110)';

const DASHBOARD = {
  'GET /api/clients': (route: Parameters<typeof json>[0]) => json(route, 200, []),
  'GET /api/invitations': (route: Parameters<typeof json>[0]) => json(route, 200, []),
};

async function openShell(
  page: Page,
  options: {
    width?: number;
    height?: number;
    rtl?: boolean;
    memberships?: (typeof OWNER_MEMBERSHIP)[];
    unreadNotifications?: number;
    unreadMessages?: number;
  } = {},
) {
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await mockSession(page, {
    memberships: options.memberships,
    unreadNotifications: options.unreadNotifications,
    unreadMessages: options.unreadMessages,
    extra: DASHBOARD,
  });
  await page.goto('/');
  await expect(page.locator('app-coach-shell')).toBeVisible();
  if (options.rtl) await useRtl(page);
  await waitForFonts(page);
}

const sidebarLinks = (page: Page) => page.locator('.sidebar a.item');

test('the owner sidebar is the locked navigation, in order', async ({ page }) => {
  await openShell(page, { unreadMessages: 1 });

  await expect(sidebarLinks(page)).toHaveText([
    /Overview/,
    /Clients/,
    /Training/,
    /Nutrition/,
    /Check-ins/,
    /Messages/,
    /Products/,
    /Settings/,
  ]);
  // Uppercase is presentation: the text itself stays sentence case so translations can differ.
  await expect(page.locator('.sidebar .group-label')).toHaveText([
    'Coaching',
    'Operations',
    'Business',
  ]);
  expect(
    await page
      .locator('.sidebar .group-label')
      .first()
      .evaluate((e) => getComputedStyle(e).textTransform),
  ).toBe('uppercase');
  // Message unread, on its own destination, stated in words as well as shown.
  await expect(page.locator('.sidebar a[href="/messages"]')).toContainText('1 unread message');
  await expect(page.locator('.sidebar a[href="/messages"] .count')).toHaveText('1');
});

test('a coach gets the same shell without Settings', async ({ page }) => {
  await openShell(page, { memberships: [COACH_MEMBERSHIP] });

  await expect(page.locator('.sidebar a[href="/workspace"]')).toHaveCount(0);
  await expect(sidebarLinks(page)).toHaveCount(7);
  await expect(page.locator('.sidebar .identity-role')).toHaveText('Coach');
});

test('the selected destination is marked as the section when another page of it is open', async ({
  page,
}) => {
  await mockSession(page, {
    extra: {
      'GET /api/exercises': (route) => json(route, 200, { total: 0, items: [] }),
      'GET /api/media': (route) => json(route, 200, { total: 0, skip: 0, take: 100, items: [] }),
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/training/exercises');

  const training = page.locator('.sidebar a[href="/training/programs"]');
  await expect(training).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveCount(0);
});

test('at 1440px the shell has no sideways scroll and no axe violations', async ({ page }) => {
  await openShell(page, { unreadNotifications: 3, unreadMessages: 2 });

  await expectNoHorizontalOverflow(page);
  const scan = await new AxeBuilder({ page })
    .include('app-coach-shell')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual(
    [],
  );
  // The shell host is `display: contents`, so the page is what carries its boxes.
  await expect(page).toHaveScreenshot('coach-shell-1440-ltr.png');
});

test('at 1440px in RTL the sidebar mirrors to the inline end', async ({ page }) => {
  await openShell(page, { rtl: true, unreadNotifications: 3, unreadMessages: 2 });

  await expectNoHorizontalOverflow(page);
  const sidebar = await page.locator('.sidebar').boundingBox();
  expect(sidebar!.x).toBeGreaterThan(1440 / 2);
  // The shell host is `display: contents`, so the page is what carries its boxes.
  await expect(page).toHaveScreenshot('coach-shell-1440-rtl.png');
});

for (const dir of ['ltr', 'rtl'] as const) {
  test(`at 390px ${dir} the navigation opens in a dialog without sideways scroll`, async ({
    page,
  }) => {
    await openShell(page, { width: 390, height: 844, rtl: dir === 'rtl', unreadMessages: 1 });

    await expect(page.locator('.sidebar')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();

    const dialog = page.locator('dialog#coach-navigation-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('a.item')).toHaveCount(8);
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`coach-nav-390-${dir}.png`);

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(
      scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
    ).toEqual([]);
  });
}

test('the navigation dialog opens, traps focus, closes on Escape and gives focus back', async ({
  page,
}) => {
  await openShell(page, { width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');

  const dialog = page.locator('dialog#coach-navigation-dialog');
  await expect(dialog).toBeVisible();
  // The page behind a modal is inert, so tabbing can only reach the dialog. Tabbing past its last
  // control hands focus to the browser's own chrome, where the document reports `body` — that is
  // the platform's behaviour, and what matters is that nothing behind the dialog is ever reached.
  const visited: string[] = [];
  for (let step = 0; step < 15; step++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null || active === document.body) return 'browser';
      return active.closest('dialog') === null
        ? `outside: ${active.tagName}.${active.className}`
        : 'dialog';
    });
    visited.push(where);
  }
  expect(visited.filter((where) => where.startsWith('outside'))).toEqual([]);
  expect(visited).toContain('dialog');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('following a destination in the dialog closes it', async ({ page }) => {
  await openShell(page, { width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('dialog a[href="/clients"]').click();

  await expect(page.locator('dialog#coach-navigation-dialog')).toBeHidden();
});

test('every sidebar row shows the 3px ring, unclipped inside the scrolling region', async ({
  page,
}) => {
  // A short window, so the navigation region is the part that scrolls.
  await openShell(page, { width: 1440, height: 560 });

  const links = sidebarLinks(page);
  const count = await links.count();
  for (let index = 0; index < count; index++) {
    const link = links.nth(index);
    await link.focus();
    const ring = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
        offset: style.outlineOffset,
      };
    });
    expect(ring).toEqual({ outline: 'solid 3px', offset: '2px' });

    // The ring reaches 5px beyond the row and must still be inside the scroll region's box.
    const box = (await link.boundingBox())!;
    const region = (await page.locator('.sidebar .sidebar-nav').boundingBox())!;
    expect(box.y - 5).toBeGreaterThanOrEqual(region.y - 0.5);
    expect(box.y + box.height + 5).toBeLessThanOrEqual(region.y + region.height + 0.5);
  }
  expect(
    await page
      .locator('.sidebar a.item')
      .first()
      .evaluate((element) => {
        element.focus();
        return getComputedStyle(element).outlineColor;
      }),
  ).toBe('rgb(255, 255, 255)');
});

test('brand and identity stay put while the navigation scrolls', async ({ page }) => {
  await openShell(page, { width: 1440, height: 520 });

  const before = await page.locator('.sidebar .identity').boundingBox();
  await page.locator('.sidebar .sidebar-nav').evaluate((element) => element.scrollTo(0, 400));
  const after = await page.locator('.sidebar .identity').boundingBox();
  const brand = await page.locator('.sidebar .brand').boundingBox();

  expect(after!.y).toBeCloseTo(before!.y, 0);
  expect(brand!.y).toBeGreaterThanOrEqual(0);
  expect(
    await page.locator('.sidebar .sidebar-nav').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});

test('the workspace switcher and the account menu are keyboard operable', async ({ page }) => {
  await openShell(page, { memberships: [OWNER_MEMBERSHIP, COACH_MEMBERSHIP] });

  const switcher = page.locator('.workspace-button');
  await switcher.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-menu')).toBeVisible();
  await expect(switcher).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#workspace-menu')).toBeHidden();
  await expect(switcher).toBeFocused();

  const account = page.locator('.account-button');
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#account-menu')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account security' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-menu')).toBeHidden();
  await expect(account).toBeFocused();
});

test('switching workspace closes the menu and lands on the new workspace overview', async ({
  page,
}) => {
  await openShell(page, {
    width: 390,
    height: 844,
    memberships: [OWNER_MEMBERSHIP, COACH_MEMBERSHIP],
  });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('dialog#coach-navigation-dialog')).toBeVisible();

  // Opening the switcher closes the navigation dialog; both belong to the same shell.
  await page.keyboard.press('Escape');
  await page.locator('.workspace-button').click();
  await page.locator('#workspace-menu .menu-item').nth(1).click();

  await expect(page.locator('#workspace-menu')).toBeHidden();
  await expect(page.locator('dialog#coach-navigation-dialog')).toBeHidden();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.workspace-name')).toHaveText('Beirut Barbell');
});

test('200% text keeps the shell usable at 1440px and at 390px', async ({ page }) => {
  await openShell(page, { unreadMessages: 12 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

  await expectNoHorizontalOverflow(page);
  // Labels are still readable rather than all ellipsis.
  const overview = page.locator('.sidebar a[href="/"] .label');
  await expect(overview).toHaveText('Overview');
  expect(
    await overview.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expectNoHorizontalOverflow(page);
});
