import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { OwnWorkoutView } from '../src/app/core/api/generated';
import { finishedProfile } from '../src/testing/intake-fixtures';
import { POOL_BENCH_PRESS, POOL_PLANK, poolPage } from '../src/testing/own-workout-fixtures';
import {
  historyItem,
  historyPage,
  nextProgramView,
  programSession,
  programView,
} from '../src/testing/training-program-fixtures';
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

const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const user = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Maya Fakhoury',
};
const decisions = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);

async function openTraining(page: Page, width: number, height: number, program = programView()) {
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [membership],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/training/me/program': (route: Route) => json(route, 200, program),
      'GET /api/training/me/history': (route: Route) => json(route, 200, historyPage()),
      // With no program the page asks who reads it: a coach's client here (notes plan N9b3).
      'GET /api/client-profile/me': (route: Route) => json(route, 200, finishedProfile()),
    },
  });
  await page.goto('/training/program');
  await expect(page.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
  if (program.isAllowed) await expect(page.getByText('Personal record:')).toBeAttached();
  await waitForFonts(page);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  // A target the sticky tab bar covers at the first scroll is judged where a person reaches it (CLIENT-7).
  expect(
    (await personFacing(page, result.violations)).map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the Training tab at ${width}px leads with the program and today's workout`, async ({
    page,
  }) => {
    await openTraining(page, width, height);

    await expect(page.getByRole('link', { name: 'Training' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const hero = page.locator('.hero');
    await expect(hero.locator('.hero-eyebrow')).toHaveText('Week 3 of 4');
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText('Strength Foundations');
    await expect(hero.getByRole('link', { name: 'Start workout' })).toHaveAttribute(
      'href',
      '/training/today?sessionId=s6',
    );
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Finished workouts' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r25b-training-${width}.png`, fullPage: true });
  });
}

// Critique B18: a program the coach shows before its first day.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the next program sits under the weeks at ${width}px, read week by week with nothing to start`, async ({
    page,
  }) => {
    await openTraining(
      page,
      width,
      height,
      programView({ nextProgram: nextProgramView(), nextProgramStartDate: '2026-10-12' }),
    );

    const section = page.locator('section[aria-labelledby="next-program-heading"]');
    await expect(section.getByRole('heading', { name: 'Next program' })).toBeVisible();
    await expect(section.locator('.block-dates')).toHaveText('Summer Strength · Starts Mon 12 Oct');
    const week = section.getByRole('button', { name: /Week 1/ });
    await expect(week).toContainText('2 sessions');
    await week.click();
    await expect(section.locator('.session')).toHaveCount(2);
    await expect(section.getByRole('link')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b18-next-program-${width}.png`, fullPage: true });

    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
  });
}

// Critique B19: the server sends no finished program, so the page is the one with nothing assigned.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`with finished programs kept back the client keeps their workouts at ${width}px`, async ({
    page,
  }) => {
    await openTraining(page, width, height, programView({ program: null }));

    await expect(page.getByRole('heading', { name: 'Nothing assigned yet' })).toBeVisible();
    await expect(page.locator('.hero')).toHaveCount(0);
    await expect(page.getByText('Program finished')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Finished workouts' })).toBeVisible();
    await expect(page.locator('.history-item').first()).toBeVisible();
    // A coach's client starts no workout of their own, from nothing or from history (notes plan N9b3).
    await expect(page.locator('[data-start-own], [data-start-from]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/b19-kept-back-${width}.png` });
  });
}

