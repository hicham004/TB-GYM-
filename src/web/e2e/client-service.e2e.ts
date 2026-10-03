import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { ClientCommercialOverview, ClientEnrollment } from '../src/app/core/api/api.models';
import {
  cancelledPlan,
  catalog,
  enrollment,
  plansOverview,
  unpaidRenewal,
} from '../src/testing/client-service-fixtures';
import { COACH_NOW, LEA_ID, MAYA, OWNER_ID } from '../src/testing/coach-today-fixtures';
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
 * A client's Service & access (R3.4b) in a real browser: Karim, owner of Atlas Performance, on Thu 1
 * Oct 2026, looking after Maya Fakhoury's plans. The page clock is pinned and every read the page
 * makes is answered, so the console guard stays meaningful.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };
const ID = MAYA.clientProfileId;

const clientDetails = {
  id: ID,
  userId: '00000000-0000-4000-8000-0000000000b1',
  firstName: 'Maya',
  lastName: 'Fakhoury',
  email: 'maya.fakhoury@mail.example',
  phoneNumber: null,
  birthDate: null,
  heightCentimeters: 166,
  heightEnteredValue: 166,
  heightEnteredUnit: 'Centimetre',
  workType: null,
  averageDailySteps: null,
  trainingBackground: null,
  foodPreferences: null,
  foodAversions: null,
  goals: 'Lose 6 kg and feel strong for my wedding in December.',
  allergies: null,
  medications: null,
  previousInjuries: null,
  coachNotes: null,
  onboardingStatus: 'Completed',
  onboardingCompletedAtUtc: '2026-07-14T09:00:00Z',
  isCoachBlocked: false,
  version: 3,
  assignedCoachUserId: LEA_ID,
  assignedCoachName: 'Lea Khoury',
  release: null,
};

const workspace = {
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-01',
  version: 1,
};

const team = [
  { userId: OWNER_ID, displayName: 'Karim Haddad', email: 'karim@atlas.example', role: 'Owner' },
  { userId: LEA_ID, displayName: 'Lea Khoury', email: 'lea@atlas.example', role: 'Coach' },
].map((member) => ({
  ...member,
  assignedClientCount: 4,
  joinedAtUtc: '2026-07-01T09:00:00Z',
  version: 1,
}));

/** Maya's 12 weeks end in 11 days with nothing after them. */
const ENDING = plansOverview([cancelledPlan(), enrollment()]);
const WITH_RENEWAL = plansOverview([cancelledPlan(), enrollment(), unpaidRenewal()]);

type Handlers = Record<string, (route: Route) => unknown>;

interface OpenOptions {
  plans?: ClientCommercialOverview[];
  profile?: Record<string, unknown>;
  asked?: boolean;
  extra?: Handlers;
  requests?: { method: string; path: string; body: unknown }[];
}

async function openService(page: Page, width: number, height: number, options: OpenOptions = {}) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  const plans = options.plans ?? [ENDING];
  let reads = 0;
  const handlers: Handlers = {
    [`GET /api/clients/${ID}`]: (route) =>
      json(route, 200, { ...clientDetails, ...options.profile }),
    [`GET /api/commercial/clients/${ID}`]: (route) =>
      json(route, 200, plans[Math.min(reads++, plans.length - 1)]),
    'GET /api/workspace': (route) => json(route, 200, workspace),
    'GET /api/commercial/products': (route) => json(route, 200, catalog()),
    'GET /api/team/members': (route) => json(route, 200, team),
    [`GET /api/clients/${ID}/overview`]: (route) =>
      json(route, 200, {
        attention:
          (options.asked ?? false)
            ? [
                {
                  kind: 'RenewalRequested',
                  client: MAYA,
                  since: '2026-09-28T07:30:00Z',
                  date: '2026-10-12',
                  count: null,
                  weekNumber: null,
                  subjectId: 'e-1',
                },
              ]
            : [],
      }),
    ...options.extra,
  };
  if (options.requests) {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && request.method() !== 'GET') {
        options.requests!.push({
          method: request.method(),
          path: url.pathname,
          body: request.postDataJSON(),
        });
      }
    });
  }
  await mockSession(page, { memberships: [OWNER_MEMBERSHIP], user: owner, extra: handlers });
  await page.goto(`/clients/${ID}/service`);
  await expect(page.getByRole('heading', { level: 1, name: 'Maya Fakhoury' })).toBeVisible();
  await expect(page.locator('.service .panel').first()).toBeVisible();
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

function paid(plan: ClientEnrollment): ClientEnrollment {
  return {
    ...plan,
    storedStatus: 'Active',
    effectiveStatus: 'Upcoming',
    paidAmount: plan.priceAmount,
    balanceAmount: 0,
  };
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Service & access at ${width}px puts the plan in front and passes axe`, async ({ page }) => {
    await openService(page, width, height);

    await expect(page).toHaveTitle('Client service & access | TB Gym');
    await expect(page.locator('.eyebrow')).toHaveText('Current plan');
    await expect(page.locator('#plan-title')).toHaveText('Online Coaching');
    await expect(page.locator('.hero app-status-pill')).toHaveText('Ends in 11 days');
    await expect(page.locator('.facts li')).toHaveText([
      'Tue 21 Jul – Mon 12 Oct',
      '12 weeks · USD 330',
      'Paid in full',
    ]);
    await expect(page.locator('.chips li')).toHaveText([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    // One filled button: what needs the coach now.
    await expect(page.locator('.hero-actions > button')).toHaveText('Renew plan');
    await expect(page.locator('.payment-amount')).toHaveText(['USD 330']);
    await expect(page.locator('.row-name')).toHaveText(['Starter']);
    await expect(page.locator('app-client-coach')).toContainText('Lea Khoury');

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r34b-service-${width}.png`, fullPage: true });
  });
}

