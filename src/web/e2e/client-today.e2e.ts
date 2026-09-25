import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * The client's layout and Today (Figma 339:2140) in a real browser: every training state, the
 * bottom tabs, keyboard order, 200% text and the automated accessibility scan, at 390px and at
 * desktop width. Every API call is a per-test mock; guards, interceptors and stores run unchanged.
 */
const CLIENT_MEMBERSHIP = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const SECOND_WORKSPACE = {
  ...CLIENT_MEMBERSHIP,
  tenantId: '00000000-0000-4000-8000-000000000004',
  tenantName: 'Beirut Barbell',
  tenantSlug: 'beirut-barbell',
};
const MAYA = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  email: 'maya@example.test',
  displayName: 'Maya Rahman',
};
const TODAY = '2026-09-20';
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'];

const sets = (count: number, done = 0) =>
  Array.from({ length: count }, (_, index) => ({ isCompleted: index < done }));
const strengthB = (overrides: Record<string, unknown> = {}) => ({
  sessionId: '00000000-0000-4000-8000-00000000b001',
  mesocycleId: '00000000-0000-4000-8000-00000000a001',
  workoutExecutionId: null,
  name: 'Upper Body — Strength B',
  coachNotes: 'Top set first. Stop the back-off sets if bar speed drops.',
  status: null,
  exercises: [{ sets: sets(4) }, { sets: sets(3) }, { sets: sets(3) }],
  notes: [],
  executionVersion: null,
  ...overrides,
});
const coverage = (published = true) => ({
  activeBlock: {
    id: 'block',
    name: 'Upper-Body Strength v3',
    weekNumber: 4,
    weekCount: 8,
    isCurrentWeekPublished: published,
  },
  nextBlockStartDate: null,
});
const day = (workouts: unknown[] = [], isAllowed = true, accessReason = 'Granted') => ({
  isAllowed,
  accessReason,
  localDate: TODAY,
  workouts,
});
const upcoming = (overrides: Record<string, unknown> = {}) => ({
  isAllowed: true,
  accessReason: 'Granted',
  localDate: TODAY,
  timeZoneId: 'Asia/Beirut',
  hasAssignedProgram: true,
  hasVisibleSessions: true,
  searchThrough: '2026-12-19',
  nextSession: null,
  unfinishedWorkouts: [],
  nextSkip: null,
  todayCoverage: coverage(),
  ...overrides,
});

/** Each state and the heading it must show. */
const STATES = {
  scheduled: { day: day([strengthB()]), upcoming: upcoming(), heading: 'Upper Body — Strength B' },
  'in progress': {
    day: day([
      strengthB({
        status: 'InProgress',
        workoutExecutionId: 'x',
        exercises: [{ sets: sets(4, 4) }, { sets: sets(3) }, { sets: sets(3) }],
      }),
    ]),
    upcoming: upcoming(),
    heading: 'Upper Body — Strength B',
  },
  completed: {
    day: day([strengthB({ status: 'Completed', workoutExecutionId: 'x' })]),
    upcoming: upcoming(),
    heading: 'Upper Body — Strength B',
  },
  'rest day': {
    day: day(),
    upcoming: upcoming({
      nextSession: { sessionId: 'next', date: '2026-09-22', name: 'Lower Body — Strength A' },
    }),
    heading: 'Rest day',
  },
  'week not shared': {
    day: day(),
    upcoming: upcoming({ todayCoverage: coverage(false) }),
    heading: 'This week’s plan is on its way.',
  },
  'between programs': {
    day: day(),
    upcoming: upcoming({ todayCoverage: { activeBlock: null, nextBlockStartDate: '2026-10-05' } }),
    heading: 'Your next program starts Mon 5 Oct',
  },
  'nothing assigned': {
    day: day(),
    upcoming: upcoming({
      hasAssignedProgram: false,
      todayCoverage: { activeBlock: null, nextBlockStartDate: null },
    }),
    heading: 'Nothing assigned yet',
  },
  'access closed': {
    day: day([], false, 'Paused'),
    upcoming: upcoming(),
    heading: 'Training is not available',
  },
} as const;