test('a next program with a very long name wraps instead of pushing the phone page sideways', async ({
  page,
}) => {
  await openTraining(
    page,
    390,
    844,
    programView({ nextProgram: nextProgramView({ name: 'Hypertrophy'.repeat(14) }) }),
  );

  await expect(page.getByRole('heading', { name: 'Next program' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('before a paid plan begins the program shown early takes the closed page’s place', async ({
  page,
}) => {
  await openTraining(
    page,
    390,
    844,
    programView({
      isAllowed: false,
      accessReason: 'NotStarted',
      nextProgramStartDate: '2026-10-12',
      program: nextProgramView(),
    }),
  );

  const hero = page.locator('.hero');
  await expect(hero.locator('.hero-eyebrow')).toHaveText('Starts Mon 12 Oct');
  await expect(hero.getByRole('heading', { level: 2 })).toHaveText('Summer Strength');
  await expect(hero.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Training is not available' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Finished workouts' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

test('an earlier week opens and closes from the keyboard, and shows what was missed', async ({
  page,
}) => {
  await openTraining(page, 390, 844);

  const week = page.getByRole('button', { name: /Week 2/ });
  await expect(week).toHaveAttribute('aria-expanded', 'false');
  await week.focus();
  await page.keyboard.press('Enter');
  await expect(week).toHaveAttribute('aria-expanded', 'true');
  const body = page.locator('#week-2');
  await expect(body.locator('.session-tag')).toHaveText(['Done', 'Missed']);
  await axe(page);

  await page.keyboard.press('Space');
  await expect(week).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toHaveCount(0);
});

test('the page reflows at 200% text without sideways scrolling', async ({ page }) => {
  await openTraining(page, 390, 844);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('a.hero-action')).toBeVisible();
});

// Notes plan N9b3, TRN-033: a trainee of TB Gym's own space has no program; Training offers a workout of
// their own, from nothing or from any finished workout, and history names their own ones as theirs.

/** TB Gym's own coaching space, whose trainees train with no coach (notes plan N9a2). */
const house = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};
const traineeDecisions = [
  'Training',
  'Nutrition',
  'CheckIns',
  'Messaging',
  'ResourceLibrary',
  'Sessions',
].map((feature) => ({
  feature,
  isAllowed: feature === 'Training',
  reason: feature === 'Training' ? 'Granted' : 'NoEntitlement',
}));
/** A finished workout of one's own: no program holds it, so its program's name is empty. */
const ownFinished = historyItem({
  workoutExecutionId: 'own-past',
  name: 'Workout',
  programName: '',
  isOwnWorkout: true,
  date: '2026-09-29',
  completedAtUtc: '2026-09-29T18:10:00Z',
  durationSeconds: 2400,
  completedSetCount: 6,
  totalSetCount: 6,
  volume: [{ unit: 'Kilogram', loadTimesRepetitions: 1450 }],
  personalRecords: [
    {
      setPerformanceId: 'own-set-3',
      exerciseName: 'Goblet squat',
      repetitions: 10,
      load: 24,
      unit: 'Kilogram',
      ruleKey: 'ExactRepsLoad',
      ruleVersion: 1,
    },
  ],
});
/** What a start answers: copied from a finished workout, its exercise still in the pool with an empty set. */
const started = (fromWorkoutId: string | null): OwnWorkoutView => ({
  workoutExecutionId: 'own-new',
  name: 'Workout',
  date: '2026-09-30',
  status: 'InProgress',
  startedAtUtc: '2026-09-30T08:00:00Z',
  completedAtUtc: null,
  version: 1,
  exercises: fromWorkoutId
    ? [
        {
          performanceId: 'perf-goblet',
          exerciseId: 'goblet',
          exerciseName: 'Goblet squat',
          position: 1,
          mediaAssetIds: [],
          previousPerformance: null,
          sets: [
            {
              performanceId: 'set-goblet-1',
              position: 1,
              actualRepetitions: null,
              actualLoad: null,
              actualLoadUnit: null,
              actualRpe: null,
              actualRir: null,
              isCompleted: false,
              clientNote: null,
            },
          ],
        },
      ]
    : [],
  notes: [],
});

/** Training for a trainee of the house: no program, their own finished workout and a program's. */
async function openTraineeTraining(
  page: Page,
  width: number,
  height: number,
  extra: Record<string, (route: Route) => Promise<void> | void> = {},
) {
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [house],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, traineeDecisions),
      'GET /api/training/me/program': (route: Route) =>
        json(route, 200, programView({ program: null })),
      'GET /api/training/me/history': (route: Route) =>
        json(route, 200, historyPage([ownFinished, historyItem()])),
      'GET /api/client-profile/me': (route: Route) =>
        json(route, 200, finishedProfile({ selfDirected: true })),
      ...extra,
    },
  });
  await page.goto('/training/program');
  await expect(page.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Train on your own' })).toBeVisible();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await waitForFonts(page);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a trainee’s Training offers a workout of their own, and history names their own`, async ({
    page,
  }) => {
    await openTraineeTraining(page, width, height);

    await expect(
      page.getByText(
        'Start a workout, pick exercises from TB Gym’s pool and log each set. Your finished workouts are below.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a workout' })).toHaveAttribute(
      'data-start-own',
      '',
    );
    await expect(page.getByRole('heading', { name: 'Nothing assigned yet' })).toHaveCount(0);
    await expect(page.getByText('Your coach will put your program here.')).toHaveCount(0);

    // Their own workout is named as theirs, with no empty program name trailing it.
    const [own, program] = [
      page.locator('.history-item').nth(0),
      page.locator('.history-item').nth(1),
    ];
    await expect(own.locator('.history-top strong')).toHaveText('Workout');
    await expect(own.locator('.history-meta > :last-child')).toHaveText('Your own workout');
    await expect(own.locator('.history-meta bdi')).toHaveCount(0);
    await expect(program.locator('.history-meta bdi')).toHaveText('Strength Foundations');
    await expect(program.locator('.history-meta')).not.toContainText('Your own workout');
    // Any finished workout can be started again, each button named for its own workout. The name's
    // hidden part is a block of its own, so the name may hold a space before its colon.
    const startFrom = own.locator('[data-start-from]');
    await expect(startFrom).toHaveText('Start from this workout: Workout, Tue 29 Sep');
    await expect(startFrom).toHaveAccessibleName(
      /^Start from this workout ?: Workout, Tue 29 Sep$/,
    );
    await expect(program.locator('[data-start-from]')).toHaveAccessibleName(
      /^Start from this workout ?: Upper A, Mon 28 Sep$/,
    );
    await expect(page.locator('[data-start-from]')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: test.info().outputPath(`n9b3-training-trainee-${width}.png`),
      fullPage: true,
    });
  });
}

