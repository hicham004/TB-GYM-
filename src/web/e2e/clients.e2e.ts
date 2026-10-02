import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { ClientOverviewView } from '../src/app/core/api/generated';
import { clientListView } from '../src/testing/client-list-fixtures';
import { COACH_NOW, OWNER_ID } from '../src/testing/coach-today-fixtures';
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
 * Clients (R3.3a) in a real browser: Karim, owner of Atlas Performance, on Thu 1 Oct 2026 at 15:00
 * in Beirut, with the twelve clients of the shared fixture. The page clock is pinned so "2 hours
 * ago" stays true.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };

const FORMER = [
  {
    id: 'c-omar',
    firstName: 'Omar',
    lastName: 'Nasr',
    email: 'omar@mail.example',
    releasedAtUtc: '2026-09-20T10:00:00Z',
    reason: 'Moved to Dubai for work.',
    departureKind: 'LeftByClient',
  },
];

async function openClients(
  page: Page,
  width: number,
  height: number,
  options: { url?: string; view?: ClientOverviewView } = {},
) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: owner,
    extra: {
      'GET /api/clients/overview': (route: Route) =>
        json(route, 200, options.view ?? clientListView()),
      'GET /api/clients/former': (route: Route) => json(route, 200, FORMER),
    },
  });
  await page.goto(options.url ?? '/clients');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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

function clientRow(page: Page, name: string) {
  return page.locator('li.client-row').filter({ has: page.getByRole('link', { name }) });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Clients at ${width}px shows how everyone is doing`, async ({ page }) => {
    await openClients(page, width, height);

    await expect(page).toHaveTitle('Clients | TB Gym');
    await expect(page.locator('.lede')).toHaveText('12 clients · 6 need attention');
    await expect(page.locator('li.client-row')).toHaveCount(12);
    const maya = clientRow(page, 'Maya Fakhoury');
    await expect(maya).toContainText('Needs attention');
    await expect(maya).toContainText('Check-in to review');
    await expect(maya).toContainText('Trained 2 hours ago');
    await expect(maya).toContainText('3 of 4');
    await expect(maya).toContainText('Coached by Lea Khoury');
    await expect(clientRow(page, 'Rita Daher').locator('.plan')).toHaveText('Plan ends tomorrow');
    // The column names show only where there are columns.
    await expect(page.locator('.list-head')).toBeVisible({ visible: width >= 1440 });
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r33a-clients-${width}.png`, fullPage: true });
  });
}

test('a tap anywhere on a row opens that client', async ({ page }) => {
  await openClients(page, 390, 844);

  // The name's link covers its row: what sits under the plan line is still that link.
  const plan = clientRow(page, 'Maya Fakhoury').locator('.plan');
  await plan.scrollIntoViewIfNeeded();
  const box = await plan.boundingBox();
  expect(box).not.toBeNull();
  const href = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') ?? null,
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(href).toBe('/clients/c-maya');
});

test('chips and search narrow the list, and the chip stays in the address', async ({ page }) => {
  await openClients(page, 1440, 900);

  await page.getByText('Needs attention', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/clients\?show=attention$/);
  await expect(page.locator('li.client-row')).toHaveCount(6);

  await page.getByRole('searchbox', { name: 'Search clients' }).fill('wedding');
  await expect(page.locator('li.client-row')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('Showing 1 of 12 clients');

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('li.client-row')).toHaveCount(6);
  await expect(page.getByRole('searchbox', { name: 'Search clients' })).toHaveValue('');

  // The chips are one group: arrow keys move between them.
  await page.getByRole('radio', { name: /Needs attention/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Ending soon/ })).toBeChecked();
  await expect(page.locator('li.client-row')).toHaveCount(2);
});

test('Clients follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openClients(page, 1440, 900);

  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  await axe(page);
  await page.screenshot({ path: 'test-results/r33a-clients-dark-1440.png', fullPage: true });
});

test('Clients reads right to left', async ({ page }) => {
  await openClients(page, 1440, 900);
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r33a-clients-rtl-1440.png', fullPage: true });
});

for (const width of [390, 1440]) {
  test(`Clients reflows at 200% text at ${width}px`, async ({ page }) => {
    await openClients(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('link', { name: 'Maya Fakhoury' })).toBeVisible();
  });
}

test('a coach with no clients is invited to add the first one', async ({ page }) => {
  await openClients(page, 390, 844, { view: clientListView({ clients: [] }) });

  await expect(page.getByText('No clients yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invite your first client' })).toHaveAttribute(
    'href',
    '/invitations',
  );
  await expect(page.locator('.chips')).toHaveCount(0);
  await axe(page);
});

test('the owner sees former clients in the same layout', async ({ page }) => {
  await openClients(page, 1440, 900, { url: '/clients/former' });

  await expect(page).toHaveTitle('Former clients | TB Gym');
  await expect(page.getByRole('link', { name: 'Former clients' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const omar = clientRow(page, 'Omar Nasr');
  await expect(omar).toContainText('Left by client · Sun 20 Sep 2026');
  await expect(omar).toContainText('Moved to Dubai for work.');
  await axe(page);
  await page.screenshot({ path: 'test-results/r33a-former-clients-1440.png', fullPage: true });
});
