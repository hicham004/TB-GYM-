import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { finishedProfile } from '../src/testing/intake-fixtures';
import { POOL_BENCH_PRESS, POOL_PLANK, poolPage } from '../src/testing/own-workout-fixtures';
import { personFacing } from './axe-target-size';
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
const trainingWeek = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: TODAY,
  weekStart: '2026-09-14',
  days: ['14', '15', '16', '17', '18', '19', '20'].map((date, index) => ({
    date: `2026-09-${date}`,
    scheduled: index === 0 || index === 2 || index === 6 ? 1 : 0,
    completed: index === 0 || index === 2 ? 1 : 0,
  })),
};
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary', 'Sessions'];

/** A pack with seven sessions left (critique B10c), as `GET /api/client-plan/me` answers. */
const PERSONAL_TRAINING = {
  id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Personal training',
  optionLabel: '10 sessions',
  description: null,
  startDate: '2026-09-01',
  lastDay: '2026-11-29',
  cancelledOn: null,
  status: 'Active',
  features: ['Sessions'],
  sessions: { count: 10, left: 7, used: 3, lapsed: 0, lapsedOn: null, sessions: [] },
};

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

const planRunning = {
  planEnded: false,
  endedOn: null,
  coachName: null,
  lastRequest: null,
  canAsk: false,
};
const planEnded = {
  ...planRunning,
  planEnded: true,
  endedOn: '2026-10-04',
  coachName: 'Hicham Haddad',
  canAsk: true,
};
const planEnding = {
  ...planRunning,
  endsOn: '2026-09-23',
  planId: 'plan',
  coachName: 'Hicham Haddad',
  canAsk: true,
};
const renewalAsked = {
  ...planEnded,
  lastRequest: { id: 'request', requestedOn: '2026-10-05', askAgainFrom: '2026-10-12' },
  canAsk: false,
};

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
const coachMessage = {
  messageId: 'message',
  sequence: 12,
  senderUserId: 'hicham',
  isFromCaller: false,
  sentAtUtc: '2026-09-20T11:20:00Z',
  body: 'Thanks for the detail, Maya, especially about the shoulder. I’m looking at today’s session now and will come back to you within the hour.',
  isDeleted: false,
  deletionKind: null,
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
      lastMessage: coachMessage,
      // The coach's newest message, which Today shows whoever spoke last (CLIENT-13).
      latestFromCounterpart: coachMessage,
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
    /** The whole plan has run out (ADR 0029): Today shows the renewal card instead of training. */
    ended?: boolean;
    /** In the plan's last days (critique B14): the card sits under the day's workout. */
    ending?: boolean;
    /** What `GET /api/client-plan/me` answers, for a client with sessions in their plan. */
    plans?: object[];
    /** No coach for now (N9d1b): the coach's read answers 404 after the profile's. */
    waitingForCoach?: boolean;
  } = {},
) {
  const state = options.ended
    ? { day: day([], false, 'Expired'), upcoming: upcoming(), heading: '' }
    : STATES[options.state ?? 'scheduled'];
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 });
  const decisions = FEATURES.map((feature) => {
    const reason =
      options.reasons?.[feature] ?? (feature === 'Sessions' ? 'NoEntitlement' : 'Granted');
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
      'GET /api/training/me/week': (route: Route) => json(route, 200, trainingWeek),
      // The client's own profile comes first: a coach's client is not self-directed (notes plan N9a2).
      'GET /api/client-profile/me': (route: Route) => json(route, 200, finishedProfile()),
      'GET /api/client-profile/me/coach': (route: Route) =>
        options.waitingForCoach
          ? json(route, 404, { title: 'Not Found' })
          : json(route, 200, { name: 'Hicham Haddad' }),
      'GET /api/nutrition/me/day': (route: Route) => json(route, 200, nutritionDay),
      'GET /api/checkins/me/assignments': (route: Route) => json(route, 200, checkIns),
      'GET /api/messaging/conversations': (route: Route) => json(route, 200, conversations),
      'GET /api/client-renewal/me': (route: Route) =>
        json(route, 200, options.ended ? planEnded : options.ending ? planEnding : planRunning),
      'POST /api/client-renewal/me/requests': (route: Route) =>
        json(
          route,
          201,
          options.ending
            ? { ...planEnding, canAsk: false, lastRequest: renewalAsked.lastRequest }
            : renewalAsked,
        ),
      'GET /api/client-plan/me': (route: Route) =>
        json(route, 200, {
          today: '2026-09-20',
          plans: options.plans ?? [],
          coachName: 'Hicham Haddad',
        }),
    },
  });
  await page.goto(options.path ?? '/');
  await expect(page.locator('app-client-tabs')).toBeVisible();
  if (options.ended) {
    await expect(page.locator('#today-renewal-heading')).toBeVisible();
    await expect(page.locator('.row-skeleton')).toHaveCount(0);
    await expect(page.locator('.today-week-skeleton')).toHaveCount(0);
  } else if ((options.path ?? '/') === '/') {
    await expect(page.locator('#today-training-heading')).toHaveText(state.heading);
    await expect(page.locator('.row-skeleton')).toHaveCount(0);
  }
  await waitForFonts(page);
}

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    (await personFacing(page, result.violations)).map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
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
  await expect(page).toHaveScreenshot('client-today-390.png');
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
  await expect(page).toHaveScreenshot('client-today-1440.png');
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