const nutritionDay = {
  planId: 'plan',
  planDayId: 'plan-day',
  date: TODAY,
  targetCalories: 2050,
  targetProteinGrams: 120,
  targetCarbohydrateGrams: 230,
  targetFatGrams: 65,
  dailyLogId: 'log',
  dailyLogVersion: 3,
  logStatus: 'InProgress',
  selectedCalories: 900,
  selectedProteinGrams: 60,
  selectedCarbohydrateGrams: 100,
  selectedFatGrams: 30,
  slots: ['Breakfast', 'Lunch', 'Snack', 'Dinner'].map((name, order) => ({
    id: `slot-${order}`,
    name,
    order,
    choices: [],
    selectedChoiceId: order < 2 ? `choice-${order}` : null,
    actualServings: null,
  })),
  safetyNotice: 'General guidance only.',
};
const checkIns = {
  clientProfileId: 'maya',
  total: 1,
  items: [
    {
      assignment: {
        id: 'a',
        formId: 'f',
        formTitle: 'Weekly check-in',
        formVersionId: 'v',
        formVersionNumber: 1,
        clientProfileId: 'maya',
        dueDate: TODAY,
        assignedAtUtc: '2026-09-13T08:00:00Z',
        assignedByUserId: null,
      },
      response: {
        responseId: 'r',
        status: 'Submitted',
        submittedDate: TODAY,
        submittedAtUtc: '2026-09-20T04:12:00Z',
        reviewedAtUtc: null,
        isLate: false,
      },
    },
  ],
};
const conversations = {
  items: [
    {
      id: 'conversation',
      clientProfileId: 'maya',
      counterpart: { userId: 'hicham', displayName: 'Hicham Haddad', role: 'Coach' },
      callerRole: 'Client',
      canModerate: false,
      startedAtUtc: '2026-09-01T08:00:00Z',
      lastActivityAtUtc: '2026-09-20T11:20:00Z',
      lastSequence: 12,
      unreadCount: 1,
      lastReadSequence: 11,
      lastReadAtUtc: '2026-09-19T16:00:00Z',
      isAvailable: true,
      accessReason: 'Granted',
      isReadOnly: false,
      lastMessage: {
        messageId: 'message',
        sequence: 12,
        senderUserId: 'hicham',
        isFromCaller: false,
        sentAtUtc: '2026-09-20T11:20:00Z',
        body: 'Thanks for the detail, Maya, especially about the shoulder. I’m looking at today’s session now and will come back to you within the hour.',
        isDeleted: false,
        deletionKind: null,
      },
    },
  ],
  hasMore: false,
  nextBeforeActivityAtUtc: null,
  nextBeforeConversationId: null,
};

async function openToday(
  page: Page,
  options: {
    state?: keyof typeof STATES;
    width?: number;
    height?: number;
    reasons?: Record<string, string>;
    memberships?: (typeof CLIENT_MEMBERSHIP)[];
    path?: string;
  } = {},
) {
  const state = STATES[options.state ?? 'scheduled'];
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 });
  const decisions = FEATURES.map((feature) => {
    const reason = options.reasons?.[feature] ?? 'Granted';
    return { feature, isAllowed: reason === 'Granted', reason };
  });
  await mockSession(page, {
    memberships: options.memberships ?? [CLIENT_MEMBERSHIP],
    user: MAYA,
    unreadMessages: 1,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/training/me/today': (route: Route) => json(route, 200, state.day),
      'GET /api/training/me/upcoming': (route: Route) => json(route, 200, state.upcoming),
      'GET /api/nutrition/me/day': (route: Route) => json(route, 200, nutritionDay),
      'GET /api/checkins/me/assignments': (route: Route) => json(route, 200, checkIns),
      'GET /api/messaging/conversations': (route: Route) => json(route, 200, conversations),
    },
  });
  await page.goto(options.path ?? '/');
  await expect(page.locator('app-client-tabs')).toBeVisible();
  if ((options.path ?? '/') === '/') {
    await expect(page.locator('#today-training-heading')).toHaveText(state.heading);
    await expect(page.locator('.row-skeleton')).toHaveCount(0);
  }
  await waitForFonts(page);
}

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

