import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachTodayView } from '../src/app/core/api/generated';
import {
  attentionItem,
  COACH_NOW,
  coachMonth,
  coachTodayView,
  emptyCoachTodayView,
  LYNN,
  MAYA,
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
      '7 clients have something for you today, listed under Needs you.',
    );
    const rows = page.locator('li.need');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText('Maya Fakhoury sent a check-in');
    await expect(page.getByRole('link', { name: 'Review for Maya Fakhoury' })).toHaveAttribute(
      'href',
      '/clients/c-maya/checkins/a-maya',
    );
    await expect(page.getByRole('link', { name: 'Reply for Sara Mansour' })).toHaveAttribute(
      'href',
      '/messages?conversation=conv-sara',
    );
    // This month: each currency on its own line, never added together (critique B4b, SUB-016).
    await expect(page.locator('section.month .money-line')).toHaveText([
      /LBP 4,500,000\s*1 payment/,
      /USD 2,340\s*7 payments/,
    ]);
    await expect(
      page.getByRole('link', { name: 'Renew for Rita Daher', exact: true }),
    ).toHaveAttribute('href', '/clients/c-rita/service?renew=e-rita');
    await expect(
      page.getByRole('button', { name: 'End coaching with Elie Azar', exact: true }),
    ).toBeVisible();
    if (width < 768) {
      // On a phone the feed sits under Needs you, folded with its count.
      const fold = page.locator('app-disclosure.feed-fold summary');
      await expect(fold).toContainText('What your clients did');
      await fold.click();
    }
    await expect(page.locator('li.event').first()).toContainText(
      'Rami Tabet finished Lower A in 58 min',
    );
    await expect(page.locator('li.event').first()).toContainText('35 minutes ago');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r32-coach-today-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Coach Today at ${width}px says when sessions run out, and how many were held`, async ({
    page,
  }) => {
    await openToday(
      page,
      width,
      height,
      coachTodayView({
        attention: [
          attentionItem('SessionsRunningOut', MAYA, {
            sessionsLeft: 2,
            date: '2026-10-29',
            subjectId: 'pack-maya',
          }),
        ],
        month: coachMonth({ sessionsHeld: 12 }),
      }),
    );

    const item = page.locator('li.need');
    await expect(item).toContainText('Maya Fakhoury has 2 sessions left');
    await expect(item).toContainText('Last day Thu 29 Oct');
    await expect(page.getByRole('link', { name: 'Renew pack for Maya Fakhoury' })).toHaveAttribute(
      'href',
      '/clients/c-maya/service?renew=pack-maya',
    );
    const held = page.locator('.month-part').filter({ hasText: '1-on-1 sessions held' });
    await expect(held.locator('.month-value')).toHaveText('12');
    await expect(held).toContainText('Held by your coaching space');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b10c-coach-today-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Coach Today at ${width}px puts weights to apply last, dark and light (N6d)`, async ({
    page,
  }) => {
    // Maya did every set of three step lifts, and one of Lynn's two weights keeps last time's: the
    // coach's weekly homework, after everything else, each opening the client's Weights to apply.
    const view = coachTodayView();
    const attention = [
      ...view.attention,
      attentionItem('WeightsToApply', MAYA, { count: 3, stepUps: 3, date: '2026-10-02' }),
      attentionItem('WeightsToApply', LYNN, { count: 2, stepUps: 1, date: '2026-10-06' }),
    ];
    await page.emulateMedia({ colorScheme: 'dark' });
    await openToday(page, width, height, { ...view, attention });

    const rows = page.locator('li.need');
    await expect(rows).toHaveCount(9);
    const maya = rows.nth(7);
    await expect(maya).toContainText('Maya Fakhoury has 3 lifts ready to step up');
    await expect(maya).toContainText('Next workout tomorrow');
    await expect(maya.locator('.tag')).toHaveText('Weights');
    await expect(
      maya.getByRole('link', { name: 'Review weights for Maya Fakhoury' }),
    ).toHaveAttribute('href', '/clients/c-maya/training?action=weights');
    const lynn = rows.nth(8);
    await expect(lynn).toContainText('Lynn Bou Khalil has 2 weights to apply');
    await expect(lynn).toContainText('Next workout Tue 6 Oct');
    await expect(
      lynn.getByRole('link', { name: 'Review weights for Lynn Bou Khalil' }),
    ).toHaveAttribute('href', '/clients/c-lynn/training?action=weights');
    await lynn.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n6d-coach-today-dark-${width}.png` });

    await page.emulateMedia({ colorScheme: 'light' });
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n6d-coach-today-${width}.png` });
  });
}