test('an ended plan names the coach, asks once for a renewal and says so', async ({ page }) => {
  await openToday(page, { ended: true });

  const card = page.locator('app-today-renewal .today-card');
  await expect(page.locator('#today-renewal-heading')).toHaveText(
    'Your coaching plan with Hicham Haddad ended on Sun 4 Oct.',
  );
  await expect(page.locator('.today-card a.today-action')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await expect(card).toHaveScreenshot('client-today-card-plan-ended.png');

  const asked = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/api/client-renewal/me/requests'),
  );
  await page.getByRole('button', { name: 'Ask to renew' }).click();
  await asked;
  const sent = page.locator('app-today-renewal [role="status"]');
  await expect(sent).toHaveText(
    'Renewal request sent on Mon 5 Oct. You can ask again from Mon 12 Oct.',
  );
  await expect(sent).toBeFocused();
  await expect(page.getByRole('button', { name: 'Ask to renew' })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await expect(card).toHaveScreenshot('client-today-card-plan-ended-asked.png');
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a plan's last days keep the workout and offer Ask to renew`, async ({
    page,
  }) => {
    await openToday(page, { ending: true, width, height });

    await expect(page.locator('#today-renewal-heading')).toHaveText(
      'Your coaching plan with Hicham ends on Wed 23 Sep.',
    );
    await expect(page.locator('.today-card a.today-action')).toHaveCount(1);
    const workout = await page.locator('.today-card--hero').boundingBox();
    const card = await page.locator('app-today-renewal .today-card').boundingBox();
    expect(card!.y).toBeGreaterThan(workout!.y + workout!.height - 1);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b14-today-ending-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'Ask to renew' }).click();
    await expect(page.locator('app-today-renewal [role="status"]')).toHaveText(
      'Renewal request sent on Mon 5 Oct. You can ask again from Mon 12 Oct.',
    );
    await expect(page.locator('.today-card a.today-action')).toHaveCount(1);
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
    '/training/program',
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

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a client with a pack reads what is left, and it opens My plan`, async ({
    page,
  }) => {
    await openToday(page, {
      width,
      height,
      reasons: { Sessions: 'Granted' },
      plans: [PERSONAL_TRAINING],
    });

    const row = page.getByRole('link', { name: /1-on-1 sessions/ });
    await expect(row).toContainText('7 of 10 sessions with Hicham left, until 29 November');
    await expect(row).toHaveAttribute('href', '/plan');
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b10c-today-${width}.png`, fullPage: true });
  });
}

