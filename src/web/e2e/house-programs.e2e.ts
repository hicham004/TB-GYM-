import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { HousePlansView, HouseProgramsView } from '../src/app/core/api/generated';
import {
  BASE_1_LISTING,
  BASE_2_LISTING,
  houseProgram,
  housePlansView,
  housePrograms,
  POWER_LISTING,
  powerbuilding,
  programMax,
  proPass,
  runningBlock,
  secondBlock,
  SQUAT_ID,
  startedView,
  typedMaxView,
} from '../src/testing/house-program-fixtures';
import { finishedProfile } from '../src/testing/intake-fixtures';
import { historyPage, programView } from '../src/testing/training-program-fixtures';
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
 * TB Gym's programs page (notes plan N9c4, TRN-034) in a real browser: a self-directed trainee of the
 * house reads the programs with whom each suits and their week 1, asks for Pro+ on My plan while on Free,
 * types their own max under a pass and starts a block, which opens Training. No check reads today's date:
 * every day on the page is the read's, and the far-zone project runs these in Kiritimati.
 */

type Handler = (route: Route) => Promise<void> | void;

/** TB Gym's own coaching space, whose trainees train with no coach (notes plan N9a2). */
const HOUSE = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};
/** A coach's client, in a coach's own space: the programs are not theirs. */
const ATLAS_CLIENT = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const TRAINEE = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000cc',
  displayName: 'Nour Khalil',
};
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary', 'Sessions'];
const SIZES = [
  [390, 844],
  [1440, 900],
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Under the pass, block 1 asks for a Back squat max until one is typed, then can start. */
function passRead(squat: number | null): HouseProgramsView {
  const max = programMax(squat === null ? {} : { value: squat, from: 'Typed', on: '2026-11-14' });
  return housePrograms({
    pass: proPass(),
    programs: [
      houseProgram({
        maxes: [max],
        canStart: squat !== null,
        refusal: squat === null ? 'house_program_needs_maxes' : null,
        lastStartDay: '2026-11-27',
      }),
      secondBlock({ maxes: [max], refusal: 'house_program_block_not_open' }),
      powerbuilding({
        maxes: [max, programMax({ exerciseId: 'bench', exerciseName: 'Bench press' })],
        refusal: 'house_program_does_not_fit',
      }),
    ],
  });
}

interface Options {
  readonly membership?: typeof HOUSE;
  readonly selfDirected?: boolean;
  /** The programs read; a function reads the scene's state, so a write shows on the next read. */
  readonly programs?: (scene: Scene) => HouseProgramsView;
  /** Outside the house: the read answers 404. */
  readonly gone?: boolean;
  /** What the house sells, read on Free. */
  readonly plans?: HousePlansView;
  /** How Start answers; 200 with the started program unless told. */
  readonly start?: (scene: Scene) => { status: number; body: unknown };
  /** How a typed max answers; 200 unless told. */
  readonly max?: (body: { value: number }) => { status: number; body: unknown };
}

interface Scene {
  /** Every call to the API, `METHOD /path`, in order. */
  readonly calls: string[];
  readonly starts: unknown[];
  readonly maxes: { exerciseId: string; value: number; unit: string }[];
  /** The Back squat max on record, as the server holds it. */
  squat: number | null;
  reads: number;
}

async function session(page: Page, options: Options = {}): Promise<Scene> {
  const scene: Scene = { calls: [], starts: [], maxes: [], squat: null, reads: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) scene.calls.push(`${request.method()} ${url.pathname}`);
  });
  const handlers: Record<string, Handler> = {
    'GET /api/client-access/me': (route) =>
      json(
        route,
        200,
        FEATURES.map((feature) => ({
          feature,
          isAllowed: feature === 'Training',
          reason: feature === 'Training' ? 'Granted' : 'NoEntitlement',
        })),
      ),
    'GET /api/client-profile/me': (route) =>
      json(route, 200, finishedProfile({ selfDirected: options.selfDirected ?? true })),
    'GET /api/training/me/house-programs': (route) => {
      scene.reads++;
      if (options.gone) return json(route, 404, { title: 'Not Found', status: 404 });
      return json(route, 200, options.programs ? options.programs(scene) : housePrograms());
    },
    'GET /api/house-plans/me': (route) => json(route, 200, options.plans ?? housePlansView()),
    [`POST /api/training/me/house-programs/${BASE_1_LISTING}/start`]: (route) => {
      scene.starts.push(route.request().postDataJSON());
      const answer = options.start?.(scene) ?? { status: 200, body: startedView() };
      return json(route, answer.status, answer.body);
    },
    'POST /api/strength/me/maxes': (route) => {
      const body = route.request().postDataJSON() as Scene['maxes'][number];
      scene.maxes.push(body);
      const answer = options.max?.(body) ?? {
        status: 200,
        body: typedMaxView({ value: body.value }),
      };
      if (answer.status === 200 && body.exerciseId === SQUAT_ID) scene.squat = body.value;
      return json(route, answer.status, answer.body);
    },
    // Where Start and the way back lead: Training with the started program, and My plan on Free.
    'GET /api/training/me/program': (route) => json(route, 200, programView()),
    'GET /api/training/me/history': (route) => json(route, 200, historyPage()),
    'GET /api/training/me/upcoming': (route) =>
      json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: '2026-11-14',
        timeZoneId: 'Asia/Beirut',
        hasAssignedProgram: true,
        hasVisibleSessions: true,
        searchThrough: '2027-01-14',
        nextSession: null,
        unfinishedWorkouts: [],
        nextSkip: null,
        todayCoverage: null,
      }),
    'GET /api/client-plan/me': (route) =>
      json(route, 200, {
        today: '2026-11-14',
        plans: [],
        coachName: null,
        renewal: null,
        tier: 'Free',
        free: { name: 'Free', since: '2026-11-01', status: 'Active', features: ['Training'] },
      }),
  };
  await mockSession(page, {
    memberships: [options.membership ?? HOUSE],
    user: TRAINEE,
    extra: handlers,
  });
  return scene;
}

