import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachTodayView } from '../src/app/core/api/generated';
import {
  COACH_NOW,
  coachTodayView,
  emptyCoachTodayView,
  OWNER_ID,
} from '../src/testing/coach-today-fixtures';
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
 * Coach Today (R3.2) in a real browser: Karim, owner of Atlas Performance, on Thu 1 Oct 2026 at
 * 15:00 in Beirut. The page clock is pinned so "35 minutes ago" stays true.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };

async function openToday(
  page: Page,
  width: number,
  height: number,
  view: CoachTodayView = coachTodayView(),
) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: owner,
    extra: { 'GET /api/coach-today': (route: Route) => json(route, 200, view) },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Karim.');
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
  test(`Coach Today at ${width}px leads with who needs the coach`, async ({ page }) => {
    await openToday(page, width, height);

    await expect(page).toHaveTitle('Today | TB Gym');
    await expect(page.locator('.needs')).toHaveText(
      '7 clients need you today. Everyone else is on track.',
    );
    const rows = page.locator('li.need');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText('Maya Fakhoury sent a check-in');
    await expect(page.getByRole('link', { name: 'Review for Maya Fakhoury' })).toHaveAttribute(
      'href',
      '/clients/c-maya/checkins',
    );
    await expect(page.getByRole('link', { name: 'Reply for Sara Mansour' })).toHaveAttribute(
      'href',
      '/messages?conversation=conv-sara',
    );
    await expect(page.locator('li.event').first()).toContainText(
      'Rami Tabet finished Lower A in 58 min',
    );
    await expect(page.locator('li.event').first()).toContainText('35 minutes ago');
    await expect(page.locator('.bars .bar')).toHaveCount(7);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r32-coach-today-${width}.png`, fullPage: true });
  });
}

test('the sidebar calls the page Today and marks it current', async ({ page }) => {
  await openToday(page, 1440, 900);

  const today = page.locator('.sidebar a[href="/"]');
  await expect(today).toHaveAttribute('aria-current', 'page');
  await expect(today.locator('.label')).toHaveText('Today');
});

test('Coach Today follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openToday(page, 1440, 900);

  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  const surface = await page
    .locator('section.queue')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(surface).toBe('rgb(22, 30, 27)');
  await axe(page);
  await page.screenshot({ path: 'test-results/r32-coach-today-dark-1440.png', fullPage: true });
});

test('an empty coaching space invites the first client instead of showing zeros', async ({
  page,
}) => {
  await openToday(page, 390, 844, emptyCoachTodayView());

  await expect(page.getByText('Your coaching space is ready')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invite your first client' })).toHaveAttribute(
    'href',
    '/invitations',
  );
  await expect(page.locator('app-stat-tile')).toHaveCount(0);
  await axe(page);
});

for (const width of [390, 1440]) {
  test(`Coach Today reflows at 200% text at ${width}px`, async ({ page }) => {
    await openToday(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('link', { name: 'Review for Maya Fakhoury' })).toBeVisible();
  });
}
