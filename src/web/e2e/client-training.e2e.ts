import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type { CoachClientProgramView } from '../src/app/core/api/generated';
import {
  cancelledBlock,
  closedProgram,
  coachProgram,
  completedBlock,
  endedBlock,
  plannedBlock,
  runningBlock,
} from '../src/testing/client-program-fixtures';
import { COACH_NOW, MAYA, OWNER_ID } from '../src/testing/coach-today-fixtures';
import {
  library,
  maxPage,
  maxView,
  mayaMaxes,
  SQUAT,
  squatHistory,
} from '../src/testing/client-strength-fixtures';
import {
  chartSet,
  exerciseView,
  leanProgram,
  sessionView,
  setView,
  weekView,
} from '../src/testing/mesocycle-fixtures';
import {
  clipGrant,
  clipState,
  demoHandlers,
  expectClipProperties,
  expectLoops,
  expectPlaying,
  recordClip,
  watchMedia,
} from './demo-clip-support';
import { chooseDay, chooseOption } from './kit-controls';
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
import { docsPicture } from './docs-pictures';

/**
 * A client's Training (R3.4a) in a real browser: Karim, owner of Atlas Performance, on Thu 1 Oct
 * 2026 at 15:00 in Beirut, reading Maya Fakhoury's program. The page clock is pinned. Every read the
 * page makes is answered, so the console guard stays meaningful.
 */
const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };
const ID = MAYA.clientProfileId;
const BLOCK = 'block-lean';

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
  coachNotes: null,
  onboardingStatus: 'Completed',
  onboardingCompletedAtUtc: '2026-07-14T09:00:00Z',
  isCoachBlocked: false,
  version: 3,
  assignedCoachUserId: MAYA.assignedCoachUserId,
  assignedCoachName: 'Lea Khoury',
  release: null,
};

function commercial(overrides: Record<string, unknown> = {}) {
  return {
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
        ...overrides,
      },
    ],
  };
}

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