for (const { button, press, body, first } of [
  {
    button: 'Start a workout',
    press: (page: Page) => page.getByRole('button', { name: 'Start a workout' }),
    body: {},
    first: 'No exercises yet',
  },
  {
    button: 'Start from this workout',
    press: (page: Page) => page.locator('.history-item').first().locator('[data-start-from]'),
    body: { fromWorkoutId: 'own-past' },
    first: 'Goblet squat',
  },
]) {
  test(`“${button}” starts a workout of one’s own and opens the player on it`, async ({ page }) => {
    const sent: unknown[] = [];
    const view = started('fromWorkoutId' in body ? body.fromWorkoutId : null);
    await openTraineeTraining(page, 390, 844, {
      'POST /api/training/me/workouts': (route: Route) => {
        sent.push(route.request().postDataJSON());
        return json(route, 200, view);
      },
      // The player's reads, once it opens on the workout just started.
      'GET /api/training/me/today': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-09-30',
          workouts: [],
          ownWorkout: view,
        }),
      'GET /api/training/me/upcoming': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-09-30',
          timeZoneId: 'Asia/Beirut',
          hasAssignedProgram: false,
          hasVisibleSessions: false,
          searchThrough: '2026-12-29',
          nextSession: null,
          unfinishedWorkouts: [],
          nextSkip: null,
          todayCoverage: { activeBlock: null, nextBlockStartDate: null },
        }),
    });

    await press(page).click();

    await expect(page).toHaveURL('/training/today?sessionId=own-new');
    await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
    await expect(page.getByRole('heading', { level: 2, name: first })).toBeVisible();
    expect(sent).toEqual([body]);
  });
}

