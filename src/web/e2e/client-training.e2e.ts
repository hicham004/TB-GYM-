import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
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
        suggestion: null,
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
        suggestion: null,
      },
    ],
    ...overrides,
  };
}

/**
 * The squat's max with what Maya's logged sets suggest (P4b): her week 2 top set, 62.5 kg for 5 at RPE 8,
 * is 81.1% of 77.065 kg on the RTS chart.
 */
function suggestingMaxes() {
  const view = maxesView();
  return {
    ...view,
    maxes: [
      {
        ...view.maxes[0],
        suggestion: {
          value: 77.065,
          unit: 'Kilogram',
          basis: {
            load: 62.5,
            repetitions: 5,
            rpe: 8,
            methodKey: 'RpeChart',
            methodVersion: '1.0',
            loggedSet: {
              setPerformanceId: 'set-logged-9',
              weekNumber: 2,
              performedOn: '2026-09-23',
              sessionName: 'Lower B',
            },
          },
          explanation:
            'Best logged set v1: the best set of week 2 was 62.5 kg for 5 reps at RPE 8 on Wed 23 Sep 2026. RTS RPE chart v1: 5 reps at RPE 8 is 81.1% of the max, so 62.5 kg / 81.1% = 77.065 kg.',
        },
      },
      view.maxes[1],
    ],
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

/** The preview of that suggestion: the same four sets, worked out from 77.065 kg. */
const suggestionPreview = {
  ...maxesPreview,
  lifts: [
    {
      ...maxesPreview.lifts[0],
      newValue: 77.065,
      source: 'LoggedSet',
      basis: suggestingMaxes().maxes[0].suggestion!.basis,
      explanation: suggestingMaxes().maxes[0].suggestion!.explanation,
    },
  ],
};

type Handlers = Record<string, (route: Route) => unknown>;

interface OpenOptions {
  path?: string;
  /** A sheet that opens with the page hides the page from assistive technology, heading included. */
  opensSheet?: boolean;
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
    await expect(page.getByRole('heading', { level: 1, name: 'Maya Fakhoury' })).toBeVisible();
  }
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
      '9 of 24 sessions done',
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
  await expect(sheet.locator('summary')).toHaveText('Swap this session');
  await axe(page);
  await page.screenshot({ path: 'test-results/r34a-training-session-1440.png' });

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(session).toBeFocused();
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

  await sheet
    .getByLabel('Program', { exact: true })
    .selectOption({ label: 'Lean & Strong · Phase 3 · 6 weeks' });
  // The back squat is worked out from a training max, which starts from the one recorded.
  await expect(sheet.getByLabel('Back Squat', { exact: true })).toHaveValue('70');
  await expect(sheet.getByText('Your recorded training max')).toBeVisible();
  await sheet.getByLabel('Start date', { exact: true }).fill('2026-10-26');
  await expect(sheet.locator('.run')).toHaveText('Runs Mon 26 Oct – Sun 6 Dec');
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
      patterns: [/status of 401 .*\/api\/auth\/me/, /status of 400 .*\/api\/training\/mesocycles/],
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
    await expect(dialog).toContainText('Maya stops seeing the sessions still to come.');

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

/** Where Maya's finished program left the squat (80 kg, set 2 Oct) and what its logged sets suggest. */
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
      suggestion: {
        value: 86.25,
        unit: 'Kilogram',
        basis: {
          load: 70,
          repetitions: 5,
          rpe: 8,
          methodKey: 'RpeChart',
          methodVersion: '1.0',
          loggedSet: {
            setPerformanceId: 'set-done',
            weekNumber: 6,
            performedOn: '2026-10-03',
            sessionName: 'Lower A',
          },
        },
        explanation: 'Best logged set v1.',
      },
    },
  ],
};