test('a client with no pack is not asked about, and has no sessions row', async ({ page }) => {
  let asked = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/client-plan/me')) asked += 1;
  });
  await openToday(page);

  await expect(page.locator('a.row[href="/nutrition/today"]')).toBeVisible();
  await expect(page.locator('a[href="/plan"]')).toHaveCount(0);
  expect(asked).toBe(0);
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

/** TB Gym's own coaching space, whose trainees sign up with no coach (notes plan N9a2). */
const HOUSE = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};

/** The id of the workout of one's own the trainee is in the middle of (notes plan N9b3). */
const OWN_WORKOUT_ID = '00000000-0000-4000-8000-0000000000e1';
const ownSet = (id: string, position: number, isCompleted = false) => ({
  performanceId: id,
  position,
  actualRepetitions: isCompleted ? 10 : null,
  actualLoad: isCompleted ? 20 : null,
  actualLoadUnit: isCompleted ? 'Kilogram' : null,
  actualRpe: null,
  actualRir: null,
  isCompleted,
  clientNote: null,
});
const ownExercise = (
  id: string,
  name: string,
  position: number,
  sets: ReturnType<typeof ownSet>[],
) => ({
  performanceId: `${id}-performance`,
  exerciseId: id,
  exerciseName: name,
  position,
  mediaAssetIds: [],
  previousPerformance: null,
  sets,
});
/**
 * A workout of one's own still running, as Today's read carries it (TRN-033): started today, two
 * exercises from TB Gym's pool and three sets, one of them logged. The name stored is "Workout".
 */
const ownWorkout = (overrides: Record<string, unknown> = {}) => ({
  workoutExecutionId: OWN_WORKOUT_ID,
  name: 'Workout',
  date: TODAY,
  status: 'InProgress',
  startedAtUtc: '2026-09-20T07:40:00Z',
  completedAtUtc: null,
  version: 4,
  exercises: [
    ownExercise('goblet', 'Goblet squat', 1, [ownSet('goblet-1', 1, true), ownSet('goblet-2', 2)]),
    ownExercise('row', 'Seated cable row', 2, [ownSet('row-1', 1)]),
  ],
  notes: [],
  ...overrides,
});

interface TraineeToday {
  /** The day's training read, answered afresh on every read: by default nothing assigned or running. */
  readonly day?: () => object;
  /** The week's days over nothing scheduled: each may set `scheduled`, `completed` and `ownCompleted`. */
  readonly week?: readonly { scheduled?: number; completed?: number; ownCompleted?: number }[];
  /** Training is outside the trainee's plan. */
  readonly closed?: boolean;
  /** The training card's heading once it is drawn; the offer to start a workout by default. */
  readonly heading?: string;
  readonly extra?: Record<string, (route: Route) => Promise<void> | void>;
}

/**
 * Today for a trainee of the house: Training alone, nothing in it yet, and their own profile says they
 * coach themselves. Returns the reads of the coach's name, which must never be asked for (CLI-026).
 */
