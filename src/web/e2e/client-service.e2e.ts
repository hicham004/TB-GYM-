import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { ClientCommercialOverview, ClientEnrollment } from '../src/app/core/api/api.models';
import type { HousePlanAskView } from '../src/app/core/api/generated';
import {
  cancelledPlan,
  catalog,
  catalogWithPacks,
  enrollment,
  freePlan,
  housePlanAsk,
  houseProPlan,
  plansOverview,
  sessionPack,
  unpaidPack,
  unpaidRenewal,
} from '../src/testing/client-service-fixtures';
import { COACH_NOW, LEA_ID, MAYA, OWNER_ID } from '../src/testing/coach-today-fixtures';
import { chooseDay, chooseOption, kitDateField, kitSelect } from './kit-controls';
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
 * Oct 2026, looking after Maya Fakhoury's plans. Lea Khoury coaches Maya, so Karim reads her record
 * as the server sends it to him: the business side, the private side withheld (N9d1a). The page
 * clock is pinned and every read the page makes is answered, so the console guard stays meaningful.
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
  heightCentimeters: null,
  heightEnteredValue: null,
  heightEnteredUnit: null,
  workType: null,
  averageDailySteps: null,
  trainingBackground: null,
  foodPreferences: null,
  foodAversions: null,
  goals: null,
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
  mayCoach: false,
  release: null,
};

/** Maya waiting for a coach (N9d1b): Lea left the team, so nobody is named and nobody coaches her. */
const WAITING = { assignedCoachUserId: null, assignedCoachName: '', mayCoach: false };

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

/**
 * The server's flag (CLI-018), which Service & access reads and counts no days of its own: a running plan
 * within 14 days of its last day, with the renewals waiting for payment behind it and the first one named.
 */
function endingSoon(view: ClientCommercialOverview) {
  const plan = view.enrollments.find(
    (item) => item.effectiveStatus === 'Active' && item.lastActiveDate === '2026-10-12',
  );
  if (!plan) return [];
  const unpaid = view.enrollments.filter(
    (item) => item.storedStatus === 'PendingPayment' && item.startDate > plan.lastActiveDate,
  );
  return [
    {
      kind: 'PlanEndingSoon',
      client: MAYA,
      since: null,
      date: plan.lastActiveDate,
      count: unpaid.length > 0 ? unpaid.length : null,
      weekNumber: null,
      subjectId: unpaid[0]?.id ?? plan.id,
    },
  ];
}

type Handlers = Record<string, (route: Route) => unknown>;