test('Coach Today at 390px names no maxes to review, dark and light (N10a)', async ({ page }) => {
  // Lynn's last program is over, so No program says she has none running and when she joined. No
  // row says that logged sets suggest a max or offers to review one (decision 19's note, 7 Nov 2026).
  const view = coachTodayView();
  const attention = view.attention.map((item) =>
    item.kind === 'NoProgram' ? { ...item, date: '2026-03-01', subjectId: 'block-ended' } : item,
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await openToday(page, 390, 844, { ...view, attention });

  const rows = page.locator('li.need');
  await expect(rows).toHaveCount(7);
  const between = rows.last();
  await expect(between).toContainText('Lynn Bou Khalil has no program running');
  await expect(between).toContainText('Joined Sun 1 Mar');
  await expect(between.locator('.tag')).toHaveText('Program');
  await expect(
    between.getByRole('link', { name: 'Assign program for Lynn Bou Khalil' }),
  ).toHaveAttribute('href', '/clients/c-lynn/training?action=assign');
  await expect(rows.locator('.tag').filter({ hasText: 'Maxes' })).toHaveCount(0);
  await expect(page.locator('a[href*="action=maxes"]')).toHaveCount(0);
  await expect(page.getByText(/suggest|review maxes/i)).toHaveCount(0);
  await between.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n10a-coach-today-dark-390.png' });

  await page.emulateMedia({ colorScheme: 'light' });
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n10a-coach-today-390.png' });
});

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

/** A colour token resolved where the footers sit, in the mode shown. */
async function inkOf(page: Page, token: string): Promise<string> {
  return page.locator('section.queue').evaluate((section, name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    section.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test('the three footers read as links in the link ink, light and dark (notes plan N5)', async ({
  page,
}) => {
  // Decision 19, option 4E: underlined in the link ink, the stronger ink on hover, never a fill.
  const base = coachTodayView();
  const activity = Array.from({ length: 9 }, (_, index) => ({
    ...base.activity[2],
    subjectId: `w-${index}`,
  }));
  await openToday(page, 1440, 900, coachTodayView({ activity }));
  const help = page.locator('.queue-foot').getByRole('button', { name: 'How these statuses work' });
  const footers = [
    help,
    page.getByRole('link', { name: 'See this month and last' }),
    page.getByRole('button', { name: 'Show all 9' }),
  ];
  const clear = 'rgba(0, 0, 0, 0)';

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('section.queue')).toHaveCSS(
      'background-color',
      colorScheme === 'dark' ? 'rgb(22, 30, 27)' : 'rgb(255, 255, 255)',
    );
    const ink = await inkOf(page, '--tb-accent-ink');
    const strong = await inkOf(page, '--tb-accent-ink-strong');
    expect(ink).not.toBe(strong);
    for (const footer of footers) {
      await expect(footer).toHaveCSS('text-decoration-line', 'underline');
      await expect(footer).toHaveCSS('color', ink);
      await expect(footer).toHaveCSS('background-color', clear);
      await footer.hover();
      await expect(footer).toHaveCSS('color', strong);
      await expect(footer).toHaveCSS('background-color', clear);
      await page.mouse.move(0, 0);
    }
  }

  // Pressed, the help takes no fill either; let go elsewhere, so nothing opens.
  await help.hover();
  await page.mouse.down();
  await expect(help).toHaveCSS('background-color', clear);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The ⓘ on the help alone, before its words and outside its name.
  await expect(help.locator('app-icon')).toHaveAttribute('aria-hidden', 'true');
  const [glyph, words] = await Promise.all([
    help.locator('app-icon').boundingBox(),
    help.locator('span').boundingBox(),
  ]);
  expect(glyph!.x + glyph!.width).toBeLessThanOrEqual(words!.x);
  for (const footer of footers.slice(1)) await expect(footer.locator('app-icon')).toHaveCount(0);
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
  await expect(page.locator('section.month')).toHaveCount(0);
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
