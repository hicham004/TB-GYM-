import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { COACH_NOW, emptyCoachTodayView } from '../src/testing/coach-today-fixtures';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  NO_WEBSITE_SETTINGS,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
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
  'GET /api/coach-today': (route: Parameters<typeof json>[0]) =>
    json(route, 200, emptyCoachTodayView()),
};

async function openShell(
  page: Page,
  options: {
    width?: number;
    height?: number;
    rtl?: boolean;
    memberships?: (typeof OWNER_MEMBERSHIP)[];
    user?: typeof SIGNED_IN_USER;
    unreadNotifications?: number;
    unreadMessages?: number;
    /** More answers than the dashboard's, for a test that leaves Today. */
    extra?: Record<string, (route: Route) => Promise<void> | void>;
  } = {},
) {
  // Coach Today greets by the hour, so the clock is pinned for stable screenshots.
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await mockSession(page, {
    memberships: options.memberships,
    user: options.user,
    unreadNotifications: options.unreadNotifications,
    unreadMessages: options.unreadMessages,
    extra: { ...DASHBOARD, ...(options.extra ?? {}) },
  });
  await page.goto('/');
  await expect(page.locator('app-coach-shell')).toBeVisible();
  // The shell shows over the homepage ng serve renders first. Until that leaves, its own Menu button stands
  // beside the shell's, and the navigation still to end would close a menu opened now.
  await expect(page.locator('app-home-header')).toHaveCount(0);
  if (options.rtl) await useRtl(page);
  await waitForFonts(page);
}

const sidebarLinks = (page: Page) => page.locator('.sidebar a.item');