test('at 390px Today is the approved screen, with the tabs at the bottom', async ({ page }) => {
  await openToday(page);

  await expect(page).toHaveTitle('Today | TB Gym');
  await expect(page.locator('header.topbar')).toHaveCount(0);
  const tabs = page.locator('app-client-tabs');
  const box = await tabs.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await expect(page).toHaveScreenshot('client-today-390.png', { fullPage: true });
});

test('at 1440px Today keeps one centred column and the tabs stay at the bottom', async ({
  page,
}) => {
  await openToday(page, { width: 1440, height: 900 });

  const column = await page.locator('.today').boundingBox();
  expect(column?.width).toBeLessThanOrEqual(720);
  expect(Math.abs((column?.x ?? 0) * 2 + (column?.width ?? 0) - 1440)).toBeLessThanOrEqual(2);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await expect(page).toHaveScreenshot('client-today-1440.png', { fullPage: true });
});

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  test(`the ${state} state reads correctly and passes the scan at 390px`, async ({ page }) => {
    await openToday(page, { state });

    // Only scheduled, in progress and completed offer a workout action; nothing else is filled.
    const actions = page.locator('.today-card a.today-action');
    await expect(actions).toHaveCount(
      ['scheduled', 'in progress', 'completed'].includes(state) ? 1 : 0,
    );
    await expect(page.locator('.today-card .tb-button--filled')).toHaveCount(
      ['scheduled', 'in progress'].includes(state) ? 1 : 0,
    );
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await expect(page.locator('.today-card')).toHaveScreenshot(
      `client-today-card-${state.replaceAll(' ', '-')}.png`,
    );
  });
}

test('keyboard order runs from the skip link through Today to the tabs', async ({ page }) => {
  await openToday(page);

  // Today's heading takes focus on arrival; the skip link is the one stop before it.
  await expect(page.locator('h1')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('a.skip-link')).toBeFocused();

  const stops: string[] = [];
  for (let index = 0; index < 11; index++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => document.activeElement?.getAttribute('href') ?? ''));
  }
  expect(stops).toEqual([
    '/notifications',
    '/me',
    '/training/today?sessionId=00000000-0000-4000-8000-00000000b001',
    '/nutrition/today',
    '/checkins/me',
    '/messages',
    '/',
    '/training/today',
    '/nutrition/today',
    '/progress/dashboard',
    '/messages',
  ]);
});

test('the skip link appears on focus and moves focus to the page, not to a new URL', async ({
  page,
}) => {
  await openToday(page);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('a.skip-link')).toBeFocused();
  await expect(page.locator('a.skip-link')).toBeInViewport();
  await page.keyboard.press('Enter');

  await expect(page.locator('main#main-content')).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
});

test('200% text scrolls down, never sideways, and the tabs never cover the last part', async ({
  page,
}) => {
  await openToday(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('app-today-coach-message').boundingBox();
  const tabs = await page.locator('app-client-tabs').boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual((tabs?.y ?? 0) + 1);
  await expect(page.locator('app-client-tabs .label').first()).toHaveText('Today');
});

test('a feature outside the plan has no tab and no row', async ({ page }) => {
  await openToday(page, { reasons: { Nutrition: 'NoEntitlement' } });

  await expect(page.locator('app-client-tabs a')).toHaveCount(4);
  await expect(page.locator('a[href="/nutrition/today"]')).toHaveCount(0);
});

test('the Me page switches workspace and signs out, and passes the scan', async ({ page }) => {
  await openToday(page, { memberships: [CLIENT_MEMBERSHIP, SECOND_WORKSPACE], path: '/me' });

  await expect(page.getByRole('heading', { level: 1, name: 'Me' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch to Beirut Barbell/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});