async function openTraineeToday(
  page: Page,
  width: number,
  height: number,
  options: TraineeToday = {},
): Promise<string[]> {
  const coachReads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/client-profile/me/coach') {
      coachReads.push(request.url());
    }
  });
  const nothing = STATES['nothing assigned'];
  const training = options.closed ? 'NoEntitlement' : 'Granted';
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [HOUSE],
    user: MAYA,
    extra: {
      'GET /api/client-access/me': (route: Route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({
            feature,
            isAllowed: feature === 'Training' && !options.closed,
            reason: feature === 'Training' ? training : 'NoEntitlement',
          })),
        ),
      'GET /api/client-profile/me': (route: Route) =>
        json(route, 200, finishedProfile({ selfDirected: true })),
      // Answered as for anyone, so only the count can tell it was asked.
      'GET /api/client-profile/me/coach': (route: Route) =>
        json(route, 200, { name: 'Lea Haddad' }),
      'GET /api/training/me/today': (route: Route) =>
        json(
          route,
          200,
          options.day?.() ?? (options.closed ? day([], false, 'NoEntitlement') : nothing.day),
        ),
      'GET /api/training/me/upcoming': (route: Route) => json(route, 200, nothing.upcoming),
      'GET /api/training/me/week': (route: Route) =>
        json(route, 200, {
          ...trainingWeek,
          isAllowed: !options.closed,
          accessReason: training,
          days: trainingWeek.days.map((one, index) => ({
            ...one,
            scheduled: 0,
            completed: 0,
            ...options.week?.[index],
          })),
        }),
      'GET /api/client-renewal/me': (route: Route) => json(route, 200, planRunning),
      'GET /api/messaging/conversations': (route: Route) =>
        json(route, 200, {
          items: [],
          hasMore: false,
          nextBeforeActivityAtUtc: null,
          nextBeforeConversationId: null,
        }),
      ...options.extra,
    },
  });
  await page.goto('/');
  await expect(page.locator('app-client-tabs')).toBeVisible();
  await expect(page.locator('#today-training-heading')).toHaveText(
    options.heading ?? 'Your workout',
  );
  await expect(page.locator('.row-skeleton')).toHaveCount(0);
  await waitForFonts(page);
  return coachReads;
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a self-directed trainee’s Today shows TB Gym’s space where a coach would be, never asks for a coach, and offers no Messages`, async ({
    page,
  }) => {
    const coachReads = await openTraineeToday(page, width, height);

    const chip = page.locator('.today-coach[data-self-directed]');
    await expect(chip.locator('app-avatar')).toHaveText('TB');
    await expect(chip.locator('.tb-visually-hidden')).toHaveText(
      'Self-directed · TB Gym coaching space',
    );
    // On a phone the chip is the mark alone, as a coach's is; wider, its two lines show.
    const lines = chip.locator('.today-self');
    if (width === 390) {
      await expect(lines).toBeHidden();
    } else {
      await expect(lines.locator('span')).toHaveText('Self-directed');
      await expect(lines.locator('bdi')).toHaveText('TB Gym coaching space');
      // An ellipsis keeps the whole name in the text but cuts what is seen; the chip's width keeps it whole.
      const name = await lines
        .locator('bdi')
        .evaluate((bdi) => ({ seen: bdi.clientWidth, whole: bdi.scrollWidth }));
      expect(name.seen, 'the space’s name takes no room').toBeGreaterThan(0);
      expect(name.whole, 'the space’s name is cut short').toBeLessThanOrEqual(name.seen + 1);
    }
    await expect(page.locator('.today-coach:not([data-self-directed])')).toHaveCount(0);
    // With Training open and nothing in progress, the card offers a workout of their own (notes plan N9b3).
    await expect(page.locator('p[data-self-directed]')).toHaveText(
      'Pick exercises from TB Gym’s pool and log each set as you go.',
    );
    await expect(page.getByText('Your coach will put your program here.')).toHaveCount(0);
    await expect(page.getByText('Message your coach')).toHaveCount(0);
    await expect(page.locator('a[href="/messages"]')).toHaveCount(0);
    expect(coachReads).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath(`n9a2-today-trainee-${width}.png`),
      fullPage: true,
    });
  });
}

test('a coach’s client with nothing assigned still reads that their coach will put the program here', async ({
  page,
}) => {
  await openToday(page, { state: 'nothing assigned' });

  await expect(page.getByText('Your coach will put your program here.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Message your coach' })).toHaveAttribute(
    'href',
    '/messages',
  );
  await expect(page.locator('[data-self-directed]')).toHaveCount(0);
  await expect(page.locator('.today-coach .tb-visually-hidden')).toHaveText('Coached by');
  // A coach's client is never offered a workout of their own (notes plan N9b3).
  await expect(page.locator('[data-start-own]')).toHaveCount(0);
});

// Notes plan N9d1b: a coached client whose coach left waits for a new one. The coach's read answers 404,
// Today says so where the coach's chip goes, and no link leads to a chat nobody reads.
test.describe('a client waiting for a coach', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 404 .*\/api\/client-profile\/me\/coach/],
    },
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px Today says Waiting for a coach where the coach goes, and offers no chat`, async ({
      page,
    }) => {
      await openToday(page, { state: 'nothing assigned', width, height, waitingForCoach: true });

      const chip = page.locator('.today-coach[data-waiting-coach]');
      await expect(chip).toBeVisible();
      await expect(chip).toHaveText('Waiting for a coach');
      await expect(page.locator('.today-coach')).toHaveCount(1);
      await expect(chip.locator('app-avatar')).toHaveCount(0);
      await expect(page.locator('a.today-coach, .today-coach a')).toHaveCount(0);
      // The heading and the bell stay where they were: nothing in the header spills sideways.
      const header = await page.locator('.today-header').boundingBox();
      const box = await chip.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(header!.x + header!.width + 1);
      await expect(
        page.getByText(
          'Your coaching space will give you a new coach, who will put your program here.',
        ),
      ).toBeVisible();
      await expect(page.getByText('Your coach will put your program here.')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Message your coach' })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({
        path: test.info().outputPath(`n9d2-today-waiting-${width}.png`),
        fullPage: true,
      });
    });
  }

  test('closed training offers no Contact your coach while waiting', async ({ page }) => {
    await openToday(page, { state: 'access closed', waitingForCoach: true });

    await expect(page.locator('.today-coach[data-waiting-coach]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact your coach' })).toHaveCount(0);
  });

  test('200% text keeps the chip inside the page', async ({ page }) => {
    await openToday(page, { state: 'nothing assigned', waitingForCoach: true });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(page.locator('.today-coach[data-waiting-coach]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

// Notes plan N9b3, TRN-033: a trainee of TB Gym's own space starts a workout of their own from Today,
// carries on with the one in progress, and the week counts the ones they finished.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a trainee with nothing in progress is offered to start a workout of their own`, async ({
    page,
  }) => {
    await openTraineeToday(page, width, height);

    const card = page.locator('section.today-card');
    await expect(card).toHaveClass(/today-card--hero/);
    await expect(card).toHaveAttribute('aria-labelledby', 'today-training-heading');
    await expect(card.locator('p[data-self-directed]')).toHaveText(
      'Pick exercises from TB Gym’s pool and log each set as you go.',
    );
    const start = card.getByRole('button', { name: 'Start a workout' });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('data-start-own', '');
    await expect(card.locator('.today-problem')).toHaveCount(0);
    // Nothing to carry on, so no link into the player.
    await expect(card.locator('a.today-action')).toHaveCount(0);
    // Nothing scheduled and nothing done yet: the week speaks of workouts, never of sessions.
    const week = page.locator('section.today-week');
    await expect(week.locator('[data-own-week]')).toHaveText('No workouts yet');
    await expect(week.locator('.today-week-days .tb-visually-hidden')).toHaveText(
      Array.from({ length: 7 }, () => 'No workout'),
    );
    await expect(week.locator('.today-week-ring.is-done')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath(`n9b3-today-start-${width}.png`),
      fullPage: true,
    });
  });
}