test('a plan that ran out says the client asked to renew, and renewing is the one button', async ({
  page,
}) => {
  const ended = enrollment({
    startDate: '2026-07-01',
    endDateExclusive: '2026-09-30',
    lastActiveDate: '2026-09-29',
    effectiveStatus: 'Expired',
  });
  await openService(page, 1440, 900, {
    plans: [plansOverview([cancelledPlan(), ended])],
    asked: true,
  });

  await expect(page.locator('.eyebrow')).toHaveText('Ended Tue 29 Sep');
  await expect(page.locator('.facts li.warm')).toHaveText('Maya asked to renew on Mon 28 Sep');
  await expect(page.locator('.hero-actions > button')).toHaveText('Renew plan');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34b-service-asked-1440.png', fullPage: true });
});

test('the Manage plan menu says why what is not possible is not', async ({ page }) => {
  await openService(page, 1440, 900, { plans: [WITH_RENEWAL] });

  // The renewal waiting for its payment is lined up, so nothing about the current plan needs Karim.
  await expect(page.locator('.hero-actions > button')).toHaveCount(0);
  await page.locator('.row', { hasText: 'Waiting for payment' }).click();
  await expect(page.locator('.eyebrow')).toHaveText('Starts Tue 13 Oct');
  await expect(page.locator('.hero-actions > button')).toHaveText('Record payment');

  const menu = page.getByRole('button', { name: 'Manage plan' });
  await menu.focus();
  await page.keyboard.press('Enter');
  const items = page.locator('.hero-actions button.item');
  await expect(items.locator('.item-title')).toHaveText([
    'Renew plan',
    'Pause plan',
    'Cancel plan',
    'Start another plan',
  ]);
  await expect(items.nth(1)).toHaveAttribute('aria-disabled', 'true');
  await expect(items.nth(1)).toContainText('Possible once it is paid');
  await axe(page);
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

for (const width of [390, 1440]) {
  test(`recording a payment at ${width}px sends it in the plan’s currency`, async ({ page }) => {
    const requests: { method: string; path: string; body: unknown }[] = [];
    const afterPayment = plansOverview([cancelledPlan(), enrollment(), paid(unpaidRenewal())]);
    await openService(page, width, 900, {
      // The header and the page each read the plans once; the page reads them again after paying.
      plans: [WITH_RENEWAL, WITH_RENEWAL, afterPayment],
      requests,
      extra: {
        'POST /api/commercial/enrollments/e-2/payments': (route) =>
          json(route, 200, paid(unpaidRenewal())),
      },
    });

    await page.locator('.row', { hasText: 'Waiting for payment' }).click();
    await page.locator('.hero-actions > button', { hasText: 'Record payment' }).click();
    const sheet = page.getByRole('dialog', { name: 'Record payment' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Amount received')).toHaveValue('180');
    await expect(sheet).toContainText(
      'This pays the plan in full. Maya gets access from Tue 13 Oct.',
    );
    await sheet.getByLabel('How it was paid').selectOption('MobileWallet');
    await sheet.getByLabel('Reference (optional)').fill('WH-2290');
    await axe(page);
    await page.screenshot({ path: `test-results/r34b-payment-${width}.png` });

    await sheet.getByRole('button', { name: 'Record payment' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('.page-notice')).toHaveText('The payment is recorded.');
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/commercial/enrollments/e-2/payments',
        body: expect.objectContaining({
          amount: 180,
          currencyCode: 'USD',
          method: 'MobileWallet',
          reference: 'WH-2290',
          idempotencyKey: expect.any(String),
        }),
      },
    ]);
    await expect(page.locator('.hero app-status-pill')).toHaveText('Starts in 12 days');
  });
}

test('renewing opens on the plan’s own price option, the day after it ends', async ({ page }) => {
  await openService(page, 1440, 900);

  await page.locator('.hero-actions > button', { hasText: 'Renew plan' }).click();
  const sheet = page.getByRole('dialog', { name: 'Renew plan' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('input[value="o-12"]')).toBeChecked();
  await expect(sheet.getByLabel('First day')).toHaveValue('2026-10-13');
  await expect(sheet.locator('.run')).toHaveText('Runs Tue 13 Oct 2026 – Mon 4 Jan 2027');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34b-renew-1440.png' });
});

test('Service & access follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openService(page, 1440, 900, { plans: [WITH_RENEWAL] });

  await axe(page);
  await page.screenshot({ path: 'test-results/r34b-service-dark-1440.png', fullPage: true });
});

test('a former client’s plans read the same, with nothing to change', async ({ page }) => {
  await openService(page, 1440, 900, {
    profile: {
      release: {
        releasedAtUtc: '2026-09-20T10:00:00Z',
        reason: 'Moved abroad',
        releasedByName: 'Karim Haddad',
        departureKind: 'ReleasedByOwner',
      },
    },
  });

  await expect(page.locator('.former')).toContainText('This is a former client.');
  await expect(page.locator('#plan-title')).toHaveText('Online Coaching');
  await expect(page.locator('.hero-actions button')).toHaveCount(0);
  await expect(page.locator('#access-title')).toHaveCount(0);
  await axe(page);
});

test('Service & access reads right to left', async ({ page }) => {
  await openService(page, 1440, 900, { plans: [WITH_RENEWAL] });
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
});

for (const width of [390, 1440]) {
  test(`Service & access reflows at 200% text at ${width}px`, async ({ page }) => {
    await openService(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Manage plan' })).toBeVisible();
    await expect(page.locator('.hero-actions > button')).toBeVisible();
  });
}