// Notes plan N9b4: a trainee's Training links to TB Gym's pool; a coach's client's never does.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px a trainee’s Training links to TB Gym’s pool beside Start a workout, and Browse exercises opens it`, async ({
    page,
  }) => {
    const poolReads: string[] = [];
    await openTraineeTraining(page, width, height, {
      'GET /api/exercise-pool': (route: Route) => {
        poolReads.push(new URL(route.request().url()).searchParams.toString());
        return json(route, 200, poolPage([POOL_BENCH_PRESS, POOL_PLANK]));
      },
    });

    const actions = page.locator('.own-actions');
    await expect(actions.getByRole('button', { name: 'Start a workout' })).toBeVisible();
    const browse = actions.getByRole('link', { name: 'Browse exercises' });
    await expect(browse).toHaveAttribute('href', '/training/pool');
    await expect(browse).toHaveAttribute('data-browse-pool', '');
    await expect(page.getByRole('link', { name: 'Browse exercises' })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await axe(page);

    await browse.click();

    await expect(page).toHaveURL('/training/pool');
    await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible();
    await expect(page.locator('li.exercise h2')).toHaveText(['Bench press', 'Plank']);
    expect(poolReads).toEqual(['skip=0&take=50']);
  });
}

test('a coach’s client’s Training offers no Browse exercises', async ({ page }) => {
  await openTraining(page, 390, 844, programView({ program: null }));

  await expect(page.getByRole('heading', { name: 'Nothing assigned yet' })).toBeVisible();
  await expect(page.locator('[data-browse-pool]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Browse exercises' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'TB Gym’s programs' })).toHaveCount(0);
});

test('a trainee with no program finds TB Gym’s programs beside their own workouts (notes plan N9c4)', async ({
  page,
}) => {
  await openTraineeTraining(page, 390, 844);

  const programs = page.locator('.own-actions').getByRole('link', { name: 'TB Gym’s programs' });
  await expect(programs).toHaveAttribute('href', '/training/house-programs');
  await expect(page.getByRole('link', { name: 'TB Gym’s programs' })).toHaveCount(1);
  // Start a workout stays the one filled action.
  await expect(page.locator('.own-actions .tb-button--filled')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

// Notes plan N9c4: a trainee's started program of TB Gym's, its early start, its closed plan, and the way
// to TB Gym's programs; a coach's client's Training never asks about any of it.

/** A program of TB Gym's the trainee started: this week holds a later session they may start before its day. */
function houseProgram() {
  const view = programView();
  const week = view.program!.weeks[2];
  view.program!.weeks[2] = {
    ...week,
    sessions: [
      ...week.sessions,
      { ...programSession('s7', 'Upper B', '2026-10-02', 'Upcoming'), canStartEarly: true },
      programSession('s8', 'Lower B', '2026-10-03', 'Upcoming'),
    ],
  };
  return view;
}

/** What the upcoming read says: the trainee's program counts while its plan grants (TRN-034). */
const upcoming = (hasAssignedProgram: boolean) => ({
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-09-30',
  timeZoneId: 'Asia/Beirut',
  hasAssignedProgram,
  hasVisibleSessions: hasAssignedProgram,
  searchThrough: '2026-12-29',
  nextSession: null,
  unfinishedWorkouts: [],
  nextSkip: null,
  todayCoverage: null,
});

/** The early session once started, as the player reads it from today's list. */
const startedEarly = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-09-30',
  ownWorkout: null,
  workouts: [
    {
      sessionId: 's7',
      mesocycleId: 'block-1',
      workoutExecutionId: 'w-s7',
      name: 'Upper B',
      coachNotes: null,
      status: 'InProgress',
      startedAtUtc: '2026-09-30T08:00:00Z',
      executionVersion: 1,
      exercises: [
        {
          prescriptionId: 'exercise-prescription-1',
          performanceId: 'exercise-1',
          prescribedExerciseId: 'row',
          prescribedExerciseName: 'Barbell row',
          actualExerciseId: 'row',
          actualExerciseName: 'Barbell row',
          wasSubstituted: false,
          modificationPolicy: 'Locked',
          alternatives: [],
          coachNotes: null,
          mediaAssetIds: [],
          previousPerformance: null,
          sets: [
            {
              prescriptionId: 'set-prescription-1',
              performanceId: 'set-1',
              position: 1,
              setType: 'Normal',
              prescribedRepetitionsMinimum: 8,
              prescribedRepetitionsMaximum: 12,
              prescribedLoad: null,
              prescribedLoadUnit: 'Kilogram',
              loadStrategy: 'None',
              loadStep: null,
              prescribedTargetRpe: null,
              prescribedTargetRir: null,
              restSeconds: 90,
              tempo: null,
              coachNotes: null,
              actualRepetitions: null,
              actualLoad: null,
              actualLoadUnit: null,
              actualRpe: null,
              actualRir: null,
              isCompleted: false,
              clientNote: null,
            },
          ],
        },
      ],
      notes: [],
    },
  ],
};

const CLOSED_WORDS =
  'This program came with a plan that isn’t running now, so its sessions are closed. What you logged stays yours.';
/** Start now's name, its session named for a screen reader: the hidden part is a block of its own. */
const START_NOW_UPPER_B = /^Start now ?, Upper B$/;

/**
 * Training for a trainee of the house whose program of TB Gym's runs, every call made once the page has
 * loaded recorded in order: the app's own first antiforgery token is not counted as a write's.
 */
async function openHouseProgram(
  page: Page,
  width: number,
  height: number,
  options: {
    planGrants?: boolean;
    extra?: Record<string, (route: Route) => Promise<void> | void>;
  } = {},
) {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) calls.push(`${request.method()} ${url.pathname}`);
  });
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [house],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, traineeDecisions),
      'GET /api/training/me/program': (route: Route) => json(route, 200, houseProgram()),
      'GET /api/training/me/history': (route: Route) =>
        json(route, 200, historyPage([ownFinished, historyItem()])),
      'GET /api/client-profile/me': (route: Route) =>
        json(route, 200, finishedProfile({ selfDirected: true })),
      'GET /api/training/me/upcoming': (route: Route) =>
        json(route, 200, upcoming(options.planGrants ?? true)),
      ...options.extra,
    },
  });
  await page.goto('/training/program');
  await expect(page.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
  await expect(page.locator('.hero h2')).toHaveText('Strength Foundations');
  await expect(page.getByText('Personal record:').first()).toBeAttached();
  await waitForFonts(page);
  // The session's own first token was fetched as the app started: it is not one of the writes'.
  expect(calls).toContain('GET /api/auth/csrf');
  calls.length = 0;
  return calls;
}