test('the owner sidebar is the locked navigation, in order', async ({ page }) => {
  await openShell(page, { unreadMessages: 1 });

  await expect(sidebarLinks(page)).toHaveText([
    /Today/,
    /Clients/,
    /Training/,
    /Nutrition/,
    /Check-ins/,
    /Messages/,
    /Products/,
    /Team/,
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

test('a coach gets the same shell, with Settings on their own account pages', async ({ page }) => {
  await openShell(page, { memberships: [COACH_MEMBERSHIP] });

  await expect(page.locator('.sidebar a[href="/workspace"]')).toHaveCount(0);
  // Team is the owner's row; a coach opens their read-only Team from Settings.
  await expect(page.locator('.sidebar a[data-destination="team"]')).toHaveCount(0);
  await expect(sidebarLinks(page)).toHaveCount(8);
  await expect(sidebarLinks(page).last()).toHaveAttribute('href', '/notifications/settings');
  await expect(page.locator('.sidebar .identity-role')).toHaveText('Coach');
});

test('the selected destination is marked as the section when another page of it is open', async ({
  page,
}) => {
  await mockSession(page, {
    extra: {
      'GET /api/exercises': (route) => json(route, 200, { total: 0, items: [], patterns: [] }),
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
    await expect(dialog.locator('a.item')).toHaveCount(9);
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
  await expect(page.getByRole('link', { name: 'Password and security' })).toBeVisible();
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
  await expect(overview).toHaveText('Today');
  expect(
    await overview.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expectNoHorizontalOverflow(page);
});

// ---- TB Gym's own pages in the account menu (notes plan N2) ----

const HEADLINE = /Coach both/;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** What the homepage reads at /about: the website's settings, and the form's stamp once it is in view. */
const WEBSITE = {
  'GET /api/website/settings': (route: Route) => json(route, 200, NO_WEBSITE_SETTINGS),
  'GET /api/website/contact-form': (route: Route) => json(route, 200, { stamp: 'e2e-stamp' }),
};

const SIZES = [
  [1440, 900],
  [390, 844],
] as const;

async function openAccountMenu(page: Page) {
  await page.locator('.account-button').click();
  const menu = page.locator('#account-menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** The panel's left and right edges are inside the window. */
async function expectPanelInsideWindow(page: Page, width: number) {
  const box = (await page.locator('#account-menu').boundingBox())!;
  expect(box.x, 'the panel starts outside the window').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'the panel runs past the window').toBeLessThanOrEqual(width);
}

for (const [who, membership] of [
  ['an owner', OWNER_MEMBERSHIP],
  ['a coach', COACH_MEMBERSHIP],
] as const) {
  for (const [width, height] of SIZES) {
    test(`${who}’s account menu at ${width}px has the TB Gym group after Dark mode and before Sign out, with no axe violations`, async ({
      page,
    }, testInfo) => {
      await openShell(page, { width, height, memberships: [membership], extra: WEBSITE });
      const menu = await openAccountMenu(page);

      // Every row and heading of the panel, in reading order.
      await expect(menu.locator('.menu-item, .menu-heading')).toHaveText([
        'Password and security',
        /Dark mode/,
        'TB Gym',
        'TB Gym website',
        'What changed',
        'Sign out',
      ]);
      await expect(menu.locator('#website-menu-heading')).toHaveText('TB Gym');
      // The heading names the group's own list, which holds the two links and nothing else.
      const group = menu.getByRole('list', { name: 'TB Gym', exact: true });
      await expect(group.locator('a, button')).toHaveText(['TB Gym website', 'What changed']);
      await expect(group.getByRole('link', { name: 'TB Gym website' })).toHaveAttribute(
        'href',
        '/about',
      );
      await expect(group.getByRole('link', { name: 'What changed' })).toHaveAttribute(
        'href',
        '/changelog',
      );
      await expect(menu.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });

      await expectNoHorizontalOverflow(page);
      await expectPanelInsideWindow(page, width);
      await page.screenshot({ path: testInfo.outputPath(`n2-account-menu-${width}.png`) });
      const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(
        scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      ).toEqual([]);
    });

    test(`${who} at ${width}px opens the TB Gym website with no shell around it and comes back with Back to Today`, async ({
      page,
    }, testInfo) => {
      await openShell(page, { width, height, memberships: [membership], extra: WEBSITE });
      const menu = await openAccountMenu(page);
      await menu.getByRole('link', { name: 'TB Gym website' }).click();

      await expect(page).toHaveURL('/about');
      await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
      // The page fills the window as a visitor sees it: no sidebar, no top bar, no tabs.
      await expect(page.locator('app-coach-shell')).toHaveCount(0);
      await expect(page.locator('.sidebar')).toHaveCount(0);
      await expect(page.locator('.topbar')).toHaveCount(0);
      await expect(page.locator('app-client-tabs')).toHaveCount(0);
      await expect(page.locator('#account-menu')).toHaveCount(0);
      // One tap during a pitch never opens the sign-up form.
      await expect(page.locator('a[href="/auth/register"]')).toHaveCount(0);
      await expect(page.getByText('Start your coaching space')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`n2-about-${width}.png`) });

      // The way back stands where a visitor's Sign in does: in the header, or in its menu on a phone.
      const header = page.locator('app-home-header');
      let back = header
        .getByRole('navigation', { name: 'Homepage', exact: true })
        .getByRole('link', { name: 'Back to Today' });
      if (width === 390) {
        await expect(back).toBeHidden();
        await header.getByRole('button', { name: 'Menu' }).click();
        back = header.locator('#home-menu').getByRole('link', { name: 'Back to Today' });
      }
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute('href', '/');
      await back.click();

      await expect(page).toHaveURL('/');
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('header.topbar')).toBeVisible();
      if (width === 1440) {
        await expect(page.locator('.sidebar a[href="/"]')).toHaveAttribute('aria-current', 'page');
      }
      await expect(page.locator('app-home-header')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toHaveCount(0);
      await expect(page.locator('#account-menu')).toHaveCount(0);
    });

    test(`${who} at ${width}px opens What changed from the menu inside the coach shell, and a second press only closes the menu`, async ({
      page,
    }) => {
      await openShell(page, { width, height, memberships: [membership], extra: WEBSITE });
      const account = page.locator('.account-button');
      let menu = await openAccountMenu(page);
      await menu.getByRole('link', { name: 'What changed' }).click();

      await expect(page).toHaveURL('/changelog');
      const heading = page.getByRole('heading', { level: 1, name: 'What changed' });
      await expect(heading).toBeVisible();
      await expect(page.locator('.changelog--embedded')).toBeVisible();
      // The app's own shell stays around the page, and the website's header stays out of it.
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('header.topbar')).toBeVisible();
      await expect(page.locator('app-home-header')).toHaveCount(0);
      await expect(menu).toHaveCount(0);
      await expect(account).toHaveAttribute('aria-expanded', 'false');
      // A new page takes focus to its heading, as every navigation in the app does.
      await expect(heading).toBeFocused();

      // On the page already open the press navigates nowhere; the menu still closes.
      menu = await openAccountMenu(page);
      await menu.getByRole('link', { name: 'What changed' }).click();
      await expect(menu).toHaveCount(0);
      await expect(account).toHaveAttribute('aria-expanded', 'false');
      await expect(account).toBeFocused();
      await expect(page).toHaveURL('/changelog');
      await expectNoHorizontalOverflow(page);
    });
  }
}

/**
 * The menu grew by the TB Gym group, and its panel hangs from a bar that stays in place: on a window
 * shorter than its rows it scrolls rather than run past the window's foot. The longest menu there is
 * (the platform admin's) at 200% text, and both menus on a phone held on its side.
 */
const SHORT_WINDOWS = [
  { who: 'a platform admin', admin: true, width: 390, height: 844, text: 200 },
  { who: 'a platform admin', admin: true, width: 375, height: 667, text: 200 },
  { who: 'a platform admin', admin: true, width: 844, height: 390, text: 100 },
  { who: 'an owner', admin: false, width: 844, height: 390, text: 100 },
  { who: 'an owner', admin: false, width: 667, height: 375, text: 100 },
];

for (const { who, admin, width, height, text } of SHORT_WINDOWS) {
  test(`${who}’s account menu at ${width}x${height} and ${text}% text still reaches Sign out`, async ({
    page,
  }, testInfo) => {
    await openShell(page, {
      width,
      height,
      user: { ...SIGNED_IN_USER, roles: admin ? ['PlatformAdmin'] : [] },
      extra: WEBSITE,
    });
    if (text === 200) {
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    }
    const menu = await openAccountMenu(page);
    await expect(menu.locator('.menu-item')).toHaveText([
      'Password and security',
      /Dark mode/,
      'TB Gym website',
      'What changed',
      ...(admin ? ['Platform billing', 'Legal documents', 'Coaches', 'House'] : []),
      'Sign out',
    ]);
    // TB Gym's own coaching space comes last among the admin's pages (notes plan N9a2).
    if (admin) {
      await expect(menu.getByRole('link', { name: 'House', exact: true })).toHaveAttribute(
        'href',
        '/admin/house',
      );
    }
    await expectNoHorizontalOverflow(page);

    // Where Sign out is: as the menu opens, with the page scrolled to its end, and with the panel
    // scrolled to its end. Reached means its whole box is in the window and nothing lies over it.
    const reach = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('#account-menu')!;
      const row = [...panel.querySelectorAll<HTMLElement>('button.menu-item')].at(-1)!;
      const scroller = document.scrollingElement!;
      const where = () => {
        const box = row.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const inside = box.top >= 0 && box.bottom <= innerHeight;
        return {
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          reached: inside && hit !== null && row.contains(hit),
        };
      };
      const edges = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
      };
      const asOpened = where();
      const measured = {
        row: row.textContent!.trim(),
        window: innerHeight,
        bar: edges(document.querySelector('header.topbar')!),
        panel: edges(panel),
        panelOverflow: getComputedStyle(panel).overflowY,
        panelScrolls: panel.scrollHeight - panel.clientHeight,
        pageScrolls: scroller.scrollHeight - scroller.clientHeight,
        asOpened,
      };
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
      const pageAtItsEnd = { scrolled: Math.round(scroller.scrollTop), ...where() };
      scroller.scrollTo({ top: 0, behavior: 'instant' });
      panel.scrollTo({ top: panel.scrollHeight, behavior: 'instant' });
      const panelAtItsEnd = { scrolled: Math.round(panel.scrollTop), ...where() };
      panel.scrollTo({ top: 0, behavior: 'instant' });
      return { ...measured, pageAtItsEnd, panelAtItsEnd };
    });
    // Kept beside the still, so the numbers can be read after a run that passes.
    const name = `n2-menu-${admin ? 'admin' : 'owner'}-${width}x${height}-${text}`;
    const measurements = testInfo.outputPath(`${name}.json`);
    writeFileSync(measurements, JSON.stringify(reach, null, 2));
    await testInfo.attach('Where Sign out is', { path: measurements });
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

    expect(reach.row).toBe('Sign out');
    await expect(menu).toBeVisible();
    expect(
      reach.asOpened.reached || reach.pageAtItsEnd.reached || reach.panelAtItsEnd.reached,
      `Sign out cannot be reached: ${JSON.stringify(reach)}`,
    ).toBe(true);
    // The panel itself ends inside the window, so its last row is never under the window's foot.
    expect(reach.panel.bottom, JSON.stringify(reach)).toBeLessThanOrEqual(reach.window);
  });
}

for (const [width, height] of SIZES) {
  test(`in RTL at ${width}px the open account menu stays inside the window`, async ({
    page,
  }, testInfo) => {
    await openShell(page, { width, height, rtl: true, extra: WEBSITE });
    const menu = await openAccountMenu(page);

    await expect(menu.locator('#website-menu-heading')).toBeVisible();
    await expect(menu.getByRole('link', { name: 'TB Gym website' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'What changed' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
    await expectPanelInsideWindow(page, width);
    // The words of the group's heading and of its rows start on one line, on the right in RTL.
    const starts = await menu
      .locator('#website-menu-heading, .menu-group .menu-item')
      .evaluateAll((items) =>
        items.map((item) => {
          const words = document.createRange();
          words.selectNodeContents(item);
          return Math.round(words.getBoundingClientRect().right);
        }),
      );
    expect(starts).toHaveLength(3);
    expect(new Set(starts).size, `the words start at ${starts.join(', ')}`).toBe(1);
    expect(starts[0]).toBeGreaterThan((await menu.boundingBox())!.x + 128);
    await page.screenshot({ path: testInfo.outputPath(`n2-account-menu-rtl-${width}.png`) });
  });
}