/** The programs page, its heading drawn. */
async function openPrograms(
  page: Page,
  width: number,
  height: number,
  options: Options = {},
): Promise<Scene> {
  await page.setViewportSize({ width, height });
  const scene = await session(page, options);
  await page.goto('/training/house-programs');
  await expect(page.getByRole('heading', { level: 1, name: 'Programs' })).toBeVisible();
  await waitForFonts(page);
  return scene;
}

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  // A target the client's tab bar covers at the first scroll is judged where a person reaches it.
  expect(
    (await personFacing(page, result.violations)).map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/** A program's card, found by its listing. */
const card = (page: Page, listingId: string) => page.locator(`[data-program="${listingId}"]`);

/**
 * Each write came after an antiforgery read of its own, since the write before it, as a write after
 * sign-in must: a write uses up the token read before it. Read the calls recorded after the page loaded,
 * so the app's start-up token never counts for a write.
 */
function tokenBeforeEachWrite(calls: readonly string[]): boolean {
  let fresh = false;
  let writes = 0;
  for (const call of calls) {
    if (call === 'GET /api/auth/csrf') fresh = true;
    else if (/^(POST|PUT|PATCH|DELETE) /.test(call)) {
      if (!fresh) return false;
      fresh = false;
      writes++;
    }
  }
  return writes > 0;
}

/** Forgets the calls the page made while it loaded: the app's start-up token among them. */
function forgetLoadCalls(scene: Scene): void {
  scene.calls.splice(0);
}

for (const [width, height] of SIZES) {
  test(`on Free at ${width}px the programs show whom each suits and its week 1, with Ask for Pro+ leading to My plan`, async ({
    page,
  }) => {
    const scene = await openPrograms(page, width, height);

    const pass = page.locator('[data-pass]');
    await expect(pass).toContainText(
      'Starting a program needs Pro+. Free keeps running, with everything you logged.',
    );
    const first = card(page, BASE_1_LISTING);
    await expect(first.getByRole('heading', { level: 2 })).toHaveText('Strength Base 1');
    await expect(first.locator('.kicker')).toHaveText('Block 1 of Strength Base');
    await expect(first.locator('.suits')).toHaveText('For: New to the barbell, two days a week.');
    await expect(first.locator('.weeks')).toHaveText('2 weeks · kg');
    await expect(card(page, BASE_2_LISTING).locator('.kicker')).toHaveText(
      'Block 2 of Strength Base',
    );
    await expect(card(page, POWER_LISTING).locator('.weeks')).toHaveText('6 weeks · kg');

    await first.locator('summary', { hasText: 'Week 1' }).click();
    await expect(first.getByRole('heading', { level: 3 })).toHaveText([
      'Day 1 · Day A',
      'Day 4 · Day B',
    ]);
    await expect(first.locator('.exercises').first().locator('li')).toHaveText([
      'Back squat · 3 × 5 · main lift',
      'Barbell row · 2 × 8–12',
    ]);
    // Nothing starts on Free, nothing is typed, and the staff's count is never shown.
    await expect(page.locator('[data-start-program], [data-type-maxes]')).toHaveCount(0);
    await expect(page.getByText(/Started \d/)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath(`n9c4-programs-free-${width}.png`),
      fullPage: true,
    });
    expect(scene.calls).toContain('GET /api/house-plans/me');

    const ask = pass.getByRole('link', { name: 'Ask for Pro+' });
    await expect(ask).toHaveAttribute('href', '/plan');
    await ask.click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My plan' })).toBeVisible();
  });
}

