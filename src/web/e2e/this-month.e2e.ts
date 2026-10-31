import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachMonthReportView } from '../src/app/core/api/generated';
import {
  coachMonthReport,
  coachOwnMonthReport,
  emptyMonthReport,
} from '../src/testing/month-fixtures';
import { COACH_NOW, coachTodayView, OWNER_ID } from '../src/testing/coach-today-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * This month (critique B10d) in a real browser: Karim, owner of Atlas Performance, and each coach's
 * numbers as a table on a wide window and as cards on a phone, with nothing scrolling sideways.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };

async function openMonth(
  page: Page,
  width: number,
  height: number,
  view: CoachMonthReportView = coachMonthReport(),
) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: owner,
    extra: {
      'GET /api/coach-month': (route: Route) => json(route, 200, view),
      'GET /api/coach-today': (route: Route) => json(route, 200, coachTodayView()),
    },
  });
  await page.goto('/month');
  await expect(page.getByRole('heading', { level: 1, name: 'This month' })).toBeVisible();
  await expect(page.locator('app-skeleton')).toHaveCount(0);
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

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`This month at ${width}px says the month beside the last, with each coach`, async ({
    page,
  }) => {
    await openMonth(page, width, height);

    await expect(page).toHaveTitle('This month | TB Gym');
    await expect(page.locator('.money-line')).toHaveText([
      /EUR 0\s*September: EUR 90\.50/,
      /LBP 4,500,000\s*1 payment\s*Nothing in September/,
      /USD 2,340\s*7 payments\s*September: USD 1,980/,
    ]);
    await expect(page.locator('[data-count="sessions"]')).toContainText('12');
    await expect(page.locator('[data-count="sessions"]')).toContainText('September: 9');

    const table = page.getByRole('table', { name: 'By coach' });
    await expect(table.getByRole('row')).toHaveCount(6);
    await expect(table.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: /Hadi Nasr/ })).toContainText(
      'Left the team',
    );

    // The month switches every row together.
    await page.getByRole('radio', { name: 'September' }).click();
    await expect(table.getByRole('row', { name: /Hadi Nasr/ })).toContainText('EUR 90.50');
    await page.getByRole('radio', { name: 'October so far' }).click();

    await page.getByText('How these are counted').click();
    await expect(page.locator('.how dt').first()).toHaveText('Money received');

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b10d-month-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`This month at ${width}px invites with nothing to count yet`, async ({ page }) => {
    await openMonth(page, width, height, emptyMonthReport());

    await expect(page.getByRole('heading', { name: 'Nothing to count yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Clients' })).toHaveAttribute(
      'href',
      '/clients',
    );
    await expect(page.locator('.numbers')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b10d-month-empty-${width}.png`, fullPage: true });
  });
}

test('This month reflows at 200% text with every number under its own name', async ({ page }) => {
  await openMonth(page, 1440, 900);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  const lea = page.getByRole('row', { name: /Lea Khoury/ });
  await expect(lea).toContainText('USD 1,440');
  const money = await lea.getByRole('cell').first().boundingBox();
  const sessions = await lea.getByRole('cell').nth(1).boundingBox();
  expect(sessions!.y).toBeGreaterThan(money!.y);
  await expectNoHorizontalOverflow(page);
});

test('This month on a coach’s page has no rows of anyone else', async ({ page }) => {
  await openMonth(page, 1440, 900, coachOwnMonthReport());

  await expect(page.locator('.numbers-head')).toContainText('Your numbers');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Omar Saleh')).toHaveCount(0);
});

test('Today’s This month opens the page, under Today in the sidebar', async ({ page }) => {
  await openMonth(page, 1440, 900);
  await page.goto('/');

  await page.getByRole('link', { name: 'See this month and last' }).click();

  await expect(page).toHaveURL(/\/month$/);
  await expect(page.locator('[data-destination="overview"]')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByRole('heading', { level: 1, name: 'This month' })).toBeFocused();
});