/** What the session sheet reads: the program in full, with the prescription of Maya's session today. */
const blockDetail = {
  id: BLOCK,
  loadUnit: 'Kilogram',
  weeks: [
    {
      id: `${BLOCK}-week3`,
      weekNumber: 3,
      sessions: [
        {
          id: `${BLOCK}-s33`,
          name: 'Lower B',
          coachNotes: 'Brace before every rep. Leave one rep in the tank on the last set.',
          exercises: [
            {
              id: 'ex-1',
              exerciseName: 'Back Squat',
              coachNotes: null,
              mediaAssetIds: ['squat-demo'],
              sets: [
                { repetitionsMinimum: 5, repetitionsMaximum: 5, prescribedLoad: 60, targetRpe: 8 },
                { repetitionsMinimum: 5, repetitionsMaximum: 5, prescribedLoad: 60, targetRpe: 8 },
                { repetitionsMinimum: 5, repetitionsMaximum: 5, prescribedLoad: 60, targetRpe: 8 },
              ],
            },
            {
              id: 'ex-2',
              exerciseName: 'Romanian Deadlift',
              coachNotes: 'Hips back, soft knees.',
              sets: [
                {
                  repetitionsMinimum: 8,
                  repetitionsMaximum: 10,
                  prescribedLoad: 62.5,
                  targetRpe: 7.5,
                },
                {
                  repetitionsMinimum: 8,
                  repetitionsMaximum: 10,
                  prescribedLoad: 62.5,
                  targetRpe: 7.5,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const templates = {
  total: 2,
  skip: 0,
  take: 100,
  items: [
    {
      id: 'template-1',
      name: 'Lean & Strong · Phase 3',
      currentVersionNumber: 1,
      isArchived: false,
      version: 1,
      versions: [
        {
          id: 'version-1',
          versionNumber: 1,
          name: 'Lean & Strong · Phase 3',
          isPublished: true,
          weekCount: 6,
          createdAtUtc: '2026-09-20T09:00:00Z',
        },
      ],
    },
    {
      id: 'template-2',
      name: 'Full Body Reset',
      currentVersionNumber: 2,
      isArchived: false,
      version: 1,
      versions: [
        {
          id: 'version-2',
          versionNumber: 2,
          name: 'Full Body Reset',
          isPublished: true,
          weekCount: 4,
          createdAtUtc: '2026-09-21T09:00:00Z',
        },
      ],
    },
  ],
};

/** Phase 3 works its loads out from a training max for the back squat. */
const versionDetail = {
  id: 'version-1',
  templateId: 'template-1',
  versionNumber: 1,
  name: 'Lean & Strong · Phase 3',
  description: null,
  isPublished: true,
  weeks: [
    {
      id: 'v1-w1',
      weekNumber: 1,
      sessions: [
        {
          id: 'v1-s1',
          name: 'Lower A',
          exercises: [
            {
              exerciseId: 'ex-squat',
              exerciseName: 'Back Squat',
              sets: [{ loadStrategy: 'PercentageWorkingMax' }],
            },
          ],
        },
      ],
    },
  ],
};

const maxes = {
  total: 1,
  skip: 0,
  take: 100,
  items: [
    {
      id: 'max-1',
      clientProfileId: ID,
      exerciseId: 'ex-squat',
      exerciseName: 'Back Squat',
      kind: 'CoachWorkingMax',
      value: 70,
      unit: 'Kilogram',
      effectiveDate: '2026-09-14',
      source: 'Manual',
      methodKey: 'CoachEntry',
      methodVersion: '1.0',
      sourceWorkoutExecutionId: null,
      note: null,
      createdAtUtc: '2026-09-14T09:00:00Z',
    },
  ],
};

/** The running program's own training maxes (P2): the squat as recorded, the bench retested since. */
function maxesView(overrides: Record<string, unknown> = {}) {
  return {
    mesocycleId: BLOCK,
    version: 4,
    loadUnit: 'Kilogram',
    loadIncrement: 2.5,
    isClosed: false,
    maxes: [
      {
        exerciseId: 'ex-squat',
        exerciseName: 'Back Squat',
        current: {
          id: 'max-1',
          value: 70,
          unit: 'Kilogram',
          source: 'SavedMax',
          basis: null,
          effectiveFromWeek: 1,
          setOn: '2026-09-14',
          reason: 'Assignment training max.',
        },
        weekOneSet: { repetitions: 5, rpe: 8, load: 55 },
        earlier: [],
      },
      {
        exerciseId: 'ex-bench',
        exerciseName: 'Bench Press',
        current: {
          id: 'max-3',
          value: 52.5,
          unit: 'Kilogram',
          source: 'Typed',
          basis: null,
          effectiveFromWeek: 3,
          setOn: '2026-09-28',
          reason: 'Retested on Mon 28 Sep.',
        },
        weekOneSet: null,
        earlier: [
          {
            id: 'max-2',
            value: 50,
            unit: 'Kilogram',
            source: 'SavedMax',
            basis: null,
            effectiveFromWeek: 1,
            setOn: '2026-09-14',
            reason: 'Assignment training max.',
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** What changing the squat's max to 75 kg would do from week 3 on: four weights in two sessions. */
const maxesPreview = {
  previewHash: 'hash-1',
  loadUnit: 'Kilogram',
  effectiveFromWeek: 3,
  lifts: [
    {
      exerciseId: 'ex-squat',
      exerciseName: 'Back Squat',
      previousValue: 70,
      newValue: 75,
      unit: 'Kilogram',
      source: 'Typed',
      basis: null,
      explanation: 'Typed by the coach: 75 kg.',
    },
  ],
  sets: [3, 4].flatMap((week) =>
    [0, 1].map((position) => ({
      setId: `set-${week}-${position}`,
      weekNumber: week,
      scheduledDate: week === 3 ? '2026-10-01' : '2026-10-08',
      sessionId: `session-${week}`,
      sessionName: 'Lower B',
      exerciseId: 'ex-squat',
      exerciseName: 'Back Squat',
      setPosition: position,
      repetitions: 5,
      targetRpe: 8,
      percentageWorkingMax: null,
      previousLoad: 60,
      newLoad: 65,
      explanation:
        'WorkingMaxLoad v2: 75 kg / (1 + (5 reps + 2 in reserve) / 30) = 60.811 kg. Rounded to the nearest 2.5 kg: 62.5 kg.',
    })),
  ),
  changedSetCount: 4,
  unchangedSetCount: 0,
  sessionCount: 2,
  keptSessionCount: 3,
};

type Handlers = Record<string, (route: Route) => unknown>;

interface OpenOptions {
  path?: string;
  /** A sheet that opens with the page hides the page from assistive technology, heading included. */
  opensSheet?: boolean;
  /** The page's heading, when a test gives the client another name. */
  heading?: string;
  /** The program reads in order; the last one repeats. */
  programs?: CoachClientProgramView[];
  enrollment?: Record<string, unknown>;
  /** What the running program's training maxes read answers. */
  maxes?: Record<string, unknown>;
  extra?: Handlers;
  requests?: { method: string; path: string; body: unknown }[];
}

async function openTraining(page: Page, width: number, height: number, options: OpenOptions = {}) {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  const programs = options.programs ?? [coachProgram()];
  let reads = 0;
  const handlers: Handlers = {
    [`GET /api/clients/${ID}`]: (route) => json(route, 200, clientDetails),
    // The client's header reads what waits for the coach; nothing does here.
    [`GET /api/clients/${ID}/overview`]: (route) => json(route, 200, { attention: [] }),
    [`GET /api/commercial/clients/${ID}`]: (route) =>
      json(route, 200, commercial(options.enrollment)),
    'GET /api/workspace': (route) => json(route, 200, workspace),
    [`GET /api/training/clients/${ID}/program`]: (route) =>
      json(route, 200, programs[Math.min(reads++, programs.length - 1)]),
    [`GET /api/training/mesocycles/${BLOCK}`]: (route) => json(route, 200, blockDetail),
    'GET /api/training/templates': (route) => json(route, 200, templates),
    'GET /api/training/template-versions/version-1': (route) => json(route, 200, versionDetail),
    [`GET /api/strength/clients/${ID}/maxes`]: (route) => json(route, 200, maxes),
    // Assign program starts from the latest program's maxes (STR-014); none unless a test says so.
    [`GET /api/training/clients/${ID}/previous-maxes`]: (route) =>
      json(route, 200, {
        mesocycleId: null,
        programName: null,
        lastDay: null,
        loadUnit: null,
        maxes: [],
      }),
    // Every program the coach can open reads its own training maxes (P2).
    ...Object.fromEntries(
      [...new Set(programs.flatMap((program) => program.blocks.map((block) => block.id)))].map(
        (id) => [
          `GET /api/training/mesocycles/${id}/training-maxes`,
          (route: Route) =>
            json(
              route,
              200,
              id === BLOCK ? maxesView(options.maxes) : maxesView({ mesocycleId: id, maxes: [] }),
            ),
        ],
      ),
    ),
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
  await page.goto(options.path ?? `/clients/${ID}/training`);
  if (options.opensSheet) {
    await expect(page.getByRole('dialog')).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { level: 1, name: options.heading ?? 'Maya Fakhoury' }),
    ).toBeVisible();
  }
  await waitForFonts(page);
}

/** A filled max row in Assign program folds to its name and number (critique B7a); this opens it. */
async function openMax(sheet: Locator, lift: string) {
  const row = sheet.locator('app-disclosure.max', { hasText: lift });
  const open = await row
    .locator('details')
    .evaluate((details) => (details as HTMLDetailsElement).open);
  if (!open) await row.locator('summary').click();
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

const EVERYTHING = coachProgram([runningBlock(), plannedBlock(), endedBlock()]);

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Training at ${width}px draws the program as a timeline and passes axe`, async ({
    page,
  }) => {
    await openTraining(page, width, height, { programs: [EVERYTHING] });

    await expect(page).toHaveTitle('Client training | TB Gym');
    await expect(page.locator('.eyebrow')).toHaveText('Week 3 of 6');
    await expect(page.locator('#program-title')).toHaveText('Lean & Strong · Phase 2');
    await expect(page.locator('.facts li')).toHaveText([
      'Mon 14 Sep – Sun 25 Oct',
      '9 of 24 workouts done',
      '1 missed',
    ]);
    await expect(page.locator('.week.current h3')).toHaveText('Week 3');
    await expect(page.locator('.week.current .now')).toHaveText('This week');

    if (width >= 768) {
      // Wide: every week side by side.
      await expect(page.locator('.week:visible')).toHaveCount(6);
      await expect(page.locator('.week-picker')).toBeHidden();
    } else {
      // A phone shows one week under a row of week numbers, starting on this week.
      await expect(page.locator('.week:visible')).toHaveCount(1);
      await expect(page.locator('.pick[aria-pressed="true"]')).toHaveText('3');
      await page.locator('.pick', { hasText: '5' }).click();
      await expect(page.locator('.week:visible h3')).toHaveText('Week 5');
      await page.locator('.pick', { hasText: '3' }).click();
    }

    // The current week's sessions say what happened, in words.
    await expect(page.locator('.week.current .s-mark')).toHaveText([
      'Done',
      'Done',
      'Today',
      'Upcoming',
    ]);
    // Other programs: the next one lined up, and the one that ended without closing.
    await expect(page.locator('.others .group')).toHaveText(['Current and next', 'Earlier']);
    await expect(page.locator('.others app-status-pill')).toHaveText([
      'Starts Mon 26 Oct',
      'Ended',
    ]);

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r34a-training-${width}.png`, fullPage: true });
  });
}

test('the Manage program menu opens on a key, moves with the arrows and closes on Escape', async ({
  page,
}) => {
  await openTraining(page, 1440, 900);
  const menu = page.getByRole('button', { name: 'Manage program' });

  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const items = page.locator('.hero-actions button.item');
  await expect(items.locator('.item-title')).toHaveText([
    'Assign program',
    'Rename program',
    'Build next block',
    'Edit weeks',
    'Reschedule',
    'Open every shared week now',
    'Close program',
    'Cancel program',
  ]);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  // What cannot be done says why, and does nothing when chosen.
  await expect(items.nth(4)).toHaveAttribute('aria-disabled', 'true');
  await expect(items.nth(4)).toContainText('Not possible once a workout has started');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-menu-1440.png' });

  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test('a session opens in a sheet that names it, holds focus and gives it back on Escape', async ({
  page,
}) => {
  await openTraining(page, 1440, 900);
  const session = page.locator('.week.current button.session').nth(2);

  await session.click();
  const sheet = page.getByRole('dialog', { name: 'Lower B' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Thu 1 Oct · Week 3');
  await expect(sheet).toContainText('Brace before every rep.');
  await expect(sheet.getByText('Back Squat', { exact: true })).toBeVisible();
  await expect(sheet).toContainText('3 × 5 reps · 60 kg · RPE 8');
  await expect(sheet).toContainText('2 × 8–10 reps · 62.5 kg · RPE 7.5');
  await expect(sheet.locator('summary')).toHaveText('Swap this workout');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-session-1440.png' });

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(session).toBeFocused();
});

test('a last time + step set reads its weight, then its step, in the session sheet (N6a)', async ({
  page,
}) => {
  // Explicit nulls where a step set has nothing, as the server sends them: no share, no effort.
  const step = {
    repetitionsMinimum: 10,
    repetitionsMaximum: 10,
    loadStrategy: 'LastTimeStep',
    loadUnit: 'Kilogram',
    directLoad: 7,
    prescribedLoad: 7,
    percentageWorkingMax: null,
    loadStep: 2,
    targetRpe: null,
  };
  const [week] = blockDetail.weeks;
  const [lowerB] = week.sessions;
  const detail = {
    ...blockDetail,
    weeks: [
      {
        ...week,
        sessions: [
          {
            ...lowerB,
            exercises: [
              ...lowerB.exercises,
              {
                id: 'ex-3',
                exerciseName: 'Goblet Squat',
                coachNotes: null,
                sets: [step, step, step],
              },
              {
                id: 'ex-4',
                exerciseName: 'Walking Lunge',
                coachNotes: null,
                sets: [
                  {
                    ...step,
                    repetitionsMinimum: 12,
                    repetitionsMaximum: 12,
                    directLoad: null,
                    prescribedLoad: null,
                    loadStep: 2.5,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  await openTraining(page, 1440, 900, {
    extra: { [`GET /api/training/mesocycles/${BLOCK}`]: (route) => json(route, 200, detail) },
  });

  await page.locator('.week.current button.session').nth(2).click();
  const sheet = page.getByRole('dialog', { name: 'Lower B' });
  await expect(sheet).toContainText('3 × 5 reps · 60 kg · RPE 8');
  await expect(sheet).toContainText('3 × 10 reps · 7 kg · last time + 2 kg');
  // No starting weight: the client picks it, so only the step is said.
  await expect(sheet).toContainText('12 reps · last time + 2.5 kg');
  await expect(sheet).not.toContainText('NaN');
  await axe(page);
});

/** The server's answer for one writing of a lift (LastTimeStep v1, STR-019), judged on Thu 1 Oct. */
function standing(exercisePrescriptionId: string, exerciseId: string, answer: object) {
  return {
    ruleKey: 'LastTimeStep',
    ruleVersion: 1,
    mesocycleId: BLOCK,
    sessionId: `${BLOCK}-s33`,
    sessionName: 'Lower B',
    sessionDate: '2026-10-01',
    exercisePrescriptionId,
    exerciseId,
    exerciseName: 'Goblet Squat',
    occurrence: 1,
    exertionDisplay: 'Rpe',
    standing: { judgedOn: '2026-10-01', ...answer },
  };
}

const goblet = {
  outcome: 'StepUp',
  reason: {
    kind: 'EverySetDone',
    day: '2026-09-29',
    setNumber: null,
    repetitions: null,
    repetitionsAsked: null,
    rpe: null,
    targetRpe: null,
    weight: null,
    earlierWeight: null,
    unit: null,
  },
  lastTime: {
    workoutExecutionId: `${BLOCK}-w31`,
    day: '2026-09-29',
    sets: [10, 10, 11].map((repetitions, index) => ({
      setNumber: index + 1,
      setType: 'Normal',
      repetitionsAsked: 10,
      targetRpe: null,
      prescribedWeight: 7,
      prescribedUnit: 'Kilogram',
      isCompleted: true,
      repetitions,
      weight: 7,
      unit: 'Kilogram',
      rpe: null,
    })),
  },
  sets: [1, 2, 3].map((setNumber) => ({
    setPrescriptionId: `step-${setNumber}`,
    setNumber,
    move: 'StepUp',
    weight: 9,
    currentWeight: 7,
    unit: 'Kilogram',
    step: 2,
    note: 'None',
  })),
};

const lungeHold = {
  outcome: 'Hold',
  reason: {
    ...goblet.reason,
    kind: 'RepsShort',
    setNumber: 1,
    repetitions: 10,
    repetitionsAsked: 12,
  },
  lastTime: null,
  sets: [{ ...goblet.sets[0], move: 'SameAsLastTime', weight: 20, currentWeight: 20, step: 2.5 }],
};

test('the session sheet says where each lift with a step stands for its coming session (N6b)', async ({
  page,
}) => {
  const step = {
    repetitionsMinimum: 10,
    repetitionsMaximum: 10,
    loadStrategy: 'LastTimeStep',
    loadUnit: 'Kilogram',
    directLoad: 7,
    prescribedLoad: 7,
    percentageWorkingMax: null,
    loadStep: 2,
    targetRpe: null,
  };
  const [week] = blockDetail.weeks;
  const [lowerB] = week.sessions;
  const detail = {
    ...blockDetail,
    weeks: [
      {
        ...week,
        sessions: [
          {
            ...lowerB,
            exercises: [
              ...lowerB.exercises,
              {
                id: 'ex-3',
                exerciseName: 'Goblet Squat',
                coachNotes: null,
                sets: [step, step, step],
              },
              {
                id: 'ex-4',
                exerciseName: 'Walking Lunge',
                coachNotes: null,
                sets: [{ ...step, repetitionsMinimum: 12, repetitionsMaximum: 12, loadStep: 2.5 }],
              },
            ],
          },
        ],
      },
    ],
    liftStandings: [
      standing('ex-3', 'goblet-squat', goblet),
      standing('ex-4', 'walking-lunge', lungeHold),
    ],
  };
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await openTraining(page, width, height, {
      extra: { [`GET /api/training/mesocycles/${BLOCK}`]: (route) => json(route, 200, detail) },
    });
    await page.locator('.week.current button.session').nth(2).click();
    const sheet = page.getByRole('dialog', { name: 'Lower B' });
    const lines = sheet.locator('.standing');
    await expect(lines).toHaveText([
      'Last 7 kg × 10, 10, 11 on Tue · every set done · next time 9 kg',
      'Same weight · set 1 reached 10 of 12 on Tue',
    ]);
    // A lift with no step says nothing new; the squat's own lines are as before.
    await expect(sheet.locator('.exercises > li').first().locator('.standing')).toHaveCount(0);
    await expect(sheet).not.toContainText('NaN');
    await axe(page);
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth))
      .toBe(true);
  }
});

test('a logged workout says where its lifts stand under them (N6b)', async ({ page }) => {
  const set = {
    prescriptionId: 'logged-set-1',
    performanceId: 'logged-perf-1',
    position: 1,
    setType: 'Normal',
    prescribedRepetitionsMinimum: 10,
    prescribedRepetitionsMaximum: 10,
    prescribedLoad: 7,
    prescribedLoadUnit: 'Kilogram',
    loadStrategy: 'LastTimeStep',
    loadStep: 2,
    prescribedTargetRpe: null,
    prescribedTargetRir: null,
    restSeconds: 90,
    tempo: null,
    coachNotes: null,
    actualRepetitions: 10,
    actualLoad: 7,
    actualLoadUnit: 'Kilogram',
    actualRpe: null,
    actualRir: null,
    isCompleted: true,
    clientNote: null,
  };
  const workout = {
    isAllowed: true,
    accessReason: 'Granted',
    nextNotesSkip: null,
    detail: {
      date: '2026-09-29',
      timeZoneId: 'Asia/Beirut',
      hasMoreNotes: false,
      workout: {
        sessionId: `${BLOCK}-s31`,
        mesocycleId: BLOCK,
        workoutExecutionId: `${BLOCK}-w31`,
        name: 'Lower A',
        coachNotes: null,
        status: 'Completed',
        executionVersion: 4,
        exercises: [
          {
            prescriptionId: 'logged-ex-1',
            performanceId: 'logged-ex-perf-1',
            prescribedExerciseId: 'goblet-squat',
            prescribedExerciseName: 'Goblet Squat',
            actualExerciseId: 'goblet-squat',
            actualExerciseName: 'Goblet Squat',
            wasSubstituted: false,
            modificationPolicy: 'Locked',
            alternatives: [],
            coachNotes: null,
            mediaAssetIds: [],
            previousPerformance: null,
            sets: [set, { ...set, prescriptionId: 'logged-set-2', position: 2 }],
          },
        ],
        notes: [],
      },
    },
    liftStandings: [standing('ex-3', 'goblet-squat', goblet)],
  };
  await openTraining(page, 1440, 900, {
    extra: {
      [`GET /api/training/clients/${ID}/workouts/${BLOCK}-w31`]: (route) =>
        json(route, 200, workout),
    },
  });

  await page.locator('.week.current button.session').nth(0).click();
  const sheet = page.getByRole('dialog', { name: 'Lower A' });
  await expect(sheet.locator('app-coach-workout .standing')).toHaveText(
    'Last 7 kg × 10, 10, 11 on Tue · every set done · next time 9 kg',
  );
  await axe(page);
});

/** What the server answers once the given lifts are applied (N6c), each set to its standing's weight. */
function appliedAnswer(views: ReturnType<typeof standing>[]) {
  return {
    clientProfileId: ID,
    lifts: views.map((view, index) => ({
      applicationId: `application-${index + 1}`,
      mesocycleId: view.mesocycleId,
      sessionId: view.sessionId,
      sessionName: view.sessionName,
      sessionDate: view.sessionDate,
      exercisePrescriptionId: view.exercisePrescriptionId,
      exerciseId: view.exerciseId,
      exerciseName: view.exerciseName,
      sets: (view.standing as typeof goblet).sets
        .filter((set) => set.weight !== set.currentWeight)
        .map((set) => ({
          setPrescriptionId: set.setPrescriptionId,
          setNumber: set.setNumber,
          move: set.move,
          weightBefore: set.currentWeight,
          weightAfter: set.weight,
          unit: set.unit,
          step: set.step,
        })),
      appliedAtUtc: '2026-10-01T12:00:00Z',
    })),
  };
}

// The goblet squat steps 7 → 9 kg on Lower B, and the walking lunge keeps last time's 20 kg over the 25 kg the
// session has (line d, decision 22): two weights to apply, first on Maya's Training tab.
const lungeKept = {
  ...lungeHold,
  lastTime: { ...goblet.lastTime, sets: [{ ...goblet.lastTime.sets[0], weight: 20 }] },
  sets: [{ ...lungeHold.sets[0], weight: 20, currentWeight: 25 }],
};
const toApply = () => [
  standing('ex-3', 'goblet-squat', goblet),
  { ...standing('ex-4', 'walking-lunge', lungeKept), exerciseName: 'Walking Lunge' },
];

test('the Training tab lists the weights to apply first and applies them all in one request (N6c)', async ({
  page,
}) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const requests: { method: string; path: string; body: unknown }[] = [];
    await openTraining(page, width, height, {
      programs: [
        coachProgram(undefined, { liftStandings: toApply() }),
        // Read again after the apply: nothing left to apply.
        coachProgram(undefined, { liftStandings: [] }),
      ],
      requests,
      extra: {
        [`POST /api/training/clients/${ID}/lift-weights/apply`]: (route) =>
          json(route, 200, appliedAnswer(toApply())),
      },
    });

    const panel = page.locator('app-program-weights');
    await expect(panel.getByRole('heading', { name: 'Weights to apply' })).toBeVisible();
    // Before the program itself: the coach's homework for this client.
    expect(
      await page
        .locator('.program')
        .evaluate((element) => element.firstElementChild?.tagName.toLowerCase()),
    ).toBe('app-program-weights');
    await expect(panel.locator('.standing')).toHaveText([
      'Last 7 kg × 10, 10, 11 on Tue · every set done · next time 9 kg',
      'Keep 20 kg · set 1 reached 10 of 12 on Tue',
    ]);
    await expect(panel.getByRole('button', { name: /^Apply 9 kg to Goblet Squat/ })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: /^Apply 20 kg to Walking Lunge/ }),
    ).toBeVisible();
    await axe(page);
    await expectNoHorizontalOverflow(page);

    await panel.getByRole('button', { name: 'Apply all 2 weights' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 weights applied.' })).toHaveText(
      '2 weights applied. Maya sees each on its workout.',
    );
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#program-title')).toBeFocused();
    const applies = requests.filter((request) => request.path.endsWith('/lift-weights/apply'));
    expect(applies).toHaveLength(1);
    expect(applies[0].body).toEqual({
      idempotencyKey: expect.any(String),
      lifts: [
        {
          exercisePrescriptionId: 'ex-3',
          sets: [1, 2, 3].map((n) => ({
            setPrescriptionId: `step-${n}`,
            currentWeight: 7,
            weight: 9,
          })),
        },
        {
          exercisePrescriptionId: 'ex-4',
          sets: [{ setPrescriptionId: 'step-1', currentWeight: 25, weight: 20 }],
        },
      ],
    });
  }
});

test('the weights to apply follow dark mode and read right to left (N6c)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await useRtl(page);
  await openTraining(page, 390, 844, {
    programs: [coachProgram(undefined, { liftStandings: toApply() })],
  });
  const panel = page.locator('app-program-weights');
  await expect(panel.getByRole('heading', { name: 'Weights to apply' })).toBeVisible();
  await axe(page);
  await expectNoHorizontalOverflow(page);
});

test('Review weights from Today brings Weights to apply into view, with the focus on it (N6d)', async ({
  page,
}) => {
  // A short phone window puts the panel below the fold, so it is brought up; at 1440 it is in the first screen.
  for (const [width, height] of [
    [390, 560],
    [1440, 900],
  ]) {
    await openTraining(page, width, height, {
      path: `/clients/${ID}/training?action=weights`,
      programs: [coachProgram(undefined, { liftStandings: toApply() })],
    });

    const heading = page.locator('#weights-title');
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    // The word leaves the address, so Back and a reload do not do it again, and the router's own scroll to the top
    // on that change does not undo the panel's.
    await expect(page).toHaveURL(new RegExp(`/clients/${ID}/training$`));
    const box = await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, middle: rect.top + rect.height / 2, scrolled: window.scrollY };
    });
    // Below the sticky top bar, not under it.
    expect(box.top).toBeGreaterThan(64);
    if (width === 390) {
      expect(box.scrolled).toBeGreaterThan(0);
      expect(Math.abs(box.middle - height / 2)).toBeLessThan(80);
    }
    await expect(page.getByRole('status').filter({ hasText: 'Nothing is left' })).toHaveCount(0);
    await axe(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/n6d-training-arrival-${width}.png` });
  }
});

test('Review weights says when nothing is left to apply, on the program’s title (N6d)', async ({
  page,
}) => {
  await openTraining(page, 390, 844, {
    path: `/clients/${ID}/training?action=weights`,
    programs: [coachProgram(undefined, { liftStandings: [] })],
  });

  await expect(page.locator('app-program-weights')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Nothing is left' })).toHaveText(
    'Nothing is left to apply for Maya now.',
  );
  await expect(page.locator('#program-title')).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/clients/${ID}/training$`));
  await axe(page);
});

test.describe('an apply the server refused (N6c)', () => {
  // The browser logs the 409 the page was deliberately given; nothing else may be logged.
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\//] } });

  test('a session sheet applies one lift’s weight and says so, and a conflict asks to read again (N6c)', async ({
    page,
  }) => {
    const step = {
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      loadStrategy: 'LastTimeStep',
      loadUnit: 'Kilogram',
      directLoad: 7,
      prescribedLoad: 7,
      percentageWorkingMax: null,
      loadStep: 2,
      targetRpe: null,
    };
    const [week] = blockDetail.weeks;
    const [lowerB] = week.sessions;
    const withGoblet = (liftStandings: unknown[]) => ({
      ...blockDetail,
      weeks: [
        {
          ...week,
          sessions: [
            {
              ...lowerB,
              exercises: [
                ...lowerB.exercises,
                {
                  id: 'ex-3',
                  exerciseName: 'Goblet Squat',
                  coachNotes: null,
                  sets: [step, step, step],
                },
              ],
            },
          ],
        },
      ],
      liftStandings,
    });
    const reads = [withGoblet([standing('ex-3', 'goblet-squat', goblet)]), withGoblet([])];
    let refuse = true;
    await openTraining(page, 1440, 900, {
      extra: {
        [`GET /api/training/mesocycles/${BLOCK}`]: (route) =>
          json(route, 200, reads.length > 1 ? reads.shift() : reads[0]),
        [`POST /api/training/clients/${ID}/lift-weights/apply`]: (route) => {
          if (refuse) {
            refuse = false;
            return json(route, 409, {
              code: 'lift_standing_changed',
              message:
                'Where this lift stands changed since it was read. Read it again, then apply.',
            });
          }
          return json(route, 200, appliedAnswer([standing('ex-3', 'goblet-squat', goblet)]));
        },
      },
    });

    await page.locator('.week.current button.session').nth(2).click();
    const sheet = page.getByRole('dialog', { name: 'Lower B' });
    const apply = sheet.getByRole('button', { name: 'Apply 9 kg to Goblet Squat, Lower B today' });
    await expect(apply).toHaveText('Apply 9 kg');

    // First the server says the lift changed: the sheet says so, under the lift, and reads it again.
    reads.unshift(withGoblet([standing('ex-3', 'goblet-squat', goblet)]));
    await apply.click();
    await expect(sheet.getByRole('alert')).toHaveText(
      'Where a lift stands changed since this was read. It has been read again: check it, then apply.',
    );

    await sheet.getByRole('button', { name: 'Apply 9 kg to Goblet Squat, Lower B today' }).click();
    const status = sheet.locator('.applied');
    await expect(status).toHaveText(
      'Goblet Squat is now 9 kg today. Maya sees it on that workout.',
    );
    await expect(status).toBeFocused();
    await expect(sheet.locator('.apply button')).toHaveCount(0);
    await axe(page);
  });
});

test('an exercise’s demo opens over the session sheet, as Maya was given it (P4)', async ({
  page,
}) => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await openTraining(page, 390, 844, {
    extra: {
      'POST /api/media/squat-demo/access': (route: Route) =>
        json(route, 200, {
          assetId: 'squat-demo',
          kind: 'Image',
          source: 'Upload',
          contentType: 'image/png',
          url: pixel,
          expiresAtUtc: '2026-10-01T13:00:00Z',
          downloadAllowed: true,
        }),
    },
  });

  await page.locator('.week.current button.session').nth(2).click();
  const sheet = page.getByRole('dialog', { name: 'Lower B' });
  // Only the exercise with a demo offers one.
  await expect(sheet.getByRole('button', { name: 'Watch demo' })).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Watch demo' }).click();

  const demo = page.getByRole('dialog', { name: 'Back Squat' });
  await expect(demo.getByRole('img', { name: 'How to do Back Squat' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4-session-demo-390.png' });

  await page.keyboard.press('Escape');
  await expect(demo).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

// Notes plan N9b4, C20's fourth slice: an uploaded video plays like a GIF in the demo sheet too, muted,
// looping and inline, with the browser's controls kept so a coach can turn the sound on. It starts by
// itself only for a person who has not asked for reduced motion, and nothing is asked before the press.
test.describe('an uploaded video demo over the session sheet (N9b4)', () => {
  /** A one-second WebM each worker records itself: nothing is committed (the repo is public). */
  let clip: Buffer;
  test.beforeAll(async ({ browser }) => {
    clip = await recordClip(browser);
  });

  for (const motion of ['no-preference', 'reduce'] as const) {
    const title =
      motion === 'reduce'
        ? 'under reduced motion it is muted and looping with its controls, and waits to be played'
        : 'it plays by itself, muted, looping and inline, with its controls';
    test(title, async ({ page }) => {
      // Mocked checks run with reduced motion; the clips read it once, as the page starts.
      if (motion === 'no-preference') await page.emulateMedia({ reducedMotion: 'no-preference' });
      const media = watchMedia(page);
      await openTraining(page, 390, 844, {
        // The demo's own grant on the press, and its bytes from the grant's address.
        extra: demoHandlers(clip, [clipGrant('squat-demo')]),
      });

      await page.locator('.week.current button.session').nth(2).click();
      const sheet = page.getByRole('dialog', { name: 'Lower B' });
      await expect(sheet.getByRole('button', { name: 'Watch demo' })).toHaveCount(1);
      // The session sheet asks for nothing until the demo is pressed.
      expect(media).toEqual([]);
      await sheet.getByRole('button', { name: 'Watch demo' }).click();

      const demo = page.getByRole('dialog', { name: 'Back Squat' });
      const video = demo.locator('video');
      await expect(video).toHaveAttribute('src', '/api/media/squat-demo/content');
      await expect(video).toHaveAttribute('aria-label', 'How to do Back Squat');
      await expect(video).toHaveAttribute('controlslist', 'nodownload');
      await expectClipProperties(video, { controls: true });
      if (motion === 'no-preference') {
        await expect(video).toHaveJSProperty('autoplay', true);
        await expectPlaying(video);
        await expectLoops(video);
      } else {
        // It loads its first data, and never starts by itself; the browser's own play is the press.
        await expect(video).toHaveJSProperty('autoplay', false);
        await expect
          .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
          .toBeGreaterThanOrEqual(1);
        await expect(video).toHaveJSProperty('paused', true);
        expect((await clipState(video)).played, 'it has not played by itself').toBe(0);
      }
      // The demo's own grant, asked on the press, then its bytes: never the batch.
      expect(media[0]).toMatchObject({ method: 'POST', path: '/api/media/squat-demo/access' });
      expect(media.slice(1)).not.toEqual([]);
      expect(
        media.slice(1).every((request) => request.path === '/api/media/squat-demo/content'),
        JSON.stringify(media),
      ).toBe(true);
      await expectNoHorizontalOverflow(page);
      await axe(page);

      await page.keyboard.press('Escape');
      await expect(demo).toHaveCount(0);
      await expect(sheet).toBeVisible();
    });
  }
});

test('Assign program opens from the address, asks for a training max, and sends what was chosen', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, {
    path: `/clients/${ID}/training?action=assign`,
    opensSheet: true,
    requests,
    programs: [coachProgram([runningBlock()]), coachProgram([runningBlock(), plannedBlock()])],
    extra: {
      [`POST /api/training/clients/${ID}/mesocycles`]: (route) =>
        json(route, 200, {
          id: 'block-next',
          name: 'Lean & Strong · Phase 3',
          startDate: '2026-10-26',
        }),
    },
  });

  const sheet = page.getByRole('dialog', { name: 'Assign program' });
  await expect(sheet).toBeVisible();
  // The word is taken out of the address.
  await expect(page).toHaveURL(`/clients/${ID}/training`);
  await expect(sheet.locator('.plan-line')).toContainText(
    'Online Coaching · 12 weeks · 21 Jul – 13 Dec 2026',
  );

  // Nothing is sent until the form is complete, and the first problem takes focus.
  await sheet.getByRole('button', { name: 'Assign program' }).click();
  await expect(sheet.getByText('Choose a program.')).toBeVisible();
  await expect(sheet.getByLabel('Program', { exact: true })).toBeFocused();
  expect(requests).toEqual([]);

  await chooseOption(sheet, 'Program', 'Lean & Strong · Phase 3 · 6 weeks');
  // The back squat is worked out from a training max, which starts from the one recorded; the
  // filled row folds to its number and says why it is listed.
  await expect(sheet.locator('app-disclosure.max summary')).toContainText('Back Squat · 70 kg');
  await openMax(sheet, 'Back Squat');
  await expect(sheet.getByLabel('Back Squat', { exact: true })).toHaveValue('70');
  await expect(sheet.getByText('Your recorded training max')).toBeVisible();
  await chooseDay(sheet, 'Start date', '2026-10-26');
  await expect(sheet.locator('.run')).toHaveText('Runs Mon 26 Oct – Sun 6 Dec');
  // From its first day, unless the coach chooses Now (critique B18).
  await expect(sheet.getByRole('radio', { name: 'From its first day' })).toBeChecked();
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-assign-1440.png' });

  await sheet.getByRole('button', { name: 'Assign program' }).click();
  await expect(sheet).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: 'POST',
    path: `/api/training/clients/${ID}/mesocycles`,
    body: {
      enrollmentId: 'e-1',
      templateVersionId: 'version-1',
      startDate: '2026-10-26',
      kind: 'Primary',
      loadUnit: 'Kilogram',
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      workingMaxes: [
        { exerciseId: 'ex-squat', strengthMaxRecordId: 'max-1', value: 70, unit: 'Kilogram' },
      ],
      revealAllWeeks: false,
    },
  });
  // The program is read again, and the page says what happened.
  await expect(page.getByRole('status').filter({ hasText: 'is assigned to Maya' })).toBeVisible();
  await expect(page.locator('.others .row-name')).toHaveText(['Strength Base']);
});

test('sharing a week sends the program’s version, then reads it again', async ({ page }) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const shared = runningBlock();
  shared.weeks[4] = { ...shared.weeks[4], isShared: true };
  await openTraining(page, 1440, 900, {
    requests,
    programs: [coachProgram([runningBlock()]), coachProgram([shared])],
    extra: {
      [`PUT /api/training/mesocycles/${BLOCK}/weeks/${BLOCK}-week5/publish`]: (route) =>
        json(route, 200, {}),
    },
  });
  const week5 = page.locator('.week').nth(4);
  const box = week5.getByRole('checkbox', { name: 'Week 5: Shared with Maya' });

  await expect(box).not.toBeChecked();
  await box.check();

  await expect(
    page.getByRole('status').filter({ hasText: 'Week 5 is shared with Maya.' }),
  ).toBeVisible();
  expect(requests).toEqual([
    {
      method: 'PUT',
      path: `/api/training/mesocycles/${BLOCK}/weeks/${BLOCK}-week5/publish`,
      body: { isPublished: true, version: 4 },
    },
  ]);
  await expect(box).toBeChecked();
});

test.describe('a refused change', () => {
  // The browser logs the 400 the page was deliberately given; nothing else may be logged.
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 400 .*\/api\/training\/mesocycles/],
    },
  });

  test('cancelling a program asks why, and says what the server refused in coach words', async ({
    page,
  }) => {
    await openTraining(page, 1440, 900, {
      extra: {
        [`POST /api/training/mesocycles/${BLOCK}/cancel`]: (route) =>
          json(route, 400, {
            errors: { mesocycle: ['A mesocycle with a workout in progress cannot be cancelled.'] },
          }),
      },
    });

    await page.getByRole('button', { name: 'Manage program' }).click();
    await page.getByRole('button', { name: /^Cancel program/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel program' });
    await expect(dialog).toContainText('Maya stops seeing the workouts still to come.');

    await dialog.getByRole('button', { name: 'Cancel program' }).click();
    await expect(dialog.getByText('Say why, so it is on record.')).toBeVisible();
    await dialog.getByLabel('Why are you cancelling it?').fill('Client is travelling');
    await dialog.getByRole('button', { name: 'Cancel program' }).click();

    await expect(dialog.getByRole('alert')).toHaveText(
      'Maya has a workout open right now. Cancel the program once it is finished.',
    );
    await axe(page);
    await page.screenshot({ path: 'test-results/r34a-training-cancel-1440.png' });
  });
});

test('a lapsed plan says why the program is not shown, rather than showing none', async ({
  page,
}) => {
  await openTraining(page, 1440, 900, {
    programs: [closedProgram('Expired')],
    enrollment: { effectiveStatus: 'Expired', storedStatus: 'Expired' },
  });

  await expect(page.getByRole('heading', { level: 2, name: 'Training isn’t open' })).toBeVisible();
  await expect(
    page.getByText('Maya’s plan has ended, so their training isn’t shown.'),
  ).toBeVisible();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Service & access' })).toHaveAttribute(
    'href',
    `/clients/${ID}/service`,
  );
  await axe(page);
});

test('a client with no program is invited to assign one', async ({ page }) => {
  await openTraining(page, 1440, 900, { programs: [coachProgram([])] });

  await expect(page.getByRole('heading', { level: 2, name: 'No program yet' })).toBeVisible();
  await expect(page.locator('main .tb-button--filled')).toContainText(['Assign program']);
  await axe(page);
});

test('a finished program asks for the next one, and earlier ones can be opened', async ({
  page,
}) => {
  await openTraining(page, 1440, 900, {
    programs: [coachProgram([completedBlock(), cancelledBlock()])],
  });

  await expect(page.locator('.eyebrow')).toHaveText('Completed');
  await expect(
    page.locator('.hero-actions').getByRole('button', { name: 'Assign program' }),
  ).toBeVisible();
  // Nothing in a finished program can be changed.
  await expect(page.locator('.week input[type="checkbox"]:enabled')).toHaveCount(0);

  await page.locator('.others .row', { hasText: 'Summer Reset' }).click();
  await expect(page.locator('.eyebrow')).toHaveText('Cancelled');
  await expect(page.locator('.week .s-mark').last()).toHaveText('Cancelled');
  await axe(page);
});

/** Where Maya's finished program left the squat: 80 kg, set 2 Oct. */
const previousMaxes = {
  mesocycleId: 'block-done',
  programName: 'Strength Base',
  lastDay: '2026-10-04',
  loadUnit: 'Kilogram',
  maxes: [
    {
      exerciseId: 'ex-squat',
      exerciseName: 'Back Squat',
      maxId: 'snap-done',
      value: 80,
      unit: 'Kilogram',
      setOn: '2026-10-02',
    },
  ],
};

for (const [width, height, mode] of [
  [1440, 900, 'light'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
] as const) {
  test(`the next program starts where the last one ended, at ${width} px ${mode} (P4c)`, async ({
    page,
  }) => {
    if (mode === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
    const requests: { method: string; path: string; body: unknown }[] = [];
    await openTraining(page, width, height, {
      path: `/clients/${ID}/training?action=assign`,
      opensSheet: true,
      requests,
      programs: [coachProgram([completedBlock()])],
      extra: {
        [`GET /api/training/clients/${ID}/previous-maxes`]: (route) =>
          json(route, 200, previousMaxes),
        [`POST /api/training/clients/${ID}/mesocycles`]: (route) =>
          json(route, 200, {
            id: 'block-next',
            name: 'Lean & Strong · Phase 3',
            startDate: '2026-10-26',
          }),
      },
    });

    const sheet = page.getByRole('dialog', { name: 'Assign program' });
    await chooseOption(sheet, 'Program', 'Lean & Strong · Phase 3 · 6 weeks');
    // The 70 kg recorded on 14 Sep is older than where Strength Base left the squat. The filled row
    // folds to that number (critique B7a), and nothing suggests another (N10b).
    await expect(sheet.locator('app-disclosure.max summary')).toContainText('Back Squat · 80 kg');
    await openMax(sheet, 'Back Squat');
    const squat = sheet.getByLabel('Back Squat', { exact: true });
    await expect(squat).toHaveValue('80');
    await expect(sheet.getByText('Where Strength Base left it, set Fri 2 Oct')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Use / })).toHaveCount(0);
    await expect(sheet.getByText(/logged sets/)).toHaveCount(0);
    // In the middle of the sheet's body, as a coach scrolling to it would see it.
    await sheet
      .locator('app-disclosure.max')
      .evaluate((row) => row.scrollIntoView({ block: 'center' }));
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/p4c-next-assign-${width}-${mode}.png` });

    await chooseDay(sheet, 'Start date', '2026-10-26');
    await sheet.getByRole('button', { name: 'Assign program' }).click();
    await expect(sheet).toHaveCount(0);
    expect(requests[0]).toMatchObject({
      path: `/api/training/clients/${ID}/mesocycles`,
      body: {
        workingMaxes: [
          {
            exerciseId: 'ex-squat',
            strengthMaxRecordId: null,
            value: 80,
            unit: 'Kilogram',
            carriedFromMaxId: 'snap-done',
          },
        ],
      },
    });
    expect(JSON.stringify(requests[0].body)).not.toContain('loggedSetId');
  });
}

test('Training follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 1440, 900, { programs: [EVERYTHING] });

  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-dark-1440.png', fullPage: true });

  await page.locator('.week.current button.session').nth(2).click();
  await expect(page.getByRole('dialog', { name: 'Lower B' })).toBeVisible();
  await axe(page);
});

test('Training reads right to left', async ({ page }) => {
  await openTraining(page, 1440, 900, { programs: [EVERYTHING] });
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-rtl-1440.png', fullPage: true });
});

for (const width of [390, 1440]) {
  test(`Training reflows at 200% text at ${width}px`, async ({ page }) => {
    await openTraining(page, width, 900, { programs: [EVERYTHING] });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Manage program' })).toBeVisible();
    await expect(page.locator('.week.current button.session').first()).toBeVisible();
  });
}

// Critique B18: when the client sees a program that has not begun.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a program not begun says when the client sees it at ${width}px, at 200% text too`, async ({
    page,
  }) => {
    const requests: NonNullable<OpenOptions['requests']> = [];
    await openTraining(page, width, height, {
      programs: [
        coachProgram([plannedBlock({ enrollmentId: 'e-1' })]),
        coachProgram([
          plannedBlock({ enrollmentId: 'e-1', revealAllWeeks: true, isShownEarly: true }),
        ]),
      ],
      requests,
      extra: {
        'PUT /api/training/mesocycles/block-next/visibility': (route) => json(route, 200, {}),
      },
    });

    await page.getByRole('button', { name: 'Manage program' }).click();
    const item = page.locator('.hero-actions button.item', { hasText: 'The client sees it' });
    await expect(item).toContainText('From its first day');
    await item.click();
    const dialog = page.getByRole('dialog', { name: 'The client sees it' });
    await expect(dialog.getByRole('radio', { name: 'From its first day' })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Now' }).check();
    await expect(dialog).toContainText(
      'Maya reads the shared weeks now. Each workout opens on its day.',
    );
    await axe(page);
    await page.screenshot({ path: `test-results/b18-client-sees-${width}.png` });

    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await expect(dialog.getByRole('radio', { name: 'Now' })).toBeChecked();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Maya can read Strength Base now.' }),
    ).toBeVisible();
    await expect(page.locator('.hero .facts')).toContainText('Maya reads its shared weeks now');
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: '/api/training/mesocycles/block-next/visibility',
        body: { revealAllWeeks: true, version: 1 },
      },
    ]);
  });
}

// Critique B19: whether the client keeps seeing the programs that finished.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a coach chooses whether the client sees finished programs at ${width}px, at 200% text too`, async ({
    page,
  }) => {
    const requests: NonNullable<OpenOptions['requests']> = [];
    await openTraining(page, width, height, {
      programs: [
        coachProgram([completedBlock()]),
        coachProgram([completedBlock()], {
          finishedPrograms: { canSeeFinishedPrograms: false, version: 8 },
        }),
      ],
      requests,
      extra: {
        [`PUT /api/training/clients/${ID}/finished-programs`]: (route) =>
          json(route, 200, { canSeeFinishedPrograms: false, version: 8 }),
      },
    });

    const box = page.getByRole('checkbox', { name: 'Can see finished programs' });
    await expect(box).toBeChecked();
    await expect(box).toHaveAccessibleDescription(
      'Turn this off and Maya no longer sees finished programs on Training. Their running and next programs, logged workouts, records and progress stay.',
    );
    await axe(page);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/b19-choice-${width}.png` });

    await box.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Maya no longer sees finished programs.' }),
    ).toBeVisible();
    await expect(box).not.toBeChecked();
    await expect(box).toBeEnabled();
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: `/api/training/clients/${ID}/finished-programs`,
        body: { canSeeFinishedPrograms: false, version: 0 },
      },
    ]);

    await axe(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await expect(box).toBeVisible();
  });
}

test('the choice is not offered while training is closed', async ({ page }) => {
  await openTraining(page, 1440, 900, { programs: [closedProgram('Paused')] });
  await expect(page.getByRole('heading', { name: 'Training isn’t open' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Can see finished programs' })).toHaveCount(0);
});

test('a very long first name wraps in the choice’s line on a phone, nothing cut off', async ({
  page,
}) => {
  const firstName = 'Maximiliana'.repeat(6);
  await openTraining(page, 390, 844, {
    programs: [coachProgram([completedBlock()])],
    heading: `${firstName} Fakhoury`,
    extra: {
      [`GET /api/clients/${ID}`]: (route) => json(route, 200, { ...clientDetails, firstName }),
    },
  });

  const help = page.locator('.finished-help');
  await expect(help).toContainText(firstName);
  const { scroll, client } = await help.evaluate((line) => ({
    scroll: line.scrollWidth,
    client: line.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
});

// ------------------------------------------------------------------------------------------------
// P2: the program's own training maxes
// ------------------------------------------------------------------------------------------------

/** Week 1 of Phase 3 on the RTS chart: the squat's first working set is 5 reps at RPE 7. */
const versionWithChart = {
  ...versionDetail,
  weeks: [
    {
      id: 'v1-w1',
      weekNumber: 1,
      sessions: [
        {
          id: 'v1-s1',
          name: 'Lower A',
          dayOffset: 0,
          exercises: [
            {
              exerciseId: 'ex-squat',
              exerciseName: 'Back Squat',
              position: 1,
              sets: [
                {
                  position: 1,
                  setType: 'Normal',
                  loadStrategy: 'RpeChart',
                  repetitionsMaximum: 5,
                  targetRpe: 7,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the training maxes sit with the program at ${width}px and pass axe`, async ({ page }) => {
    await openTraining(page, width, height);

    const panel = page.locator('app-program-maxes');
    await expect(panel.getByRole('heading', { name: 'Training maxes' })).toBeVisible();
    await expect(panel.locator('.name')).toHaveText(['Back Squat', 'Bench Press']);
    await expect(panel.locator('.value')).toHaveText(['70 kg', '52.5 kg']);
    await expect(panel.locator('.source')).toHaveText([
      'From Maya’s recorded max · Mon 14 Sep',
      'Typed by you · Mon 28 Sep',
    ]);
    // The retested bench says how it moved and keeps the max it replaced, one tap away.
    await expect(panel.locator('.lift').nth(1).locator('.detail')).toHaveText([
      'Up 2.5 kg from 50 kg',
      'Applies from week 3. Earlier weeks keep 50 kg.',
    ]);
    await expect(panel.locator('summary')).toHaveText('Earlier maxes 1');
    await expect(
      panel.getByRole('button', { name: 'Update maxes for the coming weeks' }),
    ).toBeVisible();

    const box = await panel.boundingBox();
    const hero = await page.locator('.hero').boundingBox();
    if (width >= 1024) {
      // Wide: at the top right, level with the program's header.
      expect(box!.x).toBeGreaterThan(hero!.x + hero!.width - 1);
      expect(Math.abs(box!.y - hero!.y)).toBeLessThan(2);
    } else {
      // A phone: under the header, before the timeline.
      expect(box!.y).toBeGreaterThan(hero!.y + hero!.height - 1);
    }
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/p2-maxes-${width}.png`, fullPage: true });
  });
}

test('a program that works no weight out from a max keeps the whole width', async ({ page }) => {
  await openTraining(page, 1440, 900, { maxes: { maxes: [] } });

  await expect(page.locator('app-program-maxes')).not.toHaveAttribute('data-filled');
  await expect(page.locator('app-program-maxes section')).toHaveCount(0);
  await expect(page.locator('.hero')).toBeVisible();
});

test('updating a max shows every new weight first, then sends what was reviewed', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, {
    requests,
    programs: [coachProgram(), coachProgram()],
    extra: {
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
        json(route, 200, maxesPreview),
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/apply`]: (route) =>
        json(route, 200, { id: BLOCK }),
    },
  });

  await page.getByRole('button', { name: 'Update maxes for the coming weeks' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('legend')).toHaveText([
    'Back Squat now 70 kg',
    'Bench Press now 52.5 kg',
  ]);
  // Nothing is sent until a max has changed.
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Change at least one training max.');
  expect(requests).toEqual([]);

  await sheet.getByLabel('New training max').first().fill('75');
  await sheet.getByLabel('Why? (optional)').fill('Retested on Wednesday');
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();

  await expect(sheet.locator('.lift-move')).toHaveText('70 kg to 75 kg');
  await expect(sheet.locator('.strong')).toHaveText('4 weights change in 2 workouts.');
  await expect(sheet).toContainText('The new max applies from week 3.');
  await expect(sheet).toContainText(
    '3 workouts have started or are already past, so they keep their weights.',
  );
  await expect(sheet.locator('.week-title')).toHaveText(['Week 3', 'Week 4']);
  await expect(sheet.locator('.sets li').first()).toContainText('Set 1 · 5 reps · RPE 8');
  await expect(sheet.locator('.sets li .to').first()).toHaveText('65 kg');
  await expect(sheet.locator('.sets li .was').first()).toHaveText('was 60 kg');
  await expect(sheet.locator('.sets li .delta').first()).toHaveText('+5 kg');
  // The working-out is one tap away, in the server's words.
  await sheet.locator('.how summary').first().click();
  await expect(sheet.locator('.how p').first()).toContainText('60.811 kg');
  expect(requests.map((request) => request.path)).toEqual([
    `/api/training/mesocycles/${BLOCK}/training-maxes/preview`,
  ]);
  await axe(page);
  await page.screenshot({ path: 'test-results/p2-maxes-update-1440.png', fullPage: true });

  await sheet.getByRole('button', { name: 'Update maxes', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(requests[0].body).toEqual({
    mesocycleVersion: 4,
    changes: [{ exerciseId: 'ex-squat', value: 75, weekOneWeight: null }],
  });
  expect(requests[1].body).toMatchObject({
    mesocycleVersion: 4,
    changes: [{ exerciseId: 'ex-squat', value: 75, weekOneWeight: null }],
    reason: 'Retested on Wednesday',
    previewHash: 'hash-1',
    idempotencyKey: expect.any(String),
  });
  // A max is typed or worked out from week 1's weight; no update names a logged set (N10b).
  expect(JSON.stringify(requests.map((request) => request.body))).not.toContain('loggedSetId');
  // The page says what happened, and reads the program and its maxes again.
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Training maxes updated. The weeks still to come follow them.' }),
  ).toBeVisible();
});

test('an old address that asked to review maxes opens Training as usual (N10b)', async ({
  page,
}) => {
  await openTraining(page, 1440, 900, { path: `/clients/${ID}/training?action=maxes` });

  const panel = page.locator('app-program-maxes');
  await expect(panel.locator('.lift').first()).toBeVisible();
  await expect(panel.locator('.lift').first().locator('.value')).toHaveText('70 kg');
  // Nothing opens or takes the focus, nothing suggests a max, and the word stays in the address.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Training maxes' })).not.toBeFocused();
  await expect(panel.locator('.suggestion')).toHaveCount(0);
  await expect(panel.locator('button')).toHaveText(['Update maxes for the coming weeks']);
  await expect(page).toHaveURL(`/clients/${ID}/training?action=maxes`);
});

test.describe('a stale update', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\//] } });
  test('says the weights changed since they were looked at, and keeps the sheet open', async ({
    page,
  }) => {
    await openTraining(page, 390, 844, {
      extra: {
        [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
          json(route, 200, maxesPreview),
        [`POST /api/training/mesocycles/${BLOCK}/training-maxes/apply`]: (route) =>
          json(route, 409, {
            code: 'training_maxes_preview_changed',
            message:
              'The new weights no longer match the ones you reviewed. Preview them again before applying.',
          }),
      },
    });
    await page.getByRole('button', { name: 'Update maxes for the coming weeks' }).click();
    const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
    await sheet.getByLabel('New training max').first().fill('75');
    await sheet.getByRole('button', { name: 'Show the new weights' }).click();
    await sheet.getByRole('button', { name: 'Update maxes', exact: true }).click();

    await expect(sheet.getByRole('alert')).toHaveText(
      'The new weights changed since you looked at them. Show them again, then update.',
    );
    await expect(sheet).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });
});

test('renaming a program asks for the name, sends the version and reads the program again', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, {
    requests,
    programs: [coachProgram(), coachProgram()],
    extra: {
      [`PUT /api/training/mesocycles/${BLOCK}/name`]: (route) => json(route, 200, { id: BLOCK }),
    },
  });

  await page.getByRole('button', { name: 'Manage program' }).click();
  await page.getByRole('button', { name: /^Rename program/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename program' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Program name')).toHaveValue('Lean & Strong · Phase 2');
  await expect(dialog).toContainText(
    'Its dates, its weeks and what it was built from stay as they are.',
  );

  await dialog.getByLabel('Program name').fill('   ');
  await dialog.getByRole('button', { name: 'Rename program' }).click();
  await expect(dialog.getByText('Give the program a name.')).toBeVisible();
  expect(requests).toEqual([]);

  await dialog.getByLabel('Program name').fill('Peaking block');
  await axe(page);
  await dialog.getByRole('button', { name: 'Rename program' }).click();

  await expect(dialog).toHaveCount(0);
  expect(requests).toEqual([
    {
      method: 'PUT',
      path: `/api/training/mesocycles/${BLOCK}/name`,
      body: { name: 'Peaking block', version: 4 },
    },
  ]);
  await expect(
    page.getByRole('status').filter({ hasText: 'The program was renamed.' }),
  ).toBeVisible();
});

test('Assign program can name the program and work a max out from week 1’s weight', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, {
    path: `/clients/${ID}/training?action=assign`,
    opensSheet: true,
    requests,
    extra: {
      'GET /api/training/template-versions/version-1': (route) =>
        json(route, 200, versionWithChart),
      'POST /api/strength/estimate-max-from-rpe': (route) =>
        json(route, 200, {
          value: 69.975,
          unit: 'Kilogram',
          percent: 78.6,
          methodKey: 'RpeChart',
          methodVersion: '1.0',
          explanation:
            'RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of the max, so 55 kg / 78.6% = 69.975 kg.',
        }),
      [`POST /api/training/clients/${ID}/mesocycles`]: (route) =>
        json(route, 200, { id: 'block-next', name: 'Peaking block', startDate: '2026-10-26' }),
    },
  });

  const sheet = page.getByRole('dialog', { name: 'Assign program' });
  await chooseOption(sheet, 'Program', 'Lean & Strong · Phase 3 · 6 weeks');
  await expect(sheet.getByLabel('Program name (optional)')).toHaveAttribute(
    'placeholder',
    'Lean & Strong · Phase 3',
  );
  await sheet.getByLabel('Program name (optional)').fill('Peaking block');

  // The squat can be typed, or worked out from the weight of week 1's first set.
  await openMax(sheet, 'Back Squat');
  await sheet.getByRole('radio', { name: 'From week 1’s weight' }).check();
  await expect(sheet).toContainText(
    'The weight of its first working set: 5 reps at RPE 7. The max is worked out from the RTS chart.',
  );
  await sheet.getByLabel('Back Squat in week 1', { exact: true }).fill('55');
  await sheet.getByLabel('Back Squat in week 1', { exact: true }).press('Tab');
  await expect(sheet.locator('.estimate')).toHaveText(
    'RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of the max, so 55 kg / 78.6% = 69.975 kg.',
  );
  await axe(page);
  await page.screenshot({ path: 'test-results/p2-assign-weekone-1440.png', fullPage: true });

  await chooseDay(sheet, 'Start date', '2026-10-26');
  await sheet.getByRole('button', { name: 'Assign program', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const assign = requests.find(
    (request) => request.path === `/api/training/clients/${ID}/mesocycles`,
  );
  expect(assign!.body).toMatchObject({
    name: 'Peaking block',
    workingMaxes: [
      {
        exerciseId: 'ex-squat',
        strengthMaxRecordId: null,
        value: null,
        unit: 'Kilogram',
        weekOneWeight: 55,
      },
    ],
  });
});

test('the training maxes follow dark mode and the update sheet passes axe in it', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 1440, 900, {
    extra: {
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
        json(route, 200, maxesPreview),
    },
  });
  await axe(page);
  await page.screenshot({ path: 'test-results/p2-maxes-dark-1440.png', fullPage: true });

  await page.getByRole('button', { name: 'Update maxes for the coming weeks' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
  await sheet.getByLabel('New training max').first().fill('75');
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();
  await expect(sheet.locator('.preview')).toBeVisible();
  await axe(page);
});

test('the training maxes read right to left', async ({ page }) => {
  await openTraining(page, 1440, 900);
  await useRtl(page);

  await expect(page.locator('app-program-maxes .lift').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p2-maxes-rtl-1440.png', fullPage: true });
});

for (const width of [390, 1440]) {
  test(`the training maxes and their update sheet reflow at 200% text at ${width}px`, async ({
    page,
  }) => {
    await openTraining(page, width, 900, {
      extra: {
        [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
          json(route, 200, maxesPreview),
      },
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(page.locator('app-program-maxes .lift').first()).toBeVisible();
    // Each lift and the foot's one button wrap with the text; nothing suggests a max (N10b).
    await expect(page.locator('app-program-maxes .suggestion')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Update maxes for the coming weeks' }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Update maxes for the coming weeks' }).click();
    const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
    await sheet.getByLabel('New training max').first().fill('75');
    await sheet.getByRole('button', { name: 'Show the new weights' }).click();
    await expect(sheet.locator('.preview')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test.describe('program date conflicts', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\//] } });
  for (const width of [390, 1440]) {
    test(`Assign program names the conflicting block at ${width}px`, async ({ page }) => {
      const message =
        'Maya already has Strength Base from Mon 21 Sep 2026 to Sun 25 Oct 2026. Start on Mon 26 Oct 2026 or later, or cancel that program first.';
      await openTraining(page, width, 900, {
        path: `/clients/${ID}/training?action=assign`,
        opensSheet: true,
        extra: {
          [`POST /api/training/clients/${ID}/mesocycles`]: (route) =>
            json(route, 409, { code: 'mesocycle_overlap', message }),
        },
      });
      const sheet = page.getByRole('dialog', { name: 'Assign program' });
      await chooseOption(sheet, 'Program', 'Lean & Strong · Phase 3 · 6 weeks');
      await sheet.getByRole('button', { name: 'Assign program', exact: true }).click();
      await expect(sheet.getByRole('alert')).toHaveText(message);
      await expect(sheet).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
    });
  }
});

/** Weeks 7 to 9 of Maya's program, as Build next block previews them: each squat set a step further on. */
const nextBlockPreview = {
  previewHash: 'hash-next',
  transformKey: 'WeekStep',
  transformVersion: '1.0',
  resultingWeekCount: 9,
  resultingEndDateExclusive: '2026-11-16',
  isInsideTrainingCoverage: true,
  coverageMessage: null,
  generatedWeeks: [7, 8, 9].map((number) =>
    weekView(`next-${number}`, number, [
      sessionView(`next-s${number}`, 'Lower A', [
        exerciseView(`next-squat-${number}`, 'Back squat', [
          setView({
            position: 1,
            setType: 'WarmUp',
            loadStrategy: 'Direct',
            loadUnit: 'Kilogram',
            directLoad: 60,
            prescribedLoad: 60,
            targetRpe: 6,
          }),
          chartSet(2, {
            repetitionsMinimum: 5 - (number - 6),
            repetitionsMaximum: 5 - (number - 6),
            prescribedLoad: 77.5 + (number - 6) * 2.5,
            targetRpe: 7 + (number - 6) * 0.5,
          }),
        ]),
      ]),
    ]),
  ),
};

function nextBlockOptions(requests?: { method: string; path: string; body: unknown }[]) {
  return {
    requests,
    programs: [coachProgram(), coachProgram()],
    extra: {
      [`GET /api/training/mesocycles/${BLOCK}`]: (route: Route) => json(route, 200, leanProgram()),
      [`POST /api/training/mesocycles/${BLOCK}/progression/preview`]: (route: Route) =>
        json(route, 200, nextBlockPreview),
      [`POST /api/training/mesocycles/${BLOCK}/progression/apply`]: (route: Route) =>
        json(route, 200, { id: BLOCK }),
    },
  };
}

async function openNextBlock(page: Page) {
  await page.getByRole('button', { name: 'Manage program' }).click();
  await page.getByRole('button', { name: /^Build next block/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Build next block' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('Build next block takes the builder’s four steps, shows the new weeks first, then sends what was reviewed', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, nextBlockOptions(requests));

  const sheet = await openNextBlock(page);
  // The last week is chosen; the steps start at half a point of effort and nothing else.
  await expect(sheet.getByLabel('Week 6 · 19–25 Oct')).toBeChecked();
  await expect(sheet.getByLabel('Copies of each week')).toHaveValue('3');
  await expect(sheet.getByLabel('RPE a week')).toHaveValue('0.5');
  await expect(sheet.getByLabel('Reps a week')).toHaveValue('0');
  await expect(sheet.getByLabel('% of training max a week')).toHaveValue('0');
  await expect(sheet.getByLabel('Weight a week (kg)')).toHaveValue('0');
  // Each step says what it would move, and the formula the weights follow is named.
  await expect(sheet.getByText('Sets moved: 2. Warm-ups stay as they are.')).toBeVisible();
  await expect(sheet.getByText('Sets moved: 1, fixed or typed weights.')).toBeVisible();
  await expect(
    sheet.getByText(
      'Weights come from this program’s training maxes. Where a weight follows an RPE, it uses the RTS chart, as it does now.',
    ),
  ).toBeVisible();

  // A step the rules do not allow is said at the field, and nothing is sent.
  await sheet.getByLabel('Reps a week').fill('25');
  await sheet.getByRole('button', { name: 'Preview the new weeks' }).click();
  await expect(sheet.getByText('Use a whole number from -20 to 20.')).toBeVisible();
  await expect(sheet.getByLabel('Reps a week')).toBeFocused();
  expect(requests).toEqual([]);

  await sheet.getByLabel('Reps a week').fill('-1');
  await sheet.getByRole('button', { name: 'Preview the new weeks' }).click();
  await expect(sheet.locator('.preview-title')).toHaveText(['Week 7', 'Week 8', 'Week 9']);
  await expect(sheet.locator('.preview-line')).toHaveText(
    '3 new weeks. The program would end Sun 15 Nov 2026.',
  );
  // The set that moved reads heavier and says so; the warm-up is as it was.
  const first = sheet.locator('.preview-week').first().locator('.set');
  await expect(first).toHaveText(['5 reps · 60 kg · RPE 6', '4 reps · 80 kg · RPE 7.5 , changed']);
  await expect(first.nth(1)).toHaveClass(/changed/);
  await expect(first.nth(0)).not.toHaveClass(/changed/);
  expect(requests.map((request) => request.path)).toEqual([
    `/api/training/mesocycles/${BLOCK}/progression/preview`,
  ]);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3a-next-block-1440.png', fullPage: true });

  await sheet.getByRole('button', { name: 'Add these weeks' }).click();
  await expect(sheet).toHaveCount(0);
  expect(requests[0].body).toEqual({
    sourceWeekIds: [`${BLOCK}-week6`],
    iterations: 3,
    rpeIncrement: 0.5,
    repetitionsStep: -1,
    percentageStep: 0,
    loadStep: 0,
    mesocycleVersion: 4,
  });
  expect(requests[1].body).toEqual({ ...(requests[0].body as object), previewHash: 'hash-next' });
  await expect(
    page.getByRole('status').filter({ hasText: 'The new weeks are added to' }),
  ).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`Build next block reflows at 200% text at ${width}px, preview included`, async ({
    page,
  }) => {
    await openTraining(page, width, 900, nextBlockOptions());
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    const sheet = await openNextBlock(page);
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Preview the new weeks' }).click();
    await expect(sheet.locator('.preview')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test('Build next block at phone width keeps its buttons in view and passes axe', async ({
  page,
}) => {
  await openTraining(page, 390, 844, nextBlockOptions());

  const sheet = await openNextBlock(page);
  await sheet.getByRole('button', { name: 'Preview the new weeks' }).click();
  await expect(sheet.locator('.preview')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add these weeks' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3a-next-block-390.png', fullPage: true });
});

test('Build next block follows dark mode and reads right to left', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 1440, 900, nextBlockOptions());

  const sheet = await openNextBlock(page);
  await sheet.getByRole('button', { name: 'Preview the new weeks' }).click();
  await expect(sheet.locator('.preview')).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/p3a-next-block-dark-1440.png', fullPage: true });

  await useRtl(page);
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

/**
 * Maya's program as Edit weeks reads it on Thu 1 Oct (P3b): one session a week on its first day, weeks 1
 * and 2 done, week 3's session gone by, weeks 4 to 6 still to come.
 */
function editableBlock() {
  const program = leanProgram();
  const days = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  program.weeks.forEach((week, index) => {
    const session = week.sessions[0];
    session.scheduledDate = days[index];
    if (index < 2) {
      session.hasStarted = true;
      session.isCompleted = true;
    }
  });
  return program;
}

/** What the server says renaming week 4 and moving its squat set to 3 reps at RPE 8 does. */
const editPreview = {
  previewHash: 'hash-edit',
  ruleKey: 'GridEdit',
  ruleVersion: '1.0',
  today: '2026-10-01',
  frozenWeekCount: 3,
  resultingWeekCount: 6,
  currentEndDateExclusive: '2026-10-26',
  resultingEndDateExclusive: '2026-10-26',
  isInsideTrainingCoverage: true,
  problems: [],
  weeksAdded: 0,
  weeksMoved: 0,
  weeksRemoved: 0,
  sessionsAdded: 0,
  sessionsEdited: 1,
  sessionsMoved: 0,
  sessionsRemoved: 0,
  weekChanges: [
    { kind: 'Edited', weekNumber: 4, previousWeekNumber: 4, label: 'Heavy', isShared: true },
  ],
  sessionChanges: [
    {
      kind: 'Edited',
      sessionId: 'block-lean-s4',
      weekNumber: 4,
      date: '2026-10-05',
      previousWeekNumber: null,
      previousDate: null,
      name: 'Lower A',
      weekIsShared: true,
      after: sessionView('block-lean-s4', 'Lower A', [
        exerciseView('squat-4', 'Back squat', [
          chartSet(1, {
            repetitionsMinimum: 3,
            repetitionsMaximum: 3,
            targetRpe: 8,
            prescribedLoad: 87.5,
          }),
        ]),
      ]),
    },
  ],
};

const EDIT_PATH = `/clients/${ID}/training/${BLOCK}/edit`;

function editOptions(requests?: { method: string; path: string; body: unknown }[]) {
  return {
    requests,
    path: EDIT_PATH,
    extra: {
      [`GET /api/training/mesocycles/${BLOCK}`]: (route: Route) =>
        json(route, 200, editableBlock()),
      'GET /api/exercises': (route: Route) =>
        json(route, 200, { items: [], total: 0, patterns: [] }),
      'GET /api/training/saved-sessions': (route: Route) => json(route, 200, []),
      'POST /api/media/access': (route: Route) => json(route, 200, { items: [] }),
      [`POST /api/training/mesocycles/${BLOCK}/edit/preview`]: (route: Route) =>
        json(route, 200, editPreview),
      [`POST /api/training/mesocycles/${BLOCK}/edit/apply`]: (route: Route) =>
        json(route, 200, { ...editableBlock(), version: 5 }),
    },
  };
}

async function reviewRenamedWeek(page: Page) {
  await expect(page.locator('#edit-title')).toHaveText('Edit weeks');
  // A narrow page shows one week at a time.
  const chip = page.locator('.week-chip', { hasText: '4' });
  if (await chip.isVisible()) await chip.click();
  await page.getByLabel('Name of week 4').fill('Heavy');
  await page.getByRole('button', { name: 'Review changes' }).click();
  const sheet = page.getByRole('dialog', { name: 'Review changes' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('Edit weeks opens the weeks still to come in the builder’s grid and applies what was reviewed', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, { ...editOptions(requests), path: undefined });

  await page.getByRole('button', { name: 'Manage program' }).click();
  await page.getByRole('button', { name: /^Edit weeks/ }).click();
  await expect(page).toHaveURL(EDIT_PATH);
  await expect(page).toHaveTitle('Edit weeks | TB Gym');
  await expect(page.locator('.edit-runs')).toHaveText('6 weeks · Mon 14 Sep – Sun 25 Oct 2026');
  // Weeks 1 to 3 hold what happened; weeks 4 to 6 can change.
  await expect(page.locator('.locked-card app-status-pill')).toHaveText(['Done', 'Done', 'Past']);
  await expect(page.locator('section.week .session-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Review changes' })).toBeDisabled();
  // A client's program shows the weight to lift, a chart set and a % set too (critique B15).
  await expect(page.locator('section.week').nth(3).locator('app-set-lines .run')).toHaveText([
    '1 × 5 · 77.5 kg · RPE 7',
    '1 × 5 · 100 kg · RPE 7',
    '1 × 5 · 70 kg',
  ]);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-edit-1440.png', fullPage: true });

  const sheet = await reviewRenamedWeek(page);
  await expect(sheet.locator('.review-headline')).toHaveText(
    '1 workout changed · 1 week renamed or shared differently',
  );
  await expect(sheet.locator('.review-title')).toHaveText([
    'Week 4 · Heavy',
    'Week 4 · Mon 5 Oct · Lower A',
  ]);
  await expect(sheet.locator('.review-set')).toHaveText(['3 reps · 87.5 kg · RPE 8']);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-review-1440.png' });

  await sheet.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page).toHaveURL(`/clients/${ID}/training`);
  await expect(
    page.getByRole('status').filter({ hasText: 'is updated. Maya sees the changes' }),
  ).toBeVisible();
  const preview = requests.find((request) => request.path.endsWith('/edit/preview'))!.body as {
    mesocycleVersion: number;
    weeks: { weekId: string; label: string | null; sessions: { sessionId: string }[] }[];
  };
  expect(preview.mesocycleVersion).toBe(4);
  expect(preview.weeks.map((week) => [week.label, week.sessions.map((s) => s.sessionId)])).toEqual([
    [null, []],
    [null, []],
    [null, []],
    ['Heavy', ['block-lean-s4']],
    [null, ['block-lean-s5']],
    [null, ['block-lean-s6']],
  ]);
  expect(requests.find((request) => request.path.endsWith('/edit/apply'))!.body).toEqual({
    ...preview,
    previewHash: 'hash-edit',
  });
});

for (const width of [390, 1440]) {
  test(`Edit weeks reflows at 200% text at ${width}px, review included`, async ({ page }) => {
    await openTraining(page, width, 900, editOptions());
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await reviewRenamedWeek(page);
    await expectNoHorizontalOverflow(page);
  });
}

test('Edit weeks at phone width shows this week first, keeps Apply in view and passes axe', async ({
  page,
}) => {
  await openTraining(page, 390, 844, editOptions());

  await expect(page.locator('section.week:visible')).toHaveCount(1);
  await expect(page.locator('section.week:visible')).toHaveAttribute('aria-label', 'Week 3');
  await expect(page.locator('.week-chip input:checked')).toHaveAttribute('aria-label', 'Week 3');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-edit-390.png', fullPage: true });

  const sheet = await reviewRenamedWeek(page);
  await expect(sheet.getByRole('button', { name: 'Apply changes' })).toBeInViewport();
  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-review-390.png' });
});

test('Edit weeks asks before leaving with changes not applied', async ({ page }) => {
  await openTraining(page, 1440, 900, editOptions());
  await page.getByLabel('Name of week 4').fill('Heavy');

  await page.getByRole('link', { name: 'Maya’s training' }).click();
  const ask = page.getByRole('dialog', { name: 'Leave without applying?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(EDIT_PATH);

  await page.getByRole('link', { name: 'Maya’s training' }).click();
  await page
    .getByRole('dialog', { name: 'Leave without applying?' })
    .getByRole('button', { name: 'Leave without applying' })
    .click();
  await expect(page).toHaveURL(`/clients/${ID}/training`);
});

test('Edit weeks follows dark mode and reads right to left', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 1440, 900, editOptions());

  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-edit-dark-1440.png', fullPage: true });
  await reviewRenamedWeek(page);
  await axe(page);

  await useRtl(page);
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

// ---- A client's strength history (R5.3d): every max on record, and how they have done on each lift.

const squatMaxes = () => ({
  [`GET /api/strength/clients/${ID}/maxes`]: (route: Route) =>
    json(route, 200, maxPage(mayaMaxes())),
  [`GET /api/training/clients/${ID}/exercises/${SQUAT}/history`]: (route: Route) =>
    json(route, 200, squatHistory()),
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`the strength history lists each lift once at ${width}px ${mode} and passes axe`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: mode });
      await openTraining(page, width, height, { extra: squatMaxes() });

      const card = page.locator('app-client-strength');
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('heading', { level: 2, name: 'Strength history' })).toBeVisible();
      await expect(card.locator('.lift-name')).toHaveText([
        'Back Squat',
        'Deadlift',
        'Bench Press',
      ]);
      const squat = card.locator('[data-lift]').first();
      await expect(squat.locator('.now')).toHaveText('62.5 kg Training max');
      await expect(squat.locator('p.meta')).toHaveText('Set Tue 15 Sep · +2.5 kg since Wed 5 Aug');
      await expect(squat.locator('[data-also]')).toHaveText('Tested 1RM 92.5 kg · Sun 20 Sep');
      await expect(squat.locator('app-sparkline')).toHaveCount(1);
      await expect(card.locator('[data-lift]').nth(1).locator('app-sparkline')).toHaveCount(0);

      // The list of every max is closed until asked for, and says where each one came from.
      await squat.locator('[data-history] summary').click();
      await expect(squat.locator('.entry').nth(1)).toContainText(
        'Lean & Strong · Phase 2, from week 1, typed',
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      // Clipped out of the whole page, so the sticky top bar does not cover the card's heading.
      await page.evaluate(() => window.scrollTo(0, 0));
      await docsPicture(page, `r53d2-strength-${mode === 'dark' ? 'dark-' : ''}${width}.png`, {
        fullPage: true,
        clip: (await card.boundingBox())!,
      });
    });
  }
}

test('a client with no max on record is told what will fill the list', async ({ page }) => {
  await openTraining(page, 390, 844, {
    extra: { [`GET /api/strength/clients/${ID}/maxes`]: (route) => json(route, 200, maxPage([])) },
  });
  await expect(page.locator('app-client-strength [data-empty]')).toContainText(
    'No max is on record for Maya yet.',
  );
  await axe(page);
});

test('a max recorded from a lift’s row sends a tested max with no estimate, then shows beside the training max', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  let recorded = false;
  const tested = maxView({
    id: 'max-new',
    kind: 'TestedOneRepMax',
    value: 100,
    effectiveDate: '2026-10-01',
    createdAtUtc: '2026-10-01T12:00:00Z',
    source: 'Manual',
    methodKey: null,
    methodVersion: null,
    note: 'Tested after the deload.',
    program: null,
  });
  await openTraining(page, 390, 844, {
    requests,
    extra: {
      ...squatMaxes(),
      [`GET /api/strength/clients/${ID}/maxes`]: (route) =>
        json(route, 200, maxPage(recorded ? [tested, ...mayaMaxes()] : mayaMaxes())),
      [`POST /api/strength/clients/${ID}/maxes`]: (route) => {
        recorded = true;
        return json(route, 201, tested);
      },
    },
  });

  const card = page.locator('app-client-strength');
  await card.locator('[data-lift]').first().getByRole('button', { name: 'Record a max' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a max for Back Squat' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(700);
  // Three kinds, and never a typed estimate: a set they did is worked out by the server (critique B7b).
  await expect(sheet.locator('input[name="kind"]')).toHaveCount(3);
  await expect(sheet.locator('input[name="kind"][value="FromSet"]')).toHaveCount(1);
  await expect(sheet).not.toContainText('Estimated');
  await axe(page);
  await docsPicture(page, 'r53d2-record-390.png');

  await sheet.getByRole('button', { name: 'Record max' }).click();
  await expect(sheet).toContainText('Enter the weight.');
  expect(requests).toEqual([]);

  await sheet.locator('input[name="kind"][value="TestedOneRepMax"]').check();
  await sheet.getByLabel('Weight', { exact: true }).fill('100');
  await sheet.getByLabel('Note (optional)').fill('Tested after the deload.');
  await sheet.getByRole('button', { name: 'Record max' }).click();

  await expect(page.locator('app-toast-host')).toContainText(
    'Back Squat — Tested 1RM 100 kg recorded.',
  );
  await expect(sheet).toHaveCount(0);
  expect(requests).toEqual([
    {
      method: 'POST',
      path: `/api/strength/clients/${ID}/maxes`,
      body: {
        exerciseId: SQUAT,
        kind: 'TestedOneRepMax',
        value: 100,
        unit: 'Kilogram',
        effectiveDate: '2026-10-01',
        source: 'Manual',
        methodKey: null,
        methodVersion: null,
        sourceWorkoutExecutionId: null,
        note: 'Tested after the deload.',
      },
    },
  ]);
  await expect(card.locator('[data-lift]').first().locator('[data-also]')).toContainText(
    'Tested 1RM 100 kg',
  );
  // The training max stays the headline: a tested max never replaces what the program works from.
  await expect(card.locator('[data-lift]').first().locator('.now')).toHaveText(
    '62.5 kg Training max',
  );
});

test('a max for a lift with none is found by searching the library', async ({ page }) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const searches: string[] = [];
  await openTraining(page, 1440, 900, {
    requests,
    extra: {
      ...squatMaxes(),
      'GET /api/exercises': (route) => {
        searches.push(new URL(route.request().url()).searchParams.get('query') ?? '');
        return json(route, 200, library([['ex-pull', 'Pull-up']]));
      },
      [`POST /api/strength/clients/${ID}/maxes`]: (route) =>
        json(
          route,
          201,
          maxView({ id: 'max-pull', exerciseId: 'ex-pull', exerciseName: 'Pull-up' }),
        ),
    },
  });

  await page
    .locator('app-client-strength .head')
    .getByRole('button', { name: 'Record a max' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Record a max for Maya' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Another exercise').fill('pu');
  await expect(sheet.locator('[data-matches] .choice-text')).toHaveText(['Pull-up']);
  expect(searches).toEqual(['pu']);
  await sheet.locator('[data-matches] input[type="radio"]').check();
  await sheet.getByLabel('Weight', { exact: true }).fill('45');
  await sheet.getByRole('button', { name: 'Record max' }).click();

  await expect(page.locator('app-toast-host')).toContainText('Training max');
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toMatchObject({
    exerciseId: 'ex-pull',
    kind: 'CoachWorkingMax',
    value: 45,
  });
});

for (const mode of ['light', 'dark'] as const) {
  test(`how Maya has done on a lift lists her sets newest first at 390px ${mode} and passes axe`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: mode });
    await openTraining(page, 390, 844, { extra: squatMaxes() });

    await page
      .locator('app-client-strength [data-lift]')
      .first()
      .getByRole('button', { name: 'How they have done' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'How Maya has done on Back Squat' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-best]')).toContainText('Best estimated max 70 kg');
    await expect(sheet.locator('[data-performance] .when')).toHaveText([
      'Thu 8 Oct',
      'Sun 4 Oct',
      'Tue 29 Sep',
      'Thu 24 Sep',
    ]);
    await expect(sheet.locator('app-sparkline')).toHaveCount(1);
    await page.waitForTimeout(900);
    await axe(page);
    await docsPicture(page, `r53d2-history-${mode === 'dark' ? 'dark-' : ''}390.png`);
  });
}