test('Start a workout refreshes the security token, starts one and opens the player on it', async ({
  page,
}) => {
  let started = false;
  const sent: unknown[] = [];
  const asked: string[] = [];
  const empty = ownWorkout({ exercises: [], version: 1 });
  await openTraineeToday(page, 390, 844, {
    // The player reads the day again once it opens, and finds the workout just started.
    day: () => ({ ...STATES['nothing assigned'].day, ownWorkout: started ? empty : null }),
    extra: {
      'POST /api/training/me/workouts': (route: Route) => {
        sent.push(route.request().postDataJSON());
        started = true;
        return json(route, 200, empty);
      },
    },
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/csrf' || path === '/api/training/me/workouts') {
      asked.push(`${request.method()} ${path}`);
    }
  });

  await page.getByRole('button', { name: 'Start a workout' }).click();

  await expect(page).toHaveURL(`/training/today?sessionId=${OWN_WORKOUT_ID}`);
  await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workout');
  await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();
  // An empty start, after a fresh token: the first write after a sign-up would be refused without it.
  expect(sent).toEqual([{}]);
  expect(asked.slice(0, 2)).toEqual(['GET /api/auth/csrf', 'POST /api/training/me/workouts']);
});

test('with motion allowed, Start a workout grows the card into the player (W7)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Counts the view transitions the page starts, so the reveal is seen to run, not only its end.
  await page.addInitScript(() => {
    const start = Document.prototype.startViewTransition;
    const counted = window as unknown as { tbTransitions: number };
    counted.tbTransitions = 0;
    Document.prototype.startViewTransition = function (
      this: Document,
      ...args: Parameters<Document['startViewTransition']>
    ) {
      counted.tbTransitions += 1;
      return start.apply(this, args);
    };
  });
  let started = false;
  const empty = ownWorkout({ exercises: [], version: 1 });
  await openTraineeToday(page, 390, 844, {
    day: () => ({ ...STATES['nothing assigned'].day, ownWorkout: started ? empty : null }),
    extra: {
      'POST /api/training/me/workouts': (route: Route) => {
        started = true;
        return json(route, 200, empty);
      },
    },
  });

  await page.getByRole('button', { name: 'Start a workout' }).click();

  await expect(page).toHaveURL(`/training/today?sessionId=${OWN_WORKOUT_ID}`);
  await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { tbTransitions: number }).tbTransitions),
  ).toBe(1);
  // The reveal tidies up after itself once the player is in place.
  await expect(page.locator('html')).not.toHaveClass(/tb-player-reveal/);
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a workout of one’s own in progress is Today’s card, and Carry on opens it in the player`, async ({
    page,
  }) => {
    await openTraineeToday(page, width, height, {
      day: () => ({ ...STATES['nothing assigned'].day, ownWorkout: ownWorkout() }),
      heading: 'Workout',
    });

    const card = page.locator('section.today-card');
    await expect(card).toHaveClass(/today-card--hero/);
    await expect(card.locator('.today-state')).toHaveText('In progress · 1 of 3 sets logged');
    await expect(card.locator('.summary')).toHaveText('2 exercises · 3 sets');
    const carryOn = card.getByRole('link', { name: 'Carry on' });
    await expect(carryOn).toHaveAttribute('href', `/training/today?sessionId=${OWN_WORKOUT_ID}`);
    await expect(card.locator('[data-start-own]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath(`n9b3-today-carry-on-${width}.png`),
      fullPage: true,
    });

    await carryOn.click();
    await expect(page).toHaveURL(`/training/today?sessionId=${OWN_WORKOUT_ID}`);
    await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
  });
}

test('a workout of one’s own started on an earlier day says when, and that it holds no exercise yet', async ({
  page,
}) => {
  await openTraineeToday(page, 390, 844, {
    day: () => ({
      ...STATES['nothing assigned'].day,
      ownWorkout: ownWorkout({
        date: '2026-09-18',
        startedAtUtc: '2026-09-18T16:00:00Z',
        exercises: [],
      }),
    }),
    heading: 'Workout',
  });

  const card = page.locator('section.today-card');
  await expect(card.locator('.today-state')).toHaveText('Started Fri 18 Sep');
  await expect(card.locator('.summary')).toHaveText('No exercises yet');
  await expect(card.getByRole('link', { name: 'Carry on' })).toHaveAttribute(
    'href',
    `/training/today?sessionId=${OWN_WORKOUT_ID}`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test('the week counts a trainee’s own workouts, and each day says how many', async ({ page }) => {
  await openTraineeToday(page, 390, 844, {
    week: [{ ownCompleted: 1 }, {}, { ownCompleted: 2 }],
  });

  const week = page.locator('section.today-week');
  await expect(week.locator('[data-own-week]')).toHaveText('3 workouts done');
  await expect(week.locator('.today-week-days .tb-visually-hidden')).toHaveText([
    '1 workout done',
    'No workout',
    '2 workouts done',
    'No workout',
    'No workout',
    'No workout',
    'No workout',
  ]);
  const rings = week.locator('.today-week-ring');
  await expect(rings.nth(0)).toHaveClass(/is-done/);
  await expect(rings.nth(1)).not.toHaveClass(/is-done/);
  await expect(rings.nth(2)).toHaveClass(/is-done/);
  await expect(week.locator('.today-week-ring.is-done')).toHaveCount(2);
  await expect(week.locator('.today-week-ring.is-planned')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test('with a program’s sessions too, the week counts both, and a day with both says both', async ({
  page,
}) => {
  await openTraineeToday(page, 390, 844, {
    week: [
      { scheduled: 1, completed: 1 },
      { ownCompleted: 1 },
      { scheduled: 1, completed: 1, ownCompleted: 1 },
      {},
      {},
      {},
      { scheduled: 1 },
    ],
  });

  const week = page.locator('section.today-week');
  await expect(week.locator('[data-own-week]')).toHaveText('2 of 3 sessions done · 2 of your own');
  await expect(week.locator('.today-week-days .tb-visually-hidden')).toHaveText([
    '1 of 1 sessions done',
    '1 workout done',
    '1 of 1 sessions done, and 1 workout of your own',
    'No workout',
    'No workout',
    'No workout',
    '0 of 1 sessions done',
  ]);
  await expect(week.locator('.today-week-ring.is-done')).toHaveCount(3);
  await expect(week.locator('.today-week-ring').nth(6)).toHaveClass(/is-planned/);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test('a trainee whose Training is closed is offered no start, only that their workouts will start here', async ({
  page,
}) => {
  await openTraineeToday(page, 390, 844, { closed: true, heading: 'No workouts yet' });

  const card = page.locator('section.today-card');
  await expect(card.locator('p[data-self-directed]')).toHaveText('Your workouts will start here.');
  await expect(page.locator('[data-start-own]')).toHaveCount(0);
  await expect(card).not.toHaveClass(/today-card--hero/);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

// Notes plan N9b4: a trainee's start card links to TB Gym's pool; nobody else's Today does.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a trainee’s start card links to TB Gym’s pool, and Browse exercises opens it`, async ({
    page,
  }) => {
    const poolReads: string[] = [];
    await openTraineeToday(page, width, height, {
      extra: {
        'GET /api/exercise-pool': (route: Route) => {
          poolReads.push(new URL(route.request().url()).searchParams.toString());
          return json(route, 200, poolPage([POOL_BENCH_PRESS, POOL_PLANK]));
        },
      },
    });

    const card = page.locator('section.today-card');
    await expect(card.getByRole('button', { name: 'Start a workout' })).toBeVisible();
    const browse = card.getByRole('link', { name: 'Browse exercises' });
    await expect(browse).toHaveAttribute('href', '/training/pool');
    await expect(browse).toHaveAttribute('data-browse-pool', '');
    // A plain link: only the card's own action grows into the player (W7).
    await expect(browse).not.toHaveClass(/today-action/);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await browse.click();

    await expect(page).toHaveURL('/training/pool');
    await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible();
    await expect(page.locator('li.exercise h2')).toHaveText(['Bench press', 'Plank']);
    expect(poolReads).toEqual(['skip=0&take=50']);
  });
}

