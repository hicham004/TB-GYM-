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

type Handlers = Record<string, (route: Route) => unknown>;

interface OpenOptions {
  path?: string;
  /** A sheet that opens with the page hides the page from assistive technology, heading included. */
  opensSheet?: boolean;
  /** The program reads in order; the last one repeats. */
  programs?: CoachClientProgramView[];
  enrollment?: Record<string, unknown>;
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
    'Build next block',
    'Reschedule',
    'Open every shared week now',
    'Close program',
    'Cancel program',
  ]);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  // What cannot be done says why, and does nothing when chosen.
  await expect(items.nth(2)).toHaveAttribute('aria-disabled', 'true');
  await expect(items.nth(2)).toContainText('Not possible once a workout has started');
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