interface OpenOptions {
  plans?: ClientCommercialOverview[];
  profile?: Record<string, unknown>;
  asked?: boolean;
  extra?: Handlers;
  requests?: { method: string; path: string; body: unknown }[];
  /** The address's query, as Today's and the Overview's links add it: `?action=coach`. */
  query?: string;
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
            : endingSoon(plans[0]),
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
  await page.goto(`/clients/${ID}/service${options.query ?? ''}`);
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

/** Maya's coach history: Lea took her on, then left the team, and she waits for a coach (N9d1b). */
const HISTORY = [
  {
    id: 'h-1',
    sequence: 1,
    coachUserId: LEA_ID,
    coachName: 'Lea Khoury',
    previousCoachUserId: null,
    previousCoachName: null,
    reason: 'Invitation',
    note: null,
    assignedAtUtc: '2026-07-14T09:00:00Z',
    assignedByUserId: null,
  },
  {
    id: 'h-2',
    sequence: 2,
    coachUserId: null,
    coachName: null,
    previousCoachUserId: LEA_ID,
    previousCoachName: 'Lea Khoury',
    reason: 'CoachResigned',
    note: null,
    assignedAtUtc: '2026-09-28T09:00:00Z',
    assignedByUserId: LEA_ID,
  },
];

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Choose a coach from Today opens on arrival at ${width}px, and the owner takes Maya`, async ({
    page,
  }) => {
    const requests: NonNullable<OpenOptions['requests']> = [];
    await openService(page, width, height, {
      profile: WAITING,
      query: '?action=coach',
      requests,
      extra: {
        [`GET /api/clients/${ID}/coach-assignments`]: (route) => json(route, 200, HISTORY),
        [`POST /api/clients/${ID}/coach`]: (route) =>
          json(route, 200, {
            ...clientDetails,
            version: 4,
            assignedCoachUserId: OWNER_ID,
            assignedCoachName: 'Karim Haddad',
            mayCoach: true,
          }),
      },
    });

    const dialog = page.getByRole('dialog', { name: 'Choose a coach for Maya' });
    await expect(dialog).toBeVisible();
    // The arrival is not kept: Back and a reload do not open it again.
    await expect(page).toHaveURL(new RegExp(`/clients/${ID}/service$`));
    // Nobody is chosen for the owner (C8): they pick, themselves included.
    await expect(kitSelect(dialog, 'New coach').locator('button.trigger')).toContainText('Choose…');
    await expect(dialog.locator('#reassign-dialog-change')).toHaveText(
      'The coach you choose sees Maya and all their history right away. Maya is told of the change.',
    );
    await dialog.getByText('Coach history (2)').click();
    await expect(dialog.locator('.history-rows li').first()).toContainText('Waiting for a coach');
    await expect(dialog.locator('.history-rows li').first()).toContainText(
      'Lea Khoury left the team',
    );
    await chooseOption(dialog, 'New coach', 'You');
    await expect(dialog.locator('#reassign-dialog-change')).toHaveText(
      'You become Maya’s coach and see their training, nutrition, check-ins and progress right away. Maya is told of the change.',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n9d2-choose-coach-${width}.png`, fullPage: true });

    await dialog.getByRole('button', { name: 'Choose', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/api/clients/${ID}/coach`,
        body: { coachUserId: OWNER_ID, note: null, version: 3 },
      },
    ]);
    const panel = page.locator('app-client-coach');
    await expect(panel.locator('.coach-notice')).toHaveText('You now coach Maya.');
    await expect(panel.locator('.coach-name')).toHaveText('Karim Haddad');
    await expect(panel.getByRole('button', { name: 'Reassign coach' })).toBeFocused();
  });
}

test('the Reassign dialog says what moving Lea’s client to the owner does', async ({ page }) => {
  await openService(page, 1440, 900, {
    extra: {
      [`GET /api/clients/${ID}/coach-assignments`]: (route) => json(route, 200, [HISTORY[0]]),
    },
  });

  const panel = page.locator('app-client-coach');
  await expect(panel.locator('.coach-name')).toHaveText('Lea Khoury');
  await panel.getByRole('button', { name: 'Reassign coach' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reassign Maya' });
  // The only other member is the owner, as You, chosen already.
  await expect(kitSelect(dialog, 'New coach').locator('button.trigger')).toContainText('You');
  await expect(dialog.locator('#reassign-dialog-change')).toHaveText(
    'You become Maya’s coach and see their training, nutrition, check-ins and progress right away. Lea Khoury loses access, and their chat with Maya stays readable to Maya only. Maya is told of the change.',
  );
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

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
      // The record reads the plans once for the header and the page (audit UIQ-8), and the page
      // reads them again after paying.
      plans: [WITH_RENEWAL, afterPayment],
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
    await chooseOption(sheet, 'How it was paid', 'Mobile wallet');
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
  await expect(kitDateField(sheet, 'First day').locator('button.trigger')).toHaveText(
    'Tue, Oct 13, 2026',
  );
  await expect(sheet.locator('.run')).toHaveText('Runs Tue 13 Oct 2026 – Mon 4 Jan 2027');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34b-renew-1440.png' });
});

test('renewing preserves the earlier plan’s receipt under its own dates', async ({ page }) => {
  await openService(page, 390, 900, {
    plans: [ENDING, WITH_RENEWAL],
    extra: {
      'POST /api/commercial/enrollments/e-1/renew': (route) => json(route, 200, unpaidRenewal()),
    },
  });
  await page.locator('.hero-actions > button', { hasText: 'Renew plan' }).click();
  const sheet = page.getByRole('dialog', { name: 'Renew plan' });
  await sheet.getByRole('button', { name: 'Renew plan' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.payment-context')).toHaveText(
    'Online Coaching · 13 Oct 2026 – 4 Jan 2027',
  );
  await expect(page.locator('.payment-amount')).toHaveText(['USD 150']);
  await page.locator('.row', { hasText: 'Tue 21 Jul – Mon 12 Oct' }).click();
  await expect(page.locator('.payment-context')).toHaveText(
    'Online Coaching · Tue 21 Jul – Mon 12 Oct',
  );
  await expect(page.locator('.payment-amount')).toHaveText(['USD 330']);
  await expectNoHorizontalOverflow(page);
  await axe(page);
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

test.describe('plan date conflicts', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/commercial\//] } });
  for (const width of [390, 1440]) {
    test(`Renew plan names the conflicting purchase at ${width}px`, async ({ page }) => {
      const message =
        'Maya already has Online Coaching from Tue 21 Jul 2026 to Mon 12 Oct 2026. Start on Tue 13 Oct 2026 or later, or cancel that plan first.';
      await openService(page, width, 900, {
        extra: {
          'POST /api/commercial/enrollments/e-1/renew': (route) =>
            json(route, 409, { code: 'entitlement_overlap', message }),
        },
      });
      await page.locator('.hero-actions > button', { hasText: 'Renew plan' }).click();
      const sheet = page.getByRole('dialog', { name: 'Renew plan' });
      await chooseDay(sheet, 'First day', '2026-10-12');
      await sheet.getByRole('button', { name: 'Renew plan', exact: true }).click();
      await expect(sheet.getByRole('alert')).toHaveText(message);
      await expect(sheet).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
    });
  }
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`1-on-1 sessions at ${width}px read a pack, keep its history and pass axe`, async ({
    page,
  }) => {
    await openService(page, width, height, {
      plans: [plansOverview([sessionPack(), enrollment()])],
      extra: {
        'GET /api/commercial/products': (route) => json(route, 200, catalogWithPacks()),
      },
    });

    const section = page.locator('[aria-labelledby="sessions-title"]');
    await expect(page.locator('#plan-title')).toHaveText('Online Coaching');
    await expect(section.locator('.pack-name')).toHaveText('Personal training · 10 sessions');
    await expect(section.locator('.pack-line')).toHaveText(
      '7 of 10 left · until 29 Nov · last held Tue 29 Sep',
    );
    await expect(page.locator('.row-name')).toHaveCount(0);

    await section.locator('summary', { hasText: 'History' }).click();
    await expect(section.locator('.ledger-what')).toHaveText([
      'Undid the session of Wed 30 Sep',
      'Held',
      'Held',
      'Charged · No-show',
      'Held',
      '10 sessions added',
    ]);
    await expect(section.getByRole('button', { name: 'Undo the session of' })).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b10b-sessions-${width}.png`, fullPage: true });
  });

  test(`a plan that ran out beside a running pack is the plan in front at ${width}px (SES-010)`, async ({
    page,
  }) => {
    const ended = enrollment({
      startDate: '2026-07-01',
      endDateExclusive: '2026-09-30',
      lastActiveDate: '2026-09-29',
      effectiveStatus: 'Expired',
    });
    await openService(page, width, height, {
      plans: [plansOverview([sessionPack(), ended])],
      asked: true,
      extra: {
        'GET /api/commercial/products': (route) => json(route, 200, catalogWithPacks()),
      },
    });

    await expect(page.locator('#plan-title')).toHaveText('Online Coaching');
    await expect(page.locator('.eyebrow')).toHaveText('Ended Tue 29 Sep');
    await expect(page.locator('.facts li.warm')).toHaveText('Maya asked to renew on Mon 28 Sep');
    await expect(page.locator('.hero-actions > button')).toHaveText('Renew plan');

    // The pack reads as it always did, under its own heading.
    const section = page.locator('[aria-labelledby="sessions-title"]');
    await expect(section.locator('.pack-line')).toHaveText(
      '7 of 10 left · until 29 Nov · last held Tue 29 Sep',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b13-service-${width}.png`, fullPage: true });
  });

  test(`Record a session at ${width}px takes the money with it and passes axe`, async ({
    page,
  }) => {
    const requests: NonNullable<OpenOptions['requests']> = [];
    const settled = sessionPack(
      { id: 'e-single', offerLabel: 'Single session', priceAmount: 35 },
      { count: 1, left: 0, held: 1, charged: 0, entries: [] },
    );
    await openService(page, width, height, {
      plans: [plansOverview([unpaidPack(), enrollment()]), plansOverview([settled, enrollment()])],
      requests,
      extra: {
        'GET /api/commercial/products': (route) => json(route, 200, catalogWithPacks()),
        [`POST /api/commercial/clients/${ID}/sessions`]: (route) => json(route, 200, settled),
      },
    });

    await page.getByRole('button', { name: 'Record a session' }).click();
    const sheet = page.getByRole('dialog', { name: 'Record a session' });
    await expect(sheet.locator('.target')).toHaveText(
      'Personal training is waiting for USD 35. Saving this records that payment too, received on the day of the session, and the session goes on it.',
    );
    await expect(kitSelect(sheet, 'Who held it').locator('button.trigger')).toContainText(
      'Lea Khoury',
    );
    await chooseOption(sheet, 'Who held it', 'You');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b12-who-held-it-${width}.png`, fullPage: true });

    await sheet.getByRole('button', { name: 'Record session and payment' }).click();
    await expect(sheet).toBeHidden();
    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/api/commercial/clients/${ID}/sessions`,
        body: expect.objectContaining({
          outcome: 'Held',
          receipt: { amount: 35, currencyCode: 'USD', method: 'Cash' },
          heldByUserId: OWNER_ID,
        }),
      },
    ]);
    await expect(page.locator('[aria-labelledby="sessions-title"] .pack-line')).toContainText(
      '0 of 1 left',
    );
  });
}

/**
 * A self-directed trainee of the house (SUB-020, notes plan N9c2): Maya holds the house's Free and has asked
 * for Pro+ Programs, 4 weeks, which she says she sent by Whish. Karim books it or closes the ask from here.
 */
test.describe('a house trainee’s asks for a plan', () => {
  const ASKS = `/api/commercial/clients/${ID}/house-plan-asks`;
  const TRAINEE = plansOverview([freePlan()]);
  const BOOKED = housePlanAsk({
    state: 'Booked',
    outcome: {
      kind: 'Booked',
      decidedOn: '2026-10-01',
      reason: null,
      enrollmentId: 'e-pro',
      planStartDate: '2026-10-01',
      planLastDay: '2026-10-28',
      decidedByName: 'Karim Haddad',
    },
  });
  const REASON = 'No money has come in yet. Ask again once you send it.';
  const CLOSED = housePlanAsk({
    state: 'Closed',
    moneySent: null,
    outcome: {
      kind: 'Closed',
      decidedOn: '2026-10-01',
      reason: REASON,
      enrollmentId: null,
      planStartDate: null,
      planLastDay: null,
      decidedByName: 'Karim Haddad',
    },
  });

  /** The trainee's asks, one answer per read: the page reads them again after a booking or a closing. */
  function asksRead(...reads: HousePlanAskView[][]): Handlers {
    let count = 0;
    return {
      [`GET ${ASKS}`]: (route) => json(route, 200, reads[Math.min(count++, reads.length - 1)]),
    };
  }

  const panel = (page: Page) => page.locator('[aria-labelledby="asks-title"]');

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`booking the plan Maya asked for at ${width}px records its money and says so`, async ({
      page,
    }) => {
      const requests: NonNullable<OpenOptions['requests']> = [];
      await openService(page, width, height, {
        plans: [TRAINEE, plansOverview([freePlan(), houseProPlan()])],
        requests,
        extra: {
          ...asksRead([housePlanAsk()], [BOOKED]),
          [`POST ${ASKS}/ask-1/book`]: (route) => json(route, 200, BOOKED),
        },
      });

      const asks = panel(page);
      await expect(asks.getByRole('heading', { level: 2 })).toHaveText('Asks for a plan');
      await expect(asks.locator('.row-name')).toHaveText(['Pro+ Programs, 4 weeks']);
      await expect(asks.locator('.row-meta')).toHaveText(['USD 47.50 · asked Tue 29 Sep']);
      await expect(asks.locator('app-status-pill')).toHaveText(['Says it’s sent']);
      await expect(asks.locator('[data-sent]')).toHaveText(
        'Sent from Maya Fakhoury, +961 70 123 456 on Wed 30 Sep.',
      );
      await expect(asks.locator('.whish-number')).toHaveAttribute('dir', 'ltr');
      // Book is outlined and Close is a text button: the page keeps its one filled button.
      await expect(asks.locator('button.tb-button--filled')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c2-asks-${width}.png`),
        fullPage: true,
      });

      await asks.getByRole('button', { name: 'Book plan, Pro+ Programs, 4 weeks' }).click();
      const sheet = page.getByRole('dialog', { name: 'Book the plan' });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('.plan-line')).toHaveText('Pro+ Programs, 4 weeks');
      await expect(sheet).toContainText(
        'Check the Whish account for USD 47.50 first. Booking starts Maya’s plan today, or the day after their current plan ends, and records the money as received by Whish today.',
      );
      await expect(sheet.locator('.sent')).toHaveText(
        'Maya says they sent it from Maya Fakhoury, +961 70 123 456 on Wed 30 Sep.',
      );
      await expect(sheet.getByLabel('Amount received')).toHaveValue('47.50');
      await expect(sheet.locator('.unit')).toHaveText('USD');
      await sheet.getByLabel('Reference (optional)').fill('WH-88231');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: test.info().outputPath(`n9c2-book-${width}.png`) });

      await sheet.getByRole('button', { name: 'Book plan' }).click();
      await expect(sheet).toBeHidden();
      await expect(page.locator('.page-notice')).toHaveText(
        'The plan is booked and its payment recorded.',
      );
      expect(requests).toEqual([
        {
          method: 'POST',
          path: `${ASKS}/ask-1/book`,
          body: {
            amount: 47.5,
            currencyCode: 'USD',
            reference: 'WH-88231',
            idempotencyKey: expect.any(String),
          },
        },
      ]);
      await expect(asks.locator('app-status-pill')).toHaveText(['Booked']);
      await expect(asks.locator('[data-decided]')).toHaveText(
        'Booked by Karim Haddad on Thu 1 Oct: runs Thu 1 Oct – Wed 28 Oct.',
      );
      await expect(asks.getByRole('button')).toHaveCount(0);
      // The buttons went with the ask's new state, so focus waits on the asks' heading.
      await expect(page.locator('#asks-title')).toBeFocused();
      await expectNoHorizontalOverflow(page);
    });
  }

  test('closing an ask asks for the reason Maya reads, then keeps the ask as closed', async ({
    page,
  }) => {
    const requests: NonNullable<OpenOptions['requests']> = [];
    await openService(page, 1440, 900, {
      plans: [TRAINEE],
      requests,
      extra: {
        ...asksRead([housePlanAsk({ state: 'Asked', moneySent: null })], [CLOSED]),
        [`POST ${ASKS}/ask-1/close`]: (route) => json(route, 200, CLOSED),
      },
    });

    const asks = panel(page);
    await expect(asks.locator('app-status-pill')).toHaveText(['Waiting for the money']);
    await expect(asks.locator('[data-sent]')).toHaveCount(0);
    await asks.getByRole('button', { name: 'Close ask, Pro+ Programs, 4 weeks' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close this ask' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.plan-line')).toHaveText('Pro+ Programs, 4 weeks');
    await expect(dialog).toContainText(
      'Maya reads this on their plan page. 500 characters at most.',
    );
    // Nothing is sent without a reason: the field says so and takes focus.
    await dialog.getByRole('button', { name: 'Close ask' }).click();
    const reason = dialog.getByLabel('Reason');
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await reason.fill(REASON);
    await axe(page);
    await page.screenshot({ path: test.info().outputPath('n9c2-close-1440.png') });

    await dialog.getByRole('button', { name: 'Close ask' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.page-notice')).toHaveText('The ask is closed.');
    expect(requests).toEqual([
      { method: 'POST', path: `${ASKS}/ask-1/close`, body: { reason: REASON } },
    ]);
    await expect(asks.locator('app-status-pill')).toHaveText(['Closed']);
    await expect(asks.locator('[data-decided]')).toHaveText('Closed by Karim Haddad on Thu 1 Oct.');
    await expect(asks.locator('[data-reason]')).toHaveText(REASON);
    await expect(asks.getByRole('button')).toHaveCount(0);
  });

  test('a booking on its way keeps its sheet open, so its answer is said and the ask shows booked', async ({
    page,
  }) => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    await openService(page, 1440, 900, {
      plans: [TRAINEE, plansOverview([freePlan(), houseProPlan()])],
      extra: {
        ...asksRead([housePlanAsk()], [BOOKED]),
        [`POST ${ASKS}/ask-1/book`]: async (route) => {
          await held;
          await json(route, 200, BOOKED);
        },
      },
    });

    await panel(page).getByRole('button', { name: 'Book plan, Pro+ Programs, 4 weeks' }).click();
    const sheet = page.getByRole('dialog', { name: 'Book the plan' });
    await sheet.getByRole('button', { name: 'Book plan' }).click();
    await expect(sheet.getByRole('button', { name: 'Booking…' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Not now' })).toBeDisabled();
    // Neither Escape nor the sheet's own close button ends it while the booking is on its way.
    await page.keyboard.press('Escape');
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toBeVisible();

    answer();
    await expect(sheet).toBeHidden();
    await expect(page.locator('.page-notice')).toHaveText(
      'The plan is booked and its payment recorded.',
    );
    await expect(panel(page).locator('app-status-pill')).toHaveText(['Booked']);
    await expect(page.locator('#asks-title')).toBeFocused();
  });

  test('a former trainee’s asks read the same, with nothing to change', async ({ page }) => {
    await openService(page, 1440, 900, {
      plans: [TRAINEE],
      profile: {
        release: {
          releasedAtUtc: '2026-09-30T10:00:00Z',
          reason: 'Moved abroad',
          releasedByName: 'Karim Haddad',
          departureKind: 'ReleasedByOwner',
        },
      },
      extra: asksRead([housePlanAsk()]),
    });

    const asks = panel(page);
    await expect(page.locator('.former')).toContainText('This is a former client.');
    await expect(asks.locator('.ask')).toHaveCount(1);
    await expect(asks.locator('app-status-pill')).toHaveText(['Says it’s sent']);
    await expect(asks.getByRole('button')).toHaveCount(0);
    await axe(page);
  });

  test.describe('a refused booking', () => {
    test.use({
      allowedConsoleErrors: { patterns: [/status of 400 .*\/house-plan-asks\//] },
    });

    test('a part of the price is refused under the amount, in the server’s words', async ({
      page,
    }) => {
      const message =
        "Record the plan's exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.";
      await openService(page, 390, 844, {
        plans: [TRAINEE],
        extra: {
          ...asksRead([housePlanAsk()]),
          [`POST ${ASKS}/ask-1/book`]: (route) =>
            json(route, 400, {
              title: 'One or more validation errors occurred.',
              status: 400,
              errors: { amount: [message] },
            }),
        },
      });

      await panel(page).getByRole('button', { name: 'Book plan, Pro+ Programs, 4 weeks' }).click();
      const sheet = page.getByRole('dialog', { name: 'Book the plan' });
      await sheet.getByLabel('Amount received').fill('20');
      await sheet.getByRole('button', { name: 'Book plan' }).click();

      await expect(sheet.getByLabel('Amount received')).toHaveAttribute('aria-invalid', 'true');
      await expect(sheet).toContainText(message);
      await expect(sheet.getByRole('alert')).toHaveText('Check the fields marked above.');
      await expectNoHorizontalOverflow(page);
      await axe(page);
    });
  });
});