test('on Free with an ask waiting, the page sends the trainee to My plan', async ({ page }) => {
  await openPrograms(page, 390, 844, {
    plans: housePlansView({
      asks: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          offerId: '00000000-0000-4000-8000-0000000000e1',
          tier: 'ProPlus',
          planName: 'Pro+ Programs',
          optionLabel: '4 weeks',
          priceAmount: '47.5',
          priceCurrency: 'USD',
          durationCount: 4,
          durationUnit: 'Week',
          askedOn: '2026-11-13',
          state: 'Asked',
          moneySent: null,
          outcome: null,
        },
      ],
    }),
  });

  const pass = page.locator('[data-pass]');
  await expect(pass).toContainText('You asked for Pro+ Programs. My plan shows where it stands.');
  await expect(pass.getByRole('link', { name: 'My plan' })).toHaveAttribute('href', '/plan');
  await expect(pass.getByRole('link', { name: 'Ask for Pro+' })).toHaveCount(0);
});

test.describe('under a Pro+ pass', () => {
  // The server refuses a max it would not take (400), which the browser logs.
  test.use({ allowedConsoleErrors: { patterns: [/status of 400 .*\/api\/strength\/me\/maxes/] } });

  for (const [width, height] of SIZES) {
    test(`at ${width}px the trainee types their max, then starts block 1 and lands on Training`, async ({
      page,
    }) => {
      const scene = await openPrograms(page, width, height, {
        programs: (current) => passRead(current.squat),
        max: (body) =>
          body.value === 499
            ? {
                status: 400,
                body: {
                  errors: {
                    value: ['Enter a max above 0 and at most 500 kg, with two decimals at most.'],
                  },
                },
              }
            : { status: 200, body: typedMaxView({ value: body.value }) },
      });

      await expect(page.locator('[data-pass] .pass-title')).toHaveText('Pro+ until Fri 11 Dec');
      const first = card(page, BASE_1_LISTING);
      await expect(first.locator('[data-refusal]')).toHaveText(
        'Type your max for Back squat first, in kg: this program works its weights out from it.',
      );
      expect(scene.calls).toContain('GET /api/auth/csrf');
      forgetLoadCalls(scene);
      await expect(card(page, BASE_2_LISTING).locator('[data-refusal]')).toHaveText(
        'This is block 2 of Strength Base. Start block 1 first.',
      );
      await expect(card(page, POWER_LISTING).locator('[data-refusal]')).toHaveText(
        'This block runs 6 weeks, longer than your pass, so it can’t start under it.',
      );
      await expect(first.locator('[data-start-program]')).toHaveCount(0);

      await first.getByRole('button', { name: 'Type your maxes, for Strength Base 1' }).click();
      const sheet = page.getByRole('dialog', { name: 'Your maxes' });
      await expect(sheet).toContainText(
        'Your training max: the weight the program’s percentages read. In kg for this program.',
      );
      const box = sheet.getByLabel('Back squat');
      await expect(box).toHaveAttribute('inputmode', 'decimal');
      await expect(sheet.locator('.unit')).toHaveText(['kg']);
      await box.fill('501');
      await sheet.getByRole('button', { name: 'Save maxes' }).click();
      await expect(sheet).toContainText(
        'Enter a max above 0 and at most 500 kg (1,100 lb), with two decimals at most.',
      );
      expect(scene.maxes).toEqual([]);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: test.info().outputPath(`n9c4-maxes-sheet-${width}.png`) });

      await box.fill('499');
      await sheet.getByRole('button', { name: 'Save maxes' }).click();
      await expect(sheet).toContainText(
        'Enter a max above 0 and at most 500 kg, with two decimals at most.',
      );
      await box.fill('140');
      await sheet.getByRole('button', { name: 'Save maxes' }).click();
      await expect(sheet).toHaveCount(0);
      expect(scene.maxes).toEqual([
        { exerciseId: SQUAT_ID, value: 499, unit: 'Kilogram' },
        { exerciseId: SQUAT_ID, value: 140, unit: 'Kilogram' },
      ]);

      // The page read again: the max is on record and block 1 can start.
      await expect(first.locator('[data-max]')).toHaveText('Back squat: 140 kg, typed Sat 14 Nov');
      const start = first.getByRole('button', { name: 'Start Strength Base 1' });
      await expect(start).toBeVisible();
      await expect(first.locator('[data-last-start]')).toHaveText(
        'Last day to start it under this pass: Fri 27 Nov',
      );
      await expect(
        first.getByRole('button', { name: 'Change your maxes, for Strength Base 1' }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c4-programs-pass-${width}.png`),
        fullPage: true,
      });

      await start.click();
      const question = page.getByRole('dialog', { name: 'Start Strength Base 1?' });
      await expect(question).toContainText(
        'It runs 2 weeks, from today until Fri 27 Nov. One program at a time: TB Gym’s other programs wait until it ends.',
      );
      await expectNoAxeViolations(page);
      await question.getByRole('button', { name: 'Start program' }).click();

      await expect(page).toHaveURL(/\/training\/program$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Training' })).toBeVisible();
      await expect(
        page.getByText('Strength Base 1 started. Its sessions are on Today and Training.'),
      ).toBeVisible();
      expect(scene.starts).toEqual([
        { templateVersionId: houseProgram().templateVersionId, idempotencyKey: expect.any(String) },
      ]);
      expect((scene.starts[0] as { idempotencyKey: string }).idempotencyKey).toMatch(UUID);
      // Two max saves and the Start: three writes, each after a token of its own.
      expect(scene.calls.filter((call) => call.startsWith('POST '))).toHaveLength(3);
      expect(tokenBeforeEachWrite(scene.calls)).toBe(true);
    });
  }
});

test('with block 1 running, the page says when block 2 opens and how long block 1 holds the days', async ({
  page,
}) => {
  const typed = programMax({ value: 140, from: 'Typed', on: '2026-11-14' });
  await openPrograms(page, 1440, 900, {
    programs: () =>
      housePrograms({
        pass: proPass(),
        running: runningBlock(),
        programs: [
          secondBlock({
            maxes: [typed],
            refusal: 'house_program_block_not_open',
            opensOn: '2026-11-28',
            lastStartDay: '2026-12-05',
          }),
          powerbuilding({
            maxes: [typed],
            refusal: 'mesocycle_overlap',
            opensOn: '2026-11-28',
            lastStartDay: null,
          }),
        ],
      }),
  });

  const pass = page.locator('[data-pass]');
  await expect(pass).toContainText('Strength Base 1 runs until Fri 27 Nov.');
  await expect(pass.getByRole('link', { name: 'Open Training' })).toHaveAttribute(
    'href',
    '/training/program',
  );
  await expect(card(page, BASE_2_LISTING).locator('[data-refusal]')).toHaveText(
    'Block 2 of Strength Base opens on Sat 28 Nov, once block 1 has ended.',
  );
  await expect(card(page, POWER_LISTING).locator('[data-refusal]')).toHaveText(
    '“Strength Base 1” runs until Fri 27 Nov. One program at a time.',
  );
  await expect(page.locator('[data-start-program]')).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test.describe('a Start the server refuses', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 409 .*\/api\/training\/me\/house-programs\/.*\/start/],
    },
  });

  test('as changed reads the list again and says so, with focus on the sentence', async ({
    page,
  }) => {
    const scene = await openPrograms(page, 390, 844, {
      programs: (current) =>
        current.starts.length === 0
          ? passRead(140)
          : housePrograms({
              pass: proPass(),
              programs: [
                houseProgram({
                  templateVersionId: '00000000-0000-4000-8000-00000000f1ff',
                  maxes: [programMax({ value: 140, from: 'Typed', on: '2026-11-14' })],
                  canStart: true,
                  refusal: null,
                  lastStartDay: '2026-11-27',
                }),
              ],
            }),
      start: () => ({
        status: 409,
        body: {
          code: 'house_program_changed',
          message: 'TB Gym changed this program since you read it. Read it again, then start it.',
        },
      }),
    });

    await card(page, BASE_1_LISTING).getByRole('button', { name: 'Start Strength Base 1' }).click();
    await page
      .getByRole('dialog', { name: 'Start Strength Base 1?' })
      .getByRole('button', { name: 'Start program' })
      .click();

    const notice = page.locator('[data-notice]');
    await expect(notice).toHaveText(
      'TB Gym changed this program since you read it. Read it again, then start it.',
    );
    await expect(notice).toBeFocused();
    await expect(page.locator('[data-program]')).toHaveCount(1);
    await expect(page).toHaveURL(/\/training\/house-programs$/);
    expect(scene.reads).toBe(2);
    await expectNoAxeViolations(page);
  });

  test('as overlapping, after another tab started a program, reads the list again and each card says its own', async ({
    page,
  }) => {
    const typed = programMax({ value: 140, from: 'Typed', on: '2026-11-14' });
    const scene = await openPrograms(page, 390, 844, {
      programs: (current) =>
        current.starts.length === 0
          ? passRead(140)
          : housePrograms({
              pass: proPass(),
              running: runningBlock({ name: 'Powerbuilding 6', endDateExclusive: '2026-12-26' }),
              programs: [
                houseProgram({
                  maxes: [typed],
                  refusal: 'mesocycle_overlap',
                  opensOn: '2026-12-26',
                  lastStartDay: '2026-11-27',
                }),
              ],
            }),
      start: () => ({
        status: 409,
        body: {
          code: 'mesocycle_overlap',
          message: '"Powerbuilding 6" runs until Fri 25 Dec. One program at a time.',
        },
      }),
    });
    const first = card(page, BASE_1_LISTING);
    await expect(first.getByRole('button', { name: 'Start Strength Base 1' })).toBeVisible();
    forgetLoadCalls(scene);

    await first.getByRole('button', { name: 'Start Strength Base 1' }).click();
    await page
      .getByRole('dialog', { name: 'Start Strength Base 1?' })
      .getByRole('button', { name: 'Start program' })
      .click();

    const notice = page.locator('[data-notice]');
    await expect(notice).toHaveText(
      'Your programs changed since you read them. Here they are again.',
    );
    await expect(notice).toBeFocused();
    await expect(first.locator('[data-refusal]')).toHaveText(
      '“Powerbuilding 6” runs until Fri 25 Dec. One program at a time.',
    );
    await expect(page.locator('[data-pass]')).toContainText(
      'Powerbuilding 6 runs until Fri 25 Dec.',
    );
    await expect(page.locator('[data-start-program], [data-start-problem]')).toHaveCount(0);
    await expect(page.getByText(/plan has ended/)).toHaveCount(0);
    expect(scene.reads).toBe(2);
    expect(tokenBeforeEachWrite(scene.calls)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

test.describe('outside TB Gym’s own space', () => {
  // The programs read answers 404 there (TRN-034), which the browser logs.
  test.use({
    allowedConsoleErrors: { patterns: [/status of 404 .*\/api\/training\/me\/house-programs/] },
  });

  test('a coach’s client reads that the programs aren’t open there, with the way back to Training', async ({
    page,
  }) => {
    const scene = await openPrograms(page, 390, 844, {
      membership: ATLAS_CLIENT,
      selfDirected: false,
      gone: true,
    });

    const gone = page.locator('[data-programs-gone]');
    await expect(gone.getByRole('heading', { name: 'Programs aren’t open here' })).toBeVisible();
    await expect(gone).toContainText(
      'TB Gym’s programs are for people who train with TB Gym on their own.',
    );
    await expect(gone.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
      'href',
      '/training/program',
    );
    await expect(page.locator('[data-program], [data-pass]')).toHaveCount(0);
    expect(scene.calls).not.toContain('GET /api/house-plans/me');
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });
});

test('at 390px the page and its sheet follow dark mode and stay on the screen at 200% text', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openPrograms(page, 390, 844, { programs: () => passRead(null) });
  const first = card(page, BASE_1_LISTING);
  const surface = await first.evaluate((element) => getComputedStyle(element).backgroundColor);
  const [red, green, blue] = (surface.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  expect(
    (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255,
    'a card is drawn dark',
  ).toBeLessThan(0.2);
  await first.locator('summary', { hasText: 'Week 1' }).click();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9c4-programs-390-dark.png'),
    fullPage: true,
  });

  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9c4-programs-390-dark-200.png'),
    fullPage: true,
  });

  await first.getByRole('button', { name: 'Type your maxes, for Strength Base 1' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your maxes' });
  await expect(sheet.getByLabel('Back squat')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: test.info().outputPath('n9c4-maxes-390-dark-200.png') });
});