test.describe('a trainee’s program of TB Gym’s (notes plan N9c4)', () => {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px it offers Start now on a later session of this week and TB Gym’s programs at its foot`, async ({
      page,
    }) => {
      await openHouseProgram(page, width, height);

      const week = page.locator('section[aria-labelledby="focus-heading"]');
      const startNow = week.getByRole('button', { name: START_NOW_UPPER_B });
      await expect(startNow).toBeVisible();
      await expect(startNow).toHaveText('Start now, Upper B');
      await expect(page.locator('[data-start-early]')).toHaveCount(1);
      await expect(week.locator('.session').nth(3).getByRole('button')).toHaveCount(0);
      // Today's session leads, as for anyone.
      await expect(
        page.locator('.hero').getByRole('link', { name: 'Start workout' }),
      ).toBeVisible();

      const programs = page.getByRole('link', { name: 'TB Gym’s programs' });
      await expect(programs).toHaveCount(1);
      await expect(programs).toHaveAttribute('href', '/training/house-programs');
      await expect(page.locator('.house-next')).toContainText('See what’s next');
      // Beside a program a trainee starts no workout of their own; history stands.
      await expect(page.locator('[data-start-own], [data-start-from]')).toHaveCount(0);
      await expect(page.locator('.history-item')).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c4-training-house-${width}.png`),
        fullPage: true,
      });
      // The week alone, Start now in view (a full page puts the tab bar over it).
      await week.screenshot({
        path: test.info().outputPath(`n9c4-training-start-now-${width}.png`),
      });

      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expectNoHorizontalOverflow(page);
      await expect(startNow).toBeVisible();
    });
  }

  test('Start now starts the session after a fresh token and opens the player on it', async ({
    page,
  }) => {
    const sent: unknown[] = [];
    const calls = await openHouseProgram(page, 390, 844, {
      extra: {
        'POST /api/training/me/sessions/s7/start': (route: Route) => {
          sent.push(route.request().postDataJSON());
          return json(route, 200, {
            id: 'w-s7',
            status: 'InProgress',
            version: 1,
            startedAtUtc: '2026-09-30T08:00:00Z',
            completedAtUtc: null,
          });
        },
        'GET /api/training/me/today': (route: Route) => json(route, 200, startedEarly),
      },
    });

    expect(calls).not.toContain('GET /api/auth/csrf');

    await page.getByRole('button', { name: START_NOW_UPPER_B }).click();

    await expect(page).toHaveURL('/training/today?sessionId=s7');
    await expect(page.getByRole('heading', { level: 1, name: 'Upper B' })).toBeVisible();
    // Nothing was asked first.
    expect(sent).toEqual([{}]);
    // A token fetched after the press, before the write: the app's first one was cleared on load.
    const start = calls.indexOf('POST /api/training/me/sessions/s7/start');
    expect(start).toBeGreaterThan(-1);
    expect(calls.slice(0, start)).toContain('GET /api/auth/csrf');
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([
      'POST /api/training/me/sessions/s7/start',
    ]);
  });

  test.describe('a start the server refuses', () => {
    test.use({
      allowedConsoleErrors: {
        patterns: [/status of 409 .*\/api\/training\/me\/sessions\/s7\/start/],
      },
    });

    test('is said under the session, and the page stays', async ({ page }) => {
      await openHouseProgram(page, 390, 844, {
        extra: {
          'POST /api/training/me/sessions/s7/start': (route: Route) =>
            json(route, 409, { code: 'program_plan_closed', message: 'Server wording' }),
        },
      });

      await page.getByRole('button', { name: START_NOW_UPPER_B }).click();

      const session = page.locator('section[aria-labelledby="focus-heading"] .session').nth(2);
      await expect(session.getByRole('alert')).toHaveText(CLOSED_WORDS);
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expect(page).toHaveURL('/training/program');
      await expect(page.getByRole('button', { name: START_NOW_UPPER_B })).toBeEnabled();
      await expectNoHorizontalOverflow(page);
      await axe(page);
    });
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px a program whose plan stopped says its sessions are closed and offers nothing new, in the dark too`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openHouseProgram(page, width, height, { planGrants: false });

      const hero = page.locator('.hero');
      await expect(hero.locator('[data-plan-closed]')).toHaveText(CLOSED_WORDS);
      await expect(hero.getByRole('link')).toHaveCount(0);
      await expect(hero.getByRole('button')).toHaveCount(0);
      const week = page.locator('section[aria-labelledby="focus-heading"]');
      await expect(week.getByRole('link')).toHaveCount(0);
      await expect(page.locator('[data-start-early]')).toHaveCount(0);
      await page.getByRole('button', { name: /Week 2/ }).click();
      await expect(page.locator('#week-2 .session.is-Missed')).toBeVisible();
      await expect(page.getByRole('button', { name: /Do it now/ })).toHaveCount(0);
      // TB Gym's programs stay in reach, and with no program running a workout of their own.
      await expect(page.getByRole('link', { name: 'TB Gym’s programs' })).toHaveAttribute(
        'href',
        '/training/house-programs',
      );
      await expect(
        page.locator('.house-next').getByRole('button', { name: 'Start a workout' }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c4-training-closed-${width}-dark.png`),
        fullPage: true,
      });
    });
  }

  test('beside a finished program a trainee starts a workout of their own from its foot, and from history', async ({
    page,
  }) => {
    const sent: unknown[] = [];
    const view = started(null);
    const finished = programView();
    finished.program!.phase = 'Finished';
    finished.program!.currentWeekNumber = null;
    await openHouseProgram(page, 390, 844, {
      extra: {
        'GET /api/training/me/program': (route: Route) => json(route, 200, finished),
        'POST /api/training/me/workouts': (route: Route) => {
          sent.push(route.request().postDataJSON());
          return json(route, 200, view);
        },
        // The player's reads, once it opens on the workout just started.
        'GET /api/training/me/today': (route: Route) =>
          json(route, 200, {
            isAllowed: true,
            accessReason: 'Granted',
            localDate: '2026-09-30',
            workouts: [],
            ownWorkout: view,
          }),
        'GET /api/training/me/upcoming': (route: Route) => json(route, 200, upcoming(false)),
      },
    });

    await expect(page.locator('.hero-eyebrow')).toHaveText('Program finished');
    const foot = page.locator('.house-next');
    await expect(foot.getByRole('button', { name: 'Start a workout' })).toBeVisible();
    await expect(foot.getByRole('link', { name: 'Browse exercises' })).toHaveAttribute(
      'href',
      '/training/pool',
    );
    await expect(foot.getByRole('link', { name: 'TB Gym’s programs' })).toHaveAttribute(
      'href',
      '/training/house-programs',
    );
    await expect(page.locator('.history-item [data-start-from]')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: test.info().outputPath('n9c4-training-finished-own-390.png'),
      fullPage: true,
    });

    await foot.getByRole('button', { name: 'Start a workout' }).click();

    await expect(page).toHaveURL('/training/today?sessionId=own-new');
    await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
    expect(sent).toEqual([{}]);
  });

  test('a coach’s client’s Training never asks about a plan behind the program, nor links TB Gym’s programs', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (request) => calls.push(new URL(request.url()).pathname));
    await openTraining(page, 390, 844);

    await expect(page.locator('.hero').getByRole('link', { name: 'Start workout' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'TB Gym’s programs' })).toHaveCount(0);
    expect(calls).toContain('/api/client-profile/me');
    expect(calls).not.toContain('/api/training/me/upcoming');
  });
});