test('a coach’s client’s Today offers no Browse exercises', async ({ page }) => {
  await openToday(page, { state: 'nothing assigned' });

  await expect(page.getByText('Your coach will put your program here.')).toBeVisible();
  await expect(page.locator('[data-browse-pool]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Browse exercises' })).toHaveCount(0);
});

test('a trainee whose Training is closed is offered no Browse exercises either', async ({
  page,
}) => {
  await openTraineeToday(page, 390, 844, { closed: true, heading: 'No workouts yet' });

  await expect(page.locator('p[data-self-directed]')).toHaveText('Your workouts will start here.');
  await expect(page.locator('[data-browse-pool]')).toHaveCount(0);
});

test.describe('a start the server refuses', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\/me\/workouts/] },
  });

  test('ten started today says so on the card, and nothing opens', async ({ page }) => {
    await openTraineeToday(page, 390, 844, {
      extra: {
        'POST /api/training/me/workouts': (route: Route) =>
          json(route, 409, {
            code: 'own_workout_daily_limit',
            message:
              'You have started 10 workouts today, the most one day holds. Start the next one tomorrow.',
          }),
      },
    });

    await page.getByRole('button', { name: 'Start a workout' }).click();

    const problem = page.locator('.today-card .today-problem');
    await expect(problem).toHaveText(
      'You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.',
    );
    await expect(problem).toHaveAttribute('role', 'alert');
    await expect(page).toHaveURL('/');
    // The button is there to try again tomorrow, no longer busy.
    await expect(page.getByRole('button', { name: 'Start a workout' })).not.toHaveAttribute(
      'aria-disabled',
    );
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });

  test('one already in progress on another phone turns the card into Carry on, which says why and takes focus', async ({
    page,
  }) => {
    let refused = false;
    let reads = 0;
    await openTraineeToday(page, 390, 844, {
      day: () => {
        reads += 1;
        return { ...STATES['nothing assigned'].day, ownWorkout: refused ? ownWorkout() : null };
      },
      extra: {
        'POST /api/training/me/workouts': (route: Route) => {
          refused = true;
          return json(route, 409, {
            code: 'own_workout_in_progress',
            message:
              'You have a workout you have not finished. Carry on with it, or finish it first.',
          });
        },
      },
    });
    const before = reads;

    await page.getByRole('button', { name: 'Start a workout' }).click();

    // Today reads the day again and finds the one already running.
    const heading = page.locator('#today-training-heading');
    await expect(heading).toHaveText('Workout');
    await expect(page.getByRole('link', { name: 'Carry on' })).toHaveAttribute(
      'href',
      `/training/today?sessionId=${OWN_WORKOUT_ID}`,
    );
    await expect(page.locator('[data-start-own]')).toHaveCount(0);
    // The Carry on card says why nothing started; focus moves to its heading, since Start is gone.
    const problem = page.locator('.today-card .today-problem');
    await expect(problem).toHaveText(
      'You have a workout you haven’t finished. Carry on with it, or finish it first.',
    );
    await expect(problem).toHaveAttribute('role', 'alert');
    await expect(heading).toBeFocused();
    expect(reads).toBe(before + 1);
    await expect(page).toHaveURL('/');
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });
});

