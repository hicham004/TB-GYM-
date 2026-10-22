import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
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
 * Settings › Undelivered notices (audit INV-4) in a real browser: the notices TB Gym gave up
 * delivering in the owner's coaching space, each with what it was about, how it went, for whom, why
 * it stopped, when on the workspace's clock and a reference. The far-zone project runs this file with
 * the browser a day ahead of the workspace, so every time here must still read on Beirut's clock.
 */
type Handler = (route: Route) => Promise<void> | void;

const WORKSPACE = {
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-22',
  version: 4,
  brandColor: null,
  accentColor: null,
  logoAssetId: null,
};

function deadLetter(id: string, overrides: Record<string, unknown> = {}) {
  return {
    outboxItemId: `outbox-${id}`,
    channelDeliveryId: id,
    channel: 'Email',
    kind: 'PaymentRequired',
    scheduledAtUtc: '2026-10-12T06:00:00Z',
    attemptCount: 6,
    deadLetteredAtUtc: '2026-10-12T12:12:00Z',
    failureCode: 'notification-attempts-exhausted',
    ...overrides,
  };
}

const NOTICES = [
  deadLetter('01a16213-e736-7ba5-be56-a3b8b5ef1d3e'),
  // 22:30 UTC on Sunday 11 Oct is already Monday in Beirut.
  deadLetter('01a16214-1024-7eae-8baa-3c2f0078a4d0', {
    kind: 'ClientWorkoutNote',
    channel: 'InApp',
    scheduledAtUtc: '2026-10-11T22:30:00Z',
    attemptCount: 1,
    deadLetteredAtUtc: '2026-10-11T22:30:05Z',
    failureCode: 'notification-payload-invalid',
  }),
  deadLetter('01a16215-19d6-7a78-821a-6619ccaadfa0', {
    kind: 'EnrollmentEndingSoon',
    scheduledAtUtc: '2026-10-09T05:00:00Z',
    attemptCount: 1,
    deadLetteredAtUtc: '2026-10-09T05:00:02Z',
    failureCode: 'notification-email-provider-rejected',
  }),
];

const ROWS = [
  [
    'A plan waiting for payment',
    'Email',
    'Tried 6 times without getting through.',
    'For a client · Due Mon 12 Oct, 9:00 AM · Given up Mon 12 Oct, 3:12 PM',
    'Reference 01a16213-e736-7ba5-be56-a3b8b5ef1d3e',
  ],
  [
    'A client’s note on a workout',
    'In the app',
    'TB Gym couldn’t put this notice together.',
    'For you or a coach · Due Mon 12 Oct, 1:30 AM · Given up Mon 12 Oct, 1:30 AM',
    'Reference 01a16214-1024-7eae-8baa-3c2f0078a4d0',
  ],
  [
    'A plan ending soon',
    'Email',
    'The email service refused it.',
    'For a client · Due Fri 9 Oct, 8:00 AM · Given up Fri 9 Oct, 8:00 AM',
    'Reference 01a16215-19d6-7a78-821a-6619ccaadfa0',
  ],
];

async function open(
  page: Page,
  options: {
    width?: number;
    dark?: boolean;
    deadLetters?: Handler;
  } = {},
) {
  // Noon UTC: 3 PM in Beirut and already tomorrow in Kiritimati, the far-zone project's browser.
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  const reads: string[] = [];
  await mockSession(page, {
    extra: {
      'GET /api/workspace': (route) => json(route, 200, WORKSPACE),
      'GET /api/workspace/notification-dead-letters': (route) => {
        reads.push(new URL(route.request().url()).search);
        return options.deadLetters
          ? options.deadLetters(route)
          : json(route, 200, { total: NOTICES.length, items: NOTICES });
      },
    },
  });
  await page.goto('/workspace/undelivered-notices');
  await expect(page.getByRole('heading', { name: 'Undelivered notices', level: 1 })).toBeVisible();
  await waitForFonts(page);
  return reads;
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

const rows = (page: Page) =>
  page
    .locator('.notice')
    .evaluateAll((items) =>
      items.map((item) =>
        ['.about', 'app-status-pill', '.reason', '.facts', '.reference'].map((part) =>
          (item.querySelector(part)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    );

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    test(`lists the notices TB Gym gave up on at ${width}px, ${mode}, on the workspace’s clock`, async ({
      page,
    }) => {
      const reads = await open(page, { width, dark });

      await expect(page.locator('[data-summary]')).toHaveText(
        '3 notices TB Gym gave up on, newest first.',
      );
      await expect(page.locator('.notice')).toHaveCount(3);
      expect(await rows(page)).toEqual(ROWS);
      expect(reads).toEqual(['?skip=0&take=25']);
      // A Settings page of the coaching space's, its link marked where the owner is.
      const nav = page.getByRole('navigation', { name: 'Settings' });
      await expect(nav.getByRole('link', { name: 'Undelivered notices' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`undelivered-${width}-${mode}.png`),
        fullPage: true,
      });
    });
  }

  test(`reads right to left and reflows with 200% text at ${width}px`, async ({ page }) => {
    await open(page, { width });
    await useRtl(page);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.locator('.notice')).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
  });
}

test('says every notice got through while none was given up', async ({ page }) => {
  await open(page, { deadLetters: (route) => json(route, 200, { total: 0, items: [] }) });

  await expect(page.getByRole('heading', { name: 'Every notice got through' })).toBeVisible();
  await expect(page.locator('.notice')).toHaveCount(0);
  await axe(page);
});

test.describe('when the list cannot be read', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 503 .*\/api\/workspace\/notification-dead-letters/],
    },
  });

  test('says the list couldn’t be loaded, and Try again reads it', async ({ page }) => {
    let calls = 0;
    await open(page, {
      deadLetters: (route) =>
        calls++ === 0
          ? json(route, 503, { title: 'Unavailable' })
          : json(route, 200, { total: NOTICES.length, items: NOTICES }),
    });

    await expect(page.getByRole('alert')).toHaveText('Undelivered notices couldn’t be loaded.');
    await axe(page);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.notice')).toHaveCount(3);
  });
});

test('Show more reads the next page and focuses the first notice the last page brought', async ({
  page,
}) => {
  const first = Array.from({ length: 25 }, (_, index) =>
    deadLetter(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  );
  const reads = await open(page, {
    deadLetters: (route) =>
      new URL(route.request().url()).searchParams.get('skip') === '0'
        ? json(route, 200, { total: 26, items: first })
        : json(route, 200, {
            total: 26,
            items: [deadLetter('00000000-0000-4000-8000-000000000026', { channel: 'InApp' })],
          }),
  });
  await expect(page.locator('.notice')).toHaveCount(25);

  await page.getByRole('button', { name: 'Show more notices' }).click();

  await expect(page.locator('.notice')).toHaveCount(26);
  expect(reads).toEqual(['?skip=0&take=25', '?skip=25&take=25']);
  await expect(page.getByRole('button', { name: 'Show more notices' })).toHaveCount(0);
  await expect(page.locator('[data-notice="00000000-0000-4000-8000-000000000026"]')).toBeFocused();
  await axe(page);
});