test.describe('a start the server refuses', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [
        /status of 409 .*\/api\/training\/me\/workouts/,
        /status of 500 .*\/api\/client-profile\/me/,
      ],
    },
  });

  test('one already in progress is said under the workout it was asked from, with Carry on', async ({
    page,
  }) => {
    await openTraineeTraining(page, 390, 844, {
      'POST /api/training/me/workouts': (route: Route) =>
        json(route, 409, {
          code: 'own_workout_in_progress',
          message:
            'You have a workout you have not finished. Carry on with it, or finish it first.',
        }),
    });
    const own = page.locator('.history-item').nth(0);

    await own.locator('[data-start-from]').click();

    const problem = own.locator('.own-problem');
    await expect(problem.getByRole('alert')).toHaveText(
      'You have a workout you haven’t finished. Carry on with it, or finish it first.',
    );
    await expect(problem.getByRole('link', { name: 'Carry on' })).toHaveAttribute(
      'href',
      '/training/today',
    );
    // Said once, where it was asked.
    await expect(page.locator('.own-problem')).toHaveCount(1);
    await expect(page).toHaveURL('/training/program');
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test('when the profile cannot say who reads, the page says only that workouts will start here', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSession(page, {
      memberships: [house],
      user,
      extra: {
        'GET /api/client-access/me': (route: Route) => json(route, 200, traineeDecisions),
        'GET /api/training/me/program': (route: Route) =>
          json(route, 200, programView({ program: null })),
        'GET /api/training/me/history': (route: Route) => json(route, 200, historyPage()),
        'GET /api/client-profile/me': (route: Route) => json(route, 500, { title: 'Server error' }),
      },
    });
    await page.goto('/training/program');

    await expect(page.getByRole('heading', { name: 'No workouts yet' })).toBeVisible();
    await expect(page.getByText('Your workouts will start here.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nothing assigned yet' })).toHaveCount(0);
    await expect(page.locator('[data-start-own], [data-start-from]')).toHaveCount(0);
    await expect(page.locator('.history-item')).toHaveCount(2);
  });
});