test('personal mode persists when the account screen reloads', async ({ page }) => {
  let user = { ...MAYA };
  await mockSession(page, {
    memberships: [CLIENT_MEMBERSHIP],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
        ),
      'GET /api/auth/me': (route: Route) => json(route, 200, user),
      'PUT /api/auth/me/theme': (route: Route) => {
        user = { ...user, preferredThemeMode: 'dark' };
        return json(route, 200, user);
      },
    },
  });
  await page.goto('/account/appearance');
  await page.getByRole('radio', { name: /Dark/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await page.reload();
  await expect(page.getByRole('radio', { name: /Dark/ })).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test.describe('on an iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

  test('Today offers the app last, and "Not now" keeps it quiet after a reload', async ({
    page,
  }) => {
    await openToday(page);

    const offer = page.getByRole('region', { name: 'Add TB Gym to your home screen' });
    await expect(offer).toBeVisible();
    // After the coach's message: it never outranks the workout.
    const message = await page.locator('app-today-coach-message').boundingBox();
    const box = await offer.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((message?.y ?? 0) + (message?.height ?? 0) - 1);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/r25c-today-install-390.png', fullPage: true });

    await offer.getByRole('button', { name: 'Not now' }).click();
    await expect(offer).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#today-training-heading')).toBeVisible();
    await expect(offer).toHaveCount(0);

    // Me is where it can always be found again.
    await page.locator('a.today-me').click();
    await expect(
      page.getByRole('region', { name: 'Add TB Gym to your home screen' }),
    ).toBeVisible();
  });
});