for (const [width, height, mode] of [
  [1440, 900, 'light'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
] as const) {
  test(`the next program starts where the last one ended, its suggestion one tap away, at ${width} px ${mode} (P4c)`, async ({
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
    await sheet
      .getByLabel('Program', { exact: true })
      .selectOption({ label: 'Lean & Strong · Phase 3 · 6 weeks' });
    // The 70 kg recorded on 14 Sep is older than where Strength Base left the squat.
    const squat = sheet.getByLabel('Back Squat', { exact: true });
    await expect(squat).toHaveValue('80');
    await expect(sheet.getByText('Where Strength Base left it, set Fri 2 Oct')).toBeVisible();
    await expect(sheet.locator('.suggested p')).toHaveText(
      'Strength Base’s logged sets suggest 86.25 kg (70 kg for 5 reps at RPE 8).',
    );
    // Clear of the sheet's sticky buttons, as a coach scrolling to it would see it.
    await sheet.locator('.suggested').evaluate((box) => box.scrollIntoView({ block: 'center' }));
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/p4c-next-assign-${width}-${mode}.png` });

    await sheet.getByRole('button', { name: 'Use 86.25 kg' }).click();
    await expect(squat).toHaveValue('86.25');
    await expect(
      sheet.getByText('Estimated from Strength Base’s logged sets: 70 kg for 5 reps at RPE 8'),
    ).toBeVisible();
    await expect(sheet.locator('.suggested')).toHaveCount(0);
    await sheet.getByLabel('Start date', { exact: true }).fill('2026-10-26');
    await sheet.getByRole('button', { name: 'Assign program' }).click();
    await expect(sheet).toHaveCount(0);
    expect(requests[0]).toMatchObject({
      path: `/api/training/clients/${ID}/mesocycles`,
      body: {
        workingMaxes: [
          {
            exerciseId: 'ex-squat',
            strengthMaxRecordId: null,
            value: null,
            unit: 'Kilogram',
            loggedSetId: 'set-done',
          },
        ],
      },
    });
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
  await expect(sheet.locator('.strong')).toHaveText('4 weights change in 2 sessions.');
  await expect(sheet).toContainText('The new max applies from week 3.');
  await expect(sheet).toContainText(
    '3 sessions have started or are already past, so they keep their weights.',
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
    changes: [{ exerciseId: 'ex-squat', value: 75, weekOneWeight: null, loggedSetId: null }],
  });
  expect(requests[1].body).toMatchObject({
    mesocycleVersion: 4,
    changes: [{ exerciseId: 'ex-squat', value: 75, weekOneWeight: null, loggedSetId: null }],
    reason: 'Retested on Wednesday',
    previewHash: 'hash-1',
    idempotencyKey: expect.any(String),
  });
  // The page says what happened, and reads the program and its maxes again.
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Training maxes updated. The weeks still to come follow them.' }),
  ).toBeVisible();
});

test('a lift’s logged sets suggest a max, and Review opens its new weights already worked out (P4b)', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  await openTraining(page, 1440, 900, {
    requests,
    programs: [coachProgram(), coachProgram()],
    maxes: suggestingMaxes(),
    extra: {
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
        json(route, 200, suggestionPreview),
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/apply`]: (route) =>
        json(route, 200, { id: BLOCK }),
    },
  });

  const panel = page.locator('app-program-maxes');
  const suggestion = panel.locator('.lift').first().locator('.suggestion');
  await expect(suggestion.locator('.suggestion-head')).toHaveText(
    'Logged sets suggest 77.07 kg, up from 70 kg.',
  );
  await expect(suggestion.locator('.detail')).toHaveText(
    'From 62.5 kg for 5 reps at RPE 8 on Wed 23 Sep, week 2.',
  );
  // Nothing changed on its own, and the bench, with nothing to suggest, says nothing.
  await expect(panel.locator('.lift').first().locator('.value')).toHaveText('70 kg');
  await expect(panel.locator('.lift').nth(1).locator('.suggestion')).toHaveCount(0);
  expect(requests).toEqual([]);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4b-suggestion-1440.png', fullPage: true });

  await suggestion.getByRole('button', { name: 'Review the new weights' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
  await expect(sheet.locator('.lift-move')).toHaveText('70 kg to 77.07 kg');
  await expect(sheet.locator('.lift-changes .why')).toContainText('the best set of week 2');
  await expect(sheet.locator('.strong')).toHaveText('4 weights change in 2 sessions.');
  expect(requests[0].body).toEqual({
    mesocycleVersion: 4,
    changes: [
      { exerciseId: 'ex-squat', value: null, weekOneWeight: null, loggedSetId: 'set-logged-9' },
    ],
  });
  await axe(page);
  await page.screenshot({ path: 'test-results/p4b-review-1440.png' });

  // Back to the numbers: the estimate is the lift's choice, ticked, with the set it came from.
  await sheet.getByRole('button', { name: 'Change the numbers' }).click();
  const estimate = sheet.getByRole('checkbox', {
    name: 'Use the estimate from logged sets: 77.07 kg',
  });
  await expect(estimate).toBeChecked();
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();
  await sheet.getByRole('button', { name: 'Update maxes', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(requests.at(-1)!.body).toMatchObject({
    mesocycleVersion: 4,
    changes: [
      { exerciseId: 'ex-squat', value: null, weekOneWeight: null, loggedSetId: 'set-logged-9' },
    ],
    previewHash: 'hash-1',
    idempotencyKey: expect.any(String),
  });
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Training maxes updated. The weeks still to come follow them.' }),
  ).toBeVisible();
});

test('a suggested max reads at phone width and in dark mode, and passes axe', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 390, 844, {
    maxes: suggestingMaxes(),
    extra: {
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
        json(route, 200, suggestionPreview),
    },
  });
  const suggestion = page.locator('app-program-maxes .suggestion');
  await suggestion.scrollIntoViewIfNeeded();
  await expect(suggestion).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4b-suggestion-dark-390.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'light' });
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4b-suggestion-390.png', fullPage: true });

  await suggestion.getByRole('button', { name: 'Review the new weights' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
  await expect(sheet.locator('.preview')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4b-review-390.png' });
});

test('keeping a max quiets its suggestion and says so, at phone width and in dark mode (P4c)', async ({
  page,
}) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const view = maxesView();
  const kept = {
    ...view,
    maxes: [
      {
        ...view.maxes[0],
        kept: { suggestedValue: 77.065, unit: 'Kilogram', keptOn: '2026-10-01' },
      },
      view.maxes[1],
    ],
  };
  await page.emulateMedia({ colorScheme: 'dark' });
  await openTraining(page, 390, 844, {
    maxes: suggestingMaxes(),
    requests,
    extra: {
      [`POST /api/training/mesocycles/${BLOCK}/training-maxes/keep`]: (route) =>
        json(route, 200, kept),
    },
  });
  const panel = page.locator('app-program-maxes');
  const keep = panel.getByRole('button', { name: 'Keep 70 kg' });
  await keep.scrollIntoViewIfNeeded();
  await keep.click();

  // The suggestion is gone; the line that replaced it says what was kept, and has the focus.
  const line = panel.locator('#kept-ex-squat');
  await expect(line).toHaveText(
    'You kept 70 kg on Thu 1 Oct, over the 77.07 kg logged sets suggested.',
  );
  await expect(line).toBeFocused();
  await expect(panel.locator('.suggestion')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Kept Back Squat at 70 kg.' }),
  ).toBeVisible();
  expect(requests).toEqual([
    {
      method: 'POST',
      path: `/api/training/mesocycles/${BLOCK}/training-maxes/keep`,
      body: { exerciseId: 'ex-squat', loggedSetId: 'set-logged-9' },
    },
  ]);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p4c-kept-dark-390.png' });

  await page.emulateMedia({ colorScheme: 'light' });
  await axe(page);
  await page.screenshot({ path: 'test-results/p4c-kept-390.png' });
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
  await sheet
    .getByLabel('Program', { exact: true })
    .selectOption({ label: 'Lean & Strong · Phase 3 · 6 weeks' });
  await expect(sheet.getByLabel('Program name (optional)')).toHaveAttribute(
    'placeholder',
    'Lean & Strong · Phase 3',
  );
  await sheet.getByLabel('Program name (optional)').fill('Peaking block');

  // The squat can be typed, or worked out from the weight of week 1's first set.
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

  await sheet.getByLabel('Start date', { exact: true }).fill('2026-10-26');
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
      maxes: suggestingMaxes(),
      extra: {
        [`POST /api/training/mesocycles/${BLOCK}/training-maxes/preview`]: (route) =>
          json(route, 200, maxesPreview),
      },
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(page.locator('app-program-maxes .lift').first()).toBeVisible();
    // The logged sets' suggestion and its two buttons wrap with the text (P4b, P4c).
    const buttons = page.locator('app-program-maxes .suggestion button');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.first()).toBeVisible();
    await expect(buttons.last()).toBeVisible();
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
      await sheet.getByLabel('Program', { exact: true }).selectOption('version-1');
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
      'GET /api/exercises': (route: Route) => json(route, 200, { items: [], total: 0 }),
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
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/p3b-edit-1440.png', fullPage: true });

  const sheet = await reviewRenamedWeek(page);
  await expect(sheet.locator('.review-headline')).toHaveText(
    '1 session changed · 1 week renamed or shared differently',
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
      await page.screenshot({
        path: `../../docs/design/r53d2-strength-${mode === 'dark' ? 'dark-' : ''}${width}.png`,
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
  // Two kinds, and never an estimate: the server refuses one without a calculation or a workout.
  await expect(sheet.locator('input[name="kind"]')).toHaveCount(2);
  await expect(sheet).not.toContainText('Estimated');
  await axe(page);
  await page.screenshot({ path: '../../docs/design/r53d2-record-390.png' });

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
    await page.screenshot({
      path: `../../docs/design/r53d2-history-${mode === 'dark' ? 'dark-' : ''}390.png`,
    });
  });
}
