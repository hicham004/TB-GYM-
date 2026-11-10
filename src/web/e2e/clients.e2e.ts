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

const WORKSPACE = {
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: COACH_NOW.slice(0, 10),
  version: 1,
  brandColor: null,
  accentColor: null,
  logoAssetId: null,
};

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
      // The former list reads each day on the workspace's calendar (audit WEB-17).
      'GET /api/workspace': (route: Route) => json(route, 200, WORKSPACE),
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
    await expect(page.locator('.lede')).toHaveText(
      '12 clients · 6 need attention · 2 plans end soon',
    );
    await expect(page.locator('li.client-row')).toHaveCount(12);
    const maya = clientRow(page, 'Maya Fakhoury');
    // Critique B4a: the reason as a link of its own, beside the plan's own status.
    await expect(
      maya.getByRole('link', { name: 'Maya Fakhoury: 1 check-in to review' }),
    ).toHaveAttribute('href', '/clients/c-maya/checkins/a-maya');
    await expect(maya).toContainText('On track');
    await expect(maya).toContainText('Age 29');
    await expect(maya).toContainText('Trained Lower A · 2 hours ago');
    await expect(maya).toContainText('Sent 18 hours ago');
    await expect(maya).toContainText('3 of 4');
    await expect(maya).toContainText('Coached by Lea Khoury');
    // Critique B4c: the plan's name as it was booked leads its column, or its card's Plan line.
    await expect(maya.locator('.plan-line').first()).toHaveText('Online coaching');
    await expect(clientRow(page, 'Rita Daher').locator('.plan-name')).toHaveText('Postnatal reset');
    await expect(clientRow(page, 'Rita Daher').locator('.plan-end')).toHaveText('Ends tomorrow');
    // The column names show only where there are columns.
    await expect(page.locator('.list-head')).toBeVisible({ visible: width >= 1440 });
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r33a-clients-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Clients at ${width}px says what is left on a pack, warm as it runs out`, async ({
    page,
  }) => {
    const view = clientListView();
    const withPacks: ClientOverviewView = {
      ...view,
      clients: view.clients.map((row) =>
        row.client.firstName === 'Maya'
          ? { ...row, sessionsLeft: 2, attention: [...row.attention, 'SessionsRunningOut'] }
          : row.client.firstName === 'Sara'
            ? { ...row, sessionsLeft: 7 }
            : row,
      ),
    };
    await openClients(page, width, height, { view: withPacks });

    const chip = (name: string) => clientRow(page, name).locator('app-status-pill').last();
    await expect(chip('Maya Fakhoury')).toHaveText('2 sessions left');
    await expect(chip('Maya Fakhoury')).toHaveClass(/warm/);
    await expect(chip('Sara Mansour')).toHaveText('7 sessions left');
    await expect(chip('Sara Mansour')).not.toHaveClass(/warm/);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b10c-clients-${width}.png`, fullPage: true });
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

/** The help's glyph and the lines of its words, as drawn. */
async function helpLayout(page: Page) {
  return page.getByRole('button', { name: 'How these statuses work' }).evaluate((button) => {
    const glyph = button.querySelector('app-icon')!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button.querySelector('span')!);
    const lines = Array.from(range.getClientRects());
    return {
      glyph: { left: glyph.left, right: glyph.right },
      first: { left: lines[0].left, right: lines[0].right },
      lines: new Set(lines.map((line) => Math.round(line.top))).size,
    };
  });
}

test('How these statuses work reads as a link, its ⓘ first either way (notes plan N5)', async ({
  page,
}) => {
  await openClients(page, 1440, 900);
  const help = page.getByRole('button', { name: 'How these statuses work' });
  const ink = await help.evaluate((button) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--tb-accent-ink)';
    button.parentElement!.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

  await expect(help).toHaveCSS('text-decoration-line', 'underline');
  await expect(help).toHaveCSS('color', ink);
  await expect(help).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(help.locator('app-icon')).toHaveAttribute('aria-hidden', 'true');
  const ltr = await helpLayout(page);
  expect(ltr.glyph.right).toBeLessThanOrEqual(ltr.first.left);

  await useRtl(page);
  const rtl = await helpLayout(page);
  expect(rtl.glyph.left).toBeGreaterThanOrEqual(rtl.first.right);
});

test('at 200% text on a phone the help’s words wrap beside its ⓘ (notes plan N5)', async ({
  page,
}) => {
  await openClients(page, 390, 844);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  // The words take two lines and the first starts by the glyph (the kit's 8 px gap), not centred
  // away from it.
  const ltr = await helpLayout(page);
  expect(ltr.lines).toBeGreaterThan(1);
  expect(ltr.first.left - ltr.glyph.right).toBeLessThanOrEqual(12);

  await useRtl(page);
  const rtl = await helpLayout(page);
  expect(rtl.lines).toBeGreaterThan(1);
  expect(rtl.glyph.left - rtl.first.right).toBeLessThanOrEqual(12);
  await expectNoHorizontalOverflow(page);
});

test('a plan’s name reads in its own writing direction, whichever way the page reads', async ({
  page,
}) => {
  const view = clientListView();
  view.clients = view.clients.map((client) =>
    client.client.firstName === 'Rita' && client.plan
      ? { ...client, plan: { ...client.plan, name: 'إعادة تأهيل بعد الولادة' } }
      : client,
  );
  await openClients(page, 1440, 900, { view });

  // The name's own direction, and which edge of its line it starts from: the cell's start edge.
  const reading = (name: string) =>
    clientRow(page, name)
      .locator('.plan-name > bdi')
      .evaluate((text) => {
        const line = text.parentElement!.getBoundingClientRect();
        const box = text.getBoundingClientRect();
        const edge =
          Math.abs(box.left - line.left) < 1
            ? 'left'
            : Math.abs(box.right - line.right) < 1
              ? 'right'
              : 'neither';
        return [getComputedStyle(text).direction, edge];
      });
  expect(await reading('Rita Daher')).toEqual(['rtl', 'left']);
  expect(await reading('Maya Fakhoury')).toEqual(['ltr', 'left']);
  await useRtl(page);
  expect(await reading('Rita Daher')).toEqual(['rtl', 'right']);
  expect(await reading('Maya Fakhoury')).toEqual(['ltr', 'right']);
  await expectNoHorizontalOverflow(page);
});

for (const width of [390, 1440]) {
  test(`Clients reflows at 200% text at ${width}px`, async ({ page }) => {
    await openClients(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    // Exact: since B4a her reason tag is a link too, "Maya Fakhoury: 1 check-in to review".
    await expect(page.getByRole('link', { name: 'Maya Fakhoury', exact: true })).toBeVisible();
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
