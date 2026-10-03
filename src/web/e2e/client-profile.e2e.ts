import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { ClientProfileOverviewView } from '../src/app/core/api/generated';
import {
  checkInItem,
  personalRecords,
  profileOverview,
  programBlock,
  record,
} from '../src/testing/client-profile-fixtures';
import { attentionItem, COACH_NOW, MAYA, OWNER_ID } from '../src/testing/coach-today-fixtures';
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
 * A client's page (R3.3b) in a real browser: Karim, owner of Atlas Performance, on Thu 1 Oct 2026
 * at 15:00 in Beirut, reading Maya Fakhoury's record. The page clock is pinned so "2 hours ago"
 * stays true. Every read the page makes is answered, so the console guard stays meaningful.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };
const ID = MAYA.clientProfileId;

const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

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
  coachNotes: 'Wedding in mid-December. Loves hip thrusts, hates burpees.',
  onboardingStatus: 'Completed',
  onboardingCompletedAtUtc: '2026-07-14T09:00:00Z',
  isCoachBlocked: false,
  version: 3,
  assignedCoachUserId: MAYA.assignedCoachUserId,
  assignedCoachName: 'Lea Khoury',
  release: null,
};

const commercial = {
  clientProfileId: ID,
  isRelationshipBlocked: false,
  featureAccess: FEATURES.map((feature) => ({
    feature,
    isAllowed: true,
    reason: 'Granted',
    enrollmentId: 'e-1',
    accessibleFrom: '2026-07-21',
    accessibleUntilExclusive: '2026-12-14',
  })),
  enrollments: [
    {
      id: 'e-1',
      productId: 'p-1',
      offerId: 'o-1',
      renewedFromEnrollmentId: null,
      productName: 'Online Coaching',
      offerLabel: '12 weeks',
      priceAmount: 330,
      priceCurrency: 'USD',
      paidAmount: 330,
      balanceAmount: 0,
      startDate: '2026-07-21',
      endDateExclusive: '2026-12-14',
      lastActiveDate: '2026-12-13',
      storedStatus: 'Active',
      effectiveStatus: 'Active',
      statusReason: null,
      features: FEATURES,
      payments: [],
      createdAtUtc: '2026-07-20T09:00:00Z',
      version: 1,
    },
  ],
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

const dashboard = {
  clientProfileId: ID,
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  from: '2026-08-10',
  toExclusive: '2026-10-05',
  windowDayCount: 56,
  displayUnit: 'Kilogram',
  measurementDisplayUnit: 'Centimetre',
  bodyweight: {
    latest: { id: 'weight-1', measurementDate: '2026-10-01' },
    latestDisplayValue: 71.2,
    change: {
      fromDate: '2026-08-12',
      fromValue: 74.8,
      toDate: '2026-10-01',
      toValue: 71.2,
      delta: -3.6,
    },
    weeks: [
      { weekStart: '2026-09-07', displayMean: 72.6, observedDayCount: 6 },
      { weekStart: '2026-09-14', displayMean: 72.2, observedDayCount: 7 },
      { weekStart: '2026-09-21', displayMean: 71.8, observedDayCount: 6 },
      { weekStart: '2026-09-28', displayMean: 71.4, observedDayCount: 4 },
    ],
    trend: { availability: 'Available', latestDisplayEstimate: 71.5 },
    observedDayCount: 40,
  },
  measurements: {
    measurements: [
      {
        measurementType: 'Waist',
        displayUnit: 'Centimetre',
        latestDate: '2026-09-27',
        latestDisplayValue: 73.2,
        change: {
          fromDate: '2026-08-14',
          fromValue: 75.5,
          toDate: '2026-09-27',
          toValue: 73.2,
          delta: -2.3,
        },
        observationCount: 4,
      },
    ],
    observedDayCount: 4,
  },
  photos: { poses: [], photoCount: 0, missingThumbnailCount: 0, previewPhotoCount: 0 },
  nutrition: {
    feature: 'Nutrition',
    availability: 'Available',
    reason: 'Granted',
    context: {
      recentFrom: '2026-09-28',
      recentToExclusive: '2026-10-05',
      recentDayCount: 7,
      recentLoggedDayCount: 6,
      recentCompletedDayCount: 4,
      windowLoggedDayCount: 40,
      windowCompletedDayCount: 30,
      lastLoggedDate: '2026-10-01',
    },
  },
  training: {
    feature: 'Training',
    availability: 'Available',
    reason: 'Granted',
    context: {
      recentDayCount: 7,
      recentCompletedWorkoutCount: 2,
      recentScheduledSessionCount: 5,
      windowCompletedWorkoutCount: 27,
      windowScheduledSessionCount: 30,
      windowInProgressWorkoutCount: 0,
      lastCompletedDate: '2026-09-30',
    },
  },
};

function observation(date: string, kilograms: number) {
  return {
    date,
    observation: {
      id: `weight-${date}`,
      measurementDate: date,
      valueKilograms: kilograms,
      enteredValue: kilograms,
      enteredUnit: 'Kilogram',
      source: 'Client',
      recordedByUserId: ID,
      recordedAtUtc: `${date}T05:00:00Z`,
      status: 'Active',
      version: 1,
    },
    displayValue: kilograms,
    trendEstimate: kilograms + 0.2,
    trendSampleCount: 5,
  };
}

const progress = {
  clientProfileId: ID,
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  from: '2026-08-10',
  toExclusive: '2026-10-05',
  displayUnit: 'Kilogram',
  days: [
    observation('2026-09-08', 72.8),
    observation('2026-09-12', 72.5),
    observation('2026-09-16', 72.3),
    observation('2026-09-20', 72.0),
    observation('2026-09-24', 71.7),
    observation('2026-09-28', 71.5),
    observation('2026-10-01', 71.2),
  ],
  weeks: [
    {
      weekStart: '2026-09-07',
      weekEndExclusive: '2026-09-14',
      meanKilograms: 72.6,
      displayMean: 72.6,
      observedDayCount: 2,
    },
    {
      weekStart: '2026-09-14',
      weekEndExclusive: '2026-09-21',
      meanKilograms: 72.2,
      displayMean: 72.2,
      observedDayCount: 2,
    },
    {
      weekStart: '2026-09-21',
      weekEndExclusive: '2026-09-28',
      meanKilograms: 71.8,
      displayMean: 71.8,
      observedDayCount: 2,
    },
    {
      weekStart: '2026-09-28',
      weekEndExclusive: '2026-10-05',
      meanKilograms: 71.4,
      displayMean: 71.4,
      observedDayCount: 2,
    },
  ],
  trend: {
    availability: 'Available',
    methodKey: 'BodyweightTrendEwma',
    methodVersion: 2,
    timeConstantDays: 10,
    warmupDays: 7,
    minimumSampleCount: 3,
    sampleCount: 7,
    latestEstimateKilograms: 71.5,
    latestDisplayEstimate: 71.5,
  },
};

type Handlers = Record<string, (route: Route) => unknown>;

async function openProfile(
  page: Page,
  width: number,
  height: number,
  options: {
    path?: string;
    overview?: ClientProfileOverviewView;
    details?: Record<string, unknown>;
    requests?: string[];
  } = {},
) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  const reads: Handlers = {
    [`GET /api/clients/${ID}`]: (route) =>
      json(route, 200, { ...clientDetails, ...options.details }),
    [`GET /api/commercial/clients/${ID}`]: (route) => json(route, 200, commercial),
    'GET /api/workspace': (route) => json(route, 200, workspace),
    [`GET /api/clients/${ID}/overview`]: (route) =>
      json(route, 200, options.overview ?? profileOverview()),
    [`GET /api/progress/clients/${ID}/dashboard`]: (route) => json(route, 200, dashboard),
    [`GET /api/progress/clients/${ID}`]: (route) => json(route, 200, progress),
    [`GET /api/progress/clients/${ID}/span`]: (route) =>
      json(route, 200, { firstDate: '2026-08-12', lastDate: '2026-10-01' }),
    [`GET /api/training/clients/${ID}/personal-records`]: (route) =>
      json(
        route,
        200,
        personalRecords([
          record('Back Squat', 5, 60, '2026-09-28'),
          record('Dumbbell Bench Press', 12, 16, '2026-10-01'),
          record('Romanian Deadlift', 8, 62.5, '2026-09-29'),
          record('Overhead Press', 6, 20, '2026-09-30'),
        ]),
      ),
    [`GET /api/training/clients/${ID}/mesocycles`]: (route) => json(route, 200, [programBlock()]),
    [`GET /api/checkins/clients/${ID}/assignments`]: (route) =>
      json(route, 200, {
        clientProfileId: ID,
        total: 2,
        items: [
          checkInItem(
            'last',
            '2026-09-24',
            'Reviewed',
            '2026-09-24T07:00:00Z',
            '2026-09-26T12:00:00Z',
          ),
          checkInItem('next', '2026-10-08', null),
        ],
      }),
  };
  if (options.requests) {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) options.requests!.push(url.pathname);
    });
  }
  await mockSession(page, { memberships: [OWNER_MEMBERSHIP], user: owner, extra: reads });
  await page.goto(options.path ?? `/clients/${ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Maya Fakhoury' })).toBeVisible();
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

const WAITING = profileOverview({
  status: 'NeedsAttention',
  attention: [
    attentionItem('CheckInToReview', MAYA, {
      count: 1,
      since: '2026-10-01T09:00:00Z',
      subjectId: 'assignment-9',
    }),
    attentionItem('UnreadMessages', MAYA, {
      count: 2,
      since: '2026-10-01T08:00:00Z',
      subjectId: 'conversation-4',
    }),
    attentionItem('PlanEndingSoon', MAYA, { date: '2026-10-06', subjectId: 'e-1' }),
  ],
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a client's Overview at ${width}px tells the story and passes axe`, async ({ page }) => {
    await openProfile(page, width, height, { overview: WAITING });

    await expect(page).toHaveTitle('Client overview | TB Gym');
    // The person first: face, name, goal, plan.
    await expect(page.locator('.goal')).toHaveText(
      'Lose 6 kg and feel strong for my wedding in December.',
    );
    await expect(page.locator('app-status-pill').first()).toHaveText('Active · 73 days left');
    await expect(page.getByRole('button', { name: 'Message Maya' })).toBeVisible();

    // What needs the coach comes before anything else, with one filled action.
    const needs = page.locator('.needs');
    await expect(needs.locator('.need-heading')).toHaveText([
      'Check-in ready to review',
      '2 unread messages',
      'Plan ends in 5 days',
    ]);
    await expect(needs.locator('.tb-button--filled')).toHaveCount(1);
    await expect(needs.getByRole('link', { name: 'Reply' })).toHaveAttribute(
      'href',
      '/messages?conversation=conversation-4',
    );

    // Then the week, the weight, the records, the check-in and the notes.
    await expect(page.locator('.week .week-count')).toContainText('2 of 5');
    await expect(page.locator('.strip .day')).toHaveCount(7);
    await expect(page.locator('.weight .figure')).toContainText('71.4');
    await expect(page.locator('.record')).toHaveCount(4);
    await expect(page.locator('.checkin')).toContainText('Next one due Thu 8 Oct');
    await expect(page.locator('.notes')).toContainText('Wedding in mid-December.');

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r33b-profile-${width}.png`, fullPage: true });
  });
}

test('a client with nothing waiting says so, rather than leaving an empty list', async ({
  page,
}) => {
  await openProfile(page, 1440, 900);

  await expect(page.locator('.needs')).toContainText('Nothing needs you right now.');
  await expect(page.locator('.needs .need')).toHaveCount(0);
});

test('Actions holds the rest, opens on a key, moves with the arrows and closes on Escape', async ({
  page,
}) => {
  await openProfile(page, 1440, 900);
  const actions = page.getByRole('button', { name: 'Actions' });

  await expect(actions).toHaveAttribute('aria-expanded', 'false');
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(actions).toHaveAttribute('aria-expanded', 'true');
  const items = page.locator('app-client-actions a.item');
  await expect(items).toHaveCount(3);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await axe(page);
  await page.screenshot({ path: 'test-results/r33b-profile-actions-1440.png' });

  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await expect(actions).toBeFocused();

  // An item is a real link to where the work happens.
  await actions.click();
  await expect(page.getByRole('link', { name: /Assign program/ })).toHaveAttribute(
    'href',
    `/clients/${ID}/training`,
  );
  await expect(page.getByRole('link', { name: /Plan and payments/ })).toHaveAttribute(
    'href',
    `/clients/${ID}/service`,
  );
});

test('the Overview and Progress follow dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openProfile(page, 1440, 900, { overview: WAITING });

  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  await axe(page);
  await page.screenshot({ path: 'test-results/r33b-profile-dark-1440.png', fullPage: true });

  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Weight trend' })).toBeVisible();
  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  await waitForFonts(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r33b-progress-dark-1440.png', fullPage: true });
});

test('the Overview reads right to left', async ({ page }) => {
  await openProfile(page, 1440, 900, { overview: WAITING });
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r33b-profile-rtl-1440.png', fullPage: true });
});

for (const width of [390, 1440]) {
  test(`the Overview reflows at 200% text at ${width}px`, async ({ page }) => {
    await openProfile(page, width, 900, { overview: WAITING });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Message Maya' })).toBeVisible();
    await expect(page.locator('.needs .need')).toHaveCount(3);
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Progress at ${width}px reads in the coach’s words, short and without empty days`, async ({
    page,
  }) => {
    const requests: string[] = [];
    await openProfile(page, width, height, { path: `/clients/${ID}/progress`, requests });

    await expect(page).toHaveTitle('Client progress | TB Gym');
    // One page heading (the client's name); the rest are sections.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: 'Weight trend' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Strength records' })).toBeVisible();
    await expect(page.locator('.record-list li')).toHaveCount(4);
    await expect(page.locator('app-trend-chart')).toBeVisible();
    // The client's own wording and self-service links are not here.
    await expect(page.getByText('Your weight trend')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Log weight/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage' })).toHaveCount(0);
    await expect(page.getByText('Maya has no progress photos in this period.')).toBeVisible();

    // The entry tools are one collapsed section, and nothing of them is read until it is opened.
    const entries = page.locator('details.entries');
    await expect(entries).not.toHaveAttribute('open', '');
    await expect(entries.locator('summary')).toContainText('Entries and corrections');
    expect(
      requests.filter((path) => path.endsWith('/measurements') || path.endsWith('/photos')),
    ).toEqual([]);

    // Short: the page used to run to 10,000 px with a row for every empty day.
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(pageHeight).toBeLessThan(width === 390 ? 3600 : 2800);

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r33b-progress-${width}.png`, fullPage: true });
  });
}

test('a former client’s Overview shows how coaching ended and offers nothing to change', async ({
  page,
}) => {
  await openProfile(page, 1440, 900, {
    details: {
      release: {
        releasedAtUtc: '2026-09-20T10:00:00Z',
        reason: 'Moved to Dubai for work.',
        releasedByName: 'Karim Haddad',
        departureKind: 'ReleasedByOwner',
      },
    },
  });

  await expect(page.locator('app-status-pill').first()).toHaveText('Former client');
  await expect(page.getByText('Coaching ended on Sun 20 Sep 2026 by Karim Haddad.')).toBeVisible();
  await expect(page.getByText('Moved to Dubai for work.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Message/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit notes' })).toHaveCount(0);
  await expect(page.locator('app-section-nav a')).toHaveText([
    'Overview',
    'Progress',
    'Service & access',
  ]);
  await axe(page);
});
