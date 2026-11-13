import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  MediaAccessView,
  OwnWorkoutView,
  PoolExerciseView,
} from '../src/app/core/api/generated';
import { finishedProfile } from '../src/testing/intake-fixtures';
import {
  ownExerciseView,
  ownSetView,
  ownWorkoutView,
  POOL_BENCH_PRESS,
  POOL_DUMBBELL_ROW,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  POOL_ROMANIAN_DEADLIFT,
  POOL_WALKING_LUNGE,
  poolExercise,
  poolResult,
} from '../src/testing/own-workout-fixtures';
import { personFacing } from './axe-target-size';
import {
  batchesOf,
  clipGrant,
  demoHandlers,
  expectClipProperties,
  expectLoops,
  expectPlaying,
  expectStill,
  linkGrant,
  type MediaRequest,
  pictureGrant,
  recordClip,
  watchMedia,
  YOUTUBE_WATCH,
} from './demo-clip-support';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * TB Gym's exercise pool (notes plan N9b4, LIB-006) in a real browser: a trainee of the house
 * browses, searches and filters its exercises, each card topped with its demo playing like a GIF once
 * it nears the screen, opens one and starts a workout with it. The clip is a WebM each worker records
 * itself (nothing is committed), served from its grant's own address as the API serves it. No check
 * reads today's date: the far-zone project runs these in Kiritimati.
 */

type Handler = (route: Route) => Promise<void> | void;

/** TB Gym's own coaching space, whose trainees train with no coach (notes plan N9a2). */
const HOUSE = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};
/** A coach's client, in a coach's own space: the pool is not theirs (LIB-006). */
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

const BACK_SQUAT = poolExercise('Back squat', {
  muscles: [
    { muscle: 'Quadriceps', role: 'Primary' },
    { muscle: 'Glutes', role: 'Secondary' },
  ],
  demos: [{ mediaAssetId: 'clip-squat', kind: 'Video' }],
});
const PULL_UP = poolExercise('Pull-up', {
  equipment: 'Bodyweight',
  movementPattern: 'VerticalPull',
  muscles: [{ muscle: 'Back', role: 'Primary' }],
});
const SEATED_ROW = poolExercise('Seated cable row', {
  equipment: 'Cable',
  movementPattern: 'HorizontalPull',
  muscles: [
    { muscle: 'Back', role: 'Primary' },
    { muscle: 'Biceps', role: 'Secondary' },
  ],
});
/**
 * The pool in name order, as the server sorts it: two clips at the top, a picture, a YouTube link,
 * some with no demo, and Walking lunge last, whose three demos (picture, video, link) show as a clip.
 */
const POOL: readonly PoolExerciseView[] = [
  BACK_SQUAT,
  POOL_BENCH_PRESS,
  POOL_DUMBBELL_ROW,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  PULL_UP,
  POOL_ROMANIAN_DEADLIFT,
  SEATED_ROW,
  POOL_WALKING_LUNGE,
];
const NAMES = POOL.map((exercise) => exercise.name);
/** The same with four more before Walking lunge, so its clip sits well below a phone's screen. */
const LONGER_POOL: readonly PoolExerciseView[] = [
  ...POOL.slice(0, -1),
  poolExercise('Side plank', {
    equipment: 'None',
    movementPattern: 'Other',
    muscles: [{ muscle: 'Abdominals', role: 'Primary' }],
  }),
  poolExercise('Split squat', { equipment: 'Dumbbell' }),
  poolExercise('Step-up', { equipment: 'Dumbbell' }),
  poolExercise('Sumo deadlift', {
    movementPattern: 'Hinge',
    muscles: [{ muscle: 'Glutes', role: 'Primary' }],
  }),
  POOL_WALKING_LUNGE,
];
/** Each card's line: its equipment, unless it needs none, and its main muscle. */
const DETAILS = [
  'Barbell · Quadriceps',
  'Barbell · Chest',
  'Dumbbell · Back',
  'Kettlebell · Quadriceps',
  'Abdominals',
  'Bodyweight · Back',
  'Barbell · Hamstrings',
  'Cable · Back',
  'Quadriceps',
];
/** Every demo's grant: an upload's bytes come from its own address, a link opens on YouTube. */
const GRANTS: readonly MediaAccessView[] = [
  clipGrant('clip-squat'),
  clipGrant('m-goblet-video'),
  pictureGrant('m-row-photo'),
  linkGrant('m-rdl-link'),
  pictureGrant('m-lunge-photo'),
  clipGrant('m-lunge-video'),
  linkGrant('m-lunge-link'),
];

const OWN = 'own-1';
const OWN_ROUTE = `/api/training/me/workouts/${OWN}`;
/** The player's read of what comes next, for a trainee with no program (CLI-026). */
const NO_PROGRAM = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-11-13',
  timeZoneId: 'Asia/Beirut',
  hasAssignedProgram: false,
  hasVisibleSessions: false,
  searchThrough: '2027-02-11',
  nextSession: null,
  unfinishedWorkouts: [],
  nextSkip: null,
  todayCoverage: { activeBlock: null, nextBlockStartDate: null },
};

/** One clip per worker, recorded in its own browser before the first check. */
let clip: Buffer;
test.beforeAll(async ({ browser }) => {
  clip = await recordClip(browser);
});

interface Options {
  readonly pool?: readonly PoolExerciseView[];
  readonly membership?: typeof HOUSE;
  /** The reader trains alone in TB Gym's space (CLI-026); a client a coach invited does not. */
  readonly selfDirected?: boolean;
  /** Training is closed, for this reason: the pool's reads say so. */
  readonly closed?: string;
  /** The pool answers 404, as it does in any space but TB Gym's own (LIB-006). */
  readonly gone?: boolean;
  /** The workout of one's own Today holds, not finished. */
  readonly unfinished?: OwnWorkoutView;
  /** A start meets this workout, started on another phone: refused, and Today's from then on. */
  readonly runningElsewhere?: OwnWorkoutView;
  /** Where the page opens: the pool by default. */
  readonly path?: string;
}

interface Scene {
  /** Each read of the pool's list, its query, in order. */
  readonly reads: URLSearchParams[];
  /** Every request for media, in order. */
  readonly media: MediaRequest[];
  /** Every call to the API, `METHOD /path`, in order. */
  readonly calls: string[];
  /** Every write to a workout of one's own, its route and body, in order. */
  readonly writes: { route: string; body: unknown }[];
}

/**
 * A trainee of the house signed in, with the pool's two reads (searched and filtered as the server
 * does: every word in the name, a muscle in any role, the equipment exactly, then skip and take),
 * every demo's grant and bytes, and N9b2's routes for a workout of one's own, as the server answers
 * them: every change answers the whole workout on its next version, and Today carries it as it runs.
 */
async function session(page: Page, options: Options = {}): Promise<Scene> {
  const pool = options.pool ?? POOL;
  const reads: URLSearchParams[] = [];
  const calls: string[] = [];
  const writes: { route: string; body: unknown }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) calls.push(`${request.method()} ${url.pathname}`);
  });
  const media = watchMedia(page);
  const training = options.closed ?? 'Granted';
  const notHere = (route: Route) => json(route, 404, { title: 'Not Found', status: 404 });
  let workout: OwnWorkoutView | null = options.unfinished ?? null;
  const current = (): OwnWorkoutView => {
    if (!workout) throw new Error('No workout of one’s own is running.');
    return workout;
  };
  const written = (route: Route) =>
    writes.push({
      route: `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      body: route.request().postDataJSON(),
    });
  const changed = (exercises: OwnWorkoutView['exercises']) => {
    workout = { ...current(), version: Number(current().version) + 1, exercises };
    return workout;
  };
  const handlers: Record<string, Handler> = {
    'GET /api/client-access/me': (route) =>
      json(
        route,
        200,
        FEATURES.map((feature) => {
          const reason = feature === 'Training' ? training : 'NoEntitlement';
          return { feature, isAllowed: reason === 'Granted', reason };
        }),
      ),
    'GET /api/client-profile/me': (route) =>
      json(route, 200, finishedProfile({ selfDirected: options.selfDirected ?? true })),
    'GET /api/exercise-pool': (route) => {
      const asked = new URL(route.request().url()).searchParams;
      reads.push(asked);
      if (options.gone) return notHere(route);
      if (options.closed) {
        return json(route, 200, {
          isAllowed: false,
          accessReason: options.closed,
          total: 0,
          items: [],
        });
      }
      const words = (asked.get('query') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const muscle = asked.get('muscle');
      const equipment = asked.get('equipment');
      const found = pool
        .filter((exercise) => words.every((word) => exercise.name.toLowerCase().includes(word)))
        .filter((exercise) => !muscle || exercise.muscles.some((one) => one.muscle === muscle))
        .filter((exercise) => !equipment || exercise.equipment === equipment);
      const skip = Number(asked.get('skip') ?? 0);
      return json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        total: found.length,
        items: found.slice(skip, skip + Number(asked.get('take') ?? 50)),
      });
    },
    ...demoHandlers(clip, GRANTS),
    'GET /api/training/me/today': (route) =>
      json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: '2026-11-13',
        workouts: [],
        ownWorkout: workout?.status === 'InProgress' ? workout : null,
      }),
    'GET /api/training/me/upcoming': (route) => json(route, 200, NO_PROGRAM),
    'POST /api/training/me/workouts': (route) => {
      written(route);
      if (options.runningElsewhere) {
        workout = options.runningElsewhere;
        return json(route, 409, {
          code: 'own_workout_in_progress',
          message:
            'You have a workout you have not finished. Carry on with it, or finish it first.',
        });
      }
      workout = ownWorkoutView({ exercises: [], version: 1 });
      return json(route, 200, workout);
    },
    // The server adds no set with an exercise (N9b2): the page asks for its empty set next.
    [`POST ${OWN_ROUTE}/exercises`]: (route) => {
      written(route);
      const { exerciseId } = route.request().postDataJSON() as { exerciseId: string };
      const exercise = pool.find((item) => item.id === exerciseId)!;
      const exercises = current().exercises;
      return json(
        route,
        200,
        changed([
          ...exercises,
          ownExerciseView({
            performanceId: `perf-${exercise.id}`,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            position: exercises.length + 1,
            mediaAssetIds: exercise.demos.map((demo) => demo.mediaAssetId),
            sets: [],
          }),
        ]),
      );
    },
  };
  for (const exercise of pool) {
    handlers[`GET /api/exercise-pool/${exercise.id}`] = (route) => {
      if (options.gone) return notHere(route);
      return json(
        route,
        200,
        options.closed
          ? poolResult(null, { isAllowed: false, accessReason: options.closed })
          : poolResult(exercise),
      );
    };
    const row = `perf-${exercise.id}`;
    handlers[`POST ${OWN_ROUTE}/exercises/${row}/sets`] = (route) => {
      written(route);
      return json(
        route,
        200,
        changed(
          current().exercises.map((item) =>
            item.performanceId === row
              ? {
                  ...item,
                  sets: [
                    ...item.sets,
                    ownSetView({
                      performanceId: `set-${exercise.id}-${item.sets.length + 1}`,
                      position: item.sets.length + 1,
                    }),
                  ],
                }
              : item,
          ),
        ),
      );
    };
  }
  await mockSession(page, {
    memberships: [options.membership ?? HOUSE],
    user: TRAINEE,
    extra: handlers,
  });
  return { reads, media, calls, writes };
}

/** The pool's page, its heading drawn. */
async function openPool(
  page: Page,
  width: number,
  height: number,
  options: Options = {},
): Promise<Scene> {
  await page.setViewportSize({ width, height });
  const scene = await session(page, options);
  await page.goto(options.path ?? '/training/pool');
  await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible();
  await waitForFonts(page);
  return scene;
}

/** An exercise's own page, its name drawn as the page's heading. */
async function openExercise(
  page: Page,
  width: number,
  height: number,
  exercise: PoolExerciseView,
  options: Options = {},
): Promise<Scene> {
  await page.setViewportSize({ width, height });
  const scene = await session(page, options);
  await page.goto(`/training/pool/${exercise.id}`);
  await expect(page.getByRole('heading', { level: 1, name: exercise.name })).toBeVisible();
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

/** Each batch grant came after an antiforgery read of its own, as a write after sign-in must. */
function tokenBeforeEachBatch(calls: readonly string[]): boolean {
  let tokens = 0;
  let batches = 0;
  for (const call of calls) {
    if (call === 'GET /api/auth/csrf') tokens++;
    else if (call === 'POST /api/media/access' && ++batches > tokens) return false;
  }
  return true;
}

/** The media requests that name `assetId`: a batch holding it, its own grant or its bytes. */
function askedFor(media: readonly MediaRequest[], assetId: string): MediaRequest[] {
  return media.filter(
    (request) => request.assetIds?.includes(assetId) || request.path.includes(`/${assetId}/`),
  );
}

/**
 * What `selector` finds that runs past the screen's sides or past its own box. At 200% text a
 * control wraps or grows; it never pushes anything off the screen (WCAG 1.4.10).
 */
function pastTheEdge(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left < -1 || box.right > width + 1 || element.scrollWidth > element.clientWidth + 1
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${element.className} "${element.textContent?.trim().slice(0, 40)}"`,
      );
  }, selector);
}

/** How light an element's own background is, 0 for black to 1 for white, read through a canvas. */
function lightness(locator: Locator): Promise<{ luminance: number; alpha: number }> {
  return locator.evaluate((element) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = getComputedStyle(element).backgroundColor;
    paint.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = paint.getImageData(0, 0, 1, 1).data;
    const linear = (value: number) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return {
      luminance: 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue),
      alpha,
    };
  });
}

/** The card of the exercise named `name`. */
const card = (page: Page, name: string) =>
  page
    .locator('li.exercise')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

const LIST_PARTS =
  '.page-head, .page-head h1, .lede, .toolbar, .find, .search, .chips, .chips button, app-demo-clips-toggle button, .summary, li.exercise, li.exercise .name, li.exercise .detail';
const EXERCISE_PARTS =
  'a.back, h1, .demo-area, .demo-area app-demo-clip, .all-demos button, .offer, .offer button, .offer .note, .facts, .fact, .fact dt, .fact dd, .how, .instructions';

for (const [width, height] of SIZES) {
  test(`at ${width}px TB Gym’s pool lists its exercises in the server’s order, each with its line, and passes the scan`, async ({
    page,
  }) => {
    const scene = await openPool(page, width, height);

    const cards = page.locator('li.exercise');
    await expect(cards.locator('h2')).toHaveText(NAMES);
    await expect(cards.locator('.detail')).toHaveText(DETAILS);
    await expect(page.locator('.kicker')).toHaveText('TB Gym’s pool');
    await expect(page.locator('.summary')).toHaveText('9 exercises');
    await expect(cards.first().getByRole('link', { name: 'Back squat' })).toHaveAttribute(
      'href',
      '/training/pool/pool-back-squat',
    );
    // One read: the first page, with nothing to filter by.
    expect(scene.reads.map(String)).toEqual(['skip=0&take=50']);
    // The pool is part of Training, which stays the tab in use.
    await expect(
      page.locator('app-client-tabs').getByRole('link', { name: 'Training' }),
    ).toHaveAttribute('aria-current', 'true');
    // Clips play by themselves only where nothing asked for less: here, every one is a still.
    await expect(page.getByRole('button', { name: 'Play demos' })).toBeVisible();
    await expect(cards.first().locator('app-demo-clip')).toHaveAttribute(
      'data-clip-state',
      'ready',
    );
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath(`n9b4-pool-${width}.png`),
      fullPage: true,
    });
  });
}

test('the search and each filter go into the address and the read and narrow the list, and Clear filters shows every exercise', async ({
  page,
}) => {
  const scene = await openPool(page, 1440, 900);
  const names = page.locator('li.exercise h2');
  const search = page.getByRole('searchbox', { name: 'Search exercises' });
  const address = () => Object.fromEntries(new URL(page.url()).searchParams);
  const lastRead = () => Object.fromEntries(scene.reads.at(-1) ?? []);
  await expect(names).toHaveText(NAMES);
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  await search.fill('squat');
  await expect(names).toHaveText(['Back squat', 'Goblet squat']);
  expect(address()).toEqual({ q: 'squat' });
  expect(lastRead()).toEqual({ skip: '0', take: '50', query: 'squat' });
  await expect(page.locator('.summary')).toHaveText('2 exercises match');

  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await page.locator('ul.panel').getByRole('button', { name: 'Kettlebell', exact: true }).click();
  await expect(names).toHaveText(['Goblet squat']);
  expect(address()).toEqual({ q: 'squat', equipment: 'Kettlebell' });
  expect(lastRead()).toEqual({ skip: '0', take: '50', query: 'squat', equipment: 'Kettlebell' });
  await expect(page.getByRole('button', { name: 'Equipment: Kettlebell' })).toHaveClass(/selected/);
  await expect(page.locator('.summary')).toHaveText('1 exercise matches');

  // An exercise opened from a search keeps it, and its way back finds the same list.
  const link = page.getByRole('link', { name: 'Goblet squat' });
  await expect(link).toHaveAttribute(
    'href',
    '/training/pool/pool-goblet-squat?q=squat&equipment=Kettlebell',
  );
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Goblet squat' })).toBeVisible();
  await page.getByRole('link', { name: 'Exercises', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible();
  await expect(names).toHaveText(['Goblet squat']);
  expect(address()).toEqual({ q: 'squat', equipment: 'Kettlebell' });
  await expect(search).toHaveValue('squat');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(names).toHaveText(NAMES);
  expect(address()).toEqual({});
  expect(lastRead()).toEqual({ skip: '0', take: '50' });
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  // A muscle the exercise works, as its main muscle or another.
  await page.getByRole('button', { name: 'Muscle', exact: true }).click();
  await page.locator('ul.panel').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(names).toHaveText(['Dumbbell row', 'Pull-up', 'Seated cable row']);
  expect(address()).toEqual({ muscle: 'Back' });
  expect(lastRead()).toEqual({ skip: '0', take: '50', muscle: 'Back' });
  await expect(page.getByRole('button', { name: 'Muscle: Back' })).toHaveClass(/selected/);
  await expect(page.locator('.summary')).toHaveText('3 exercises match');
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test('a filter the pool does not know is left out of the read, and the rest still applies', async ({
  page,
}) => {
  const scene = await openPool(page, 390, 844, {
    path: '/training/pool?muscle=Wings&equipment=Kettlebell',
  });

  await expect(page.locator('li.exercise h2')).toHaveText(['Goblet squat']);
  expect(scene.reads.map((read) => Object.fromEntries(read))).toEqual([
    { skip: '0', take: '50', equipment: 'Kettlebell' },
  ]);
  await expect(page.getByRole('button', { name: 'Muscle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipment: Kettlebell' })).toBeVisible();
});

test('Show more reads the page after the first 50 and takes the focus to the first exercise it adds', async ({
  page,
}) => {
  const many = Array.from({ length: 55 }, (_, index) =>
    poolExercise(`Drill ${String(index + 1).padStart(2, '0')}`),
  );
  const scene = await openPool(page, 390, 844, { pool: many });
  const cards = page.locator('li.exercise');
  await expect(cards).toHaveCount(50);
  await expect(page.locator('.summary')).toHaveText('50 of 55 shown');
  // Nothing in the list plays by itself, so there is nothing to pause.
  await expect(page.locator('app-demo-clip, app-demo-clips-toggle')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show more exercises' }).click();

  await expect(cards).toHaveCount(55);
  await expect(cards.locator('h2').last()).toHaveText('Drill 55');
  await expect(page.locator('.summary')).toHaveText('55 exercises');
  await expect(page.getByRole('link', { name: 'Drill 51', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Show more exercises' })).toHaveCount(0);
  expect(scene.reads.map(String)).toEqual(['skip=0&take=50', 'skip=50&take=50']);
});

test('with motion allowed, a clip far down the list asks for nothing until it nears the screen, then plays muted, looping and inline', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const scene = await openPool(page, 390, 844, { pool: LONGER_POOL });
  const cards = page.locator('li.exercise');
  await expect(cards).toHaveCount(LONGER_POOL.length);
  await expect(cards.locator('h2').last()).toHaveText('Walking lunge');
  const first = cards.first().locator('app-demo-clip');
  const last = cards.last().locator('app-demo-clip');
  await expect(first).toHaveAttribute('data-clip-state', 'ready');
  await expectPlaying(first.locator('video'));
  await expect(page.getByRole('button', { name: 'Pause demos' })).toBeVisible();

  // The last card is further down than a clip looks ahead (200 px): nothing is asked for it yet.
  const box = await last.boundingBox();
  expect(box?.y ?? 0, 'the last clip sits far below the screen').toBeGreaterThan(844 + 200);
  await expect(last).toHaveAttribute('data-clip-state', 'waiting');
  expect(askedFor(scene.media, 'm-lunge-video')).toEqual([]);
  // What was near went in one batch, the top clip among it.
  expect(batchesOf(scene.media)[0]).toContain('clip-squat');

  await last.scrollIntoViewIfNeeded();

  await expect(last).toHaveAttribute('data-clip-state', 'ready');
  const video = last.locator('video');
  // Only the chosen demo of three, the video, never the picture or the link beside it.
  await expect(video).toHaveAttribute('src', '/api/media/m-lunge-video/content');
  await expectClipProperties(video);
  await expectPlaying(video);
  await expectLoops(video);
  // Its grant came first, in a batch, then its bytes, once.
  const asked = askedFor(scene.media, 'm-lunge-video');
  expect(asked.map((request) => `${request.method} ${request.path}`)).toEqual([
    'POST /api/media/access',
    'GET /api/media/m-lunge-video/content',
  ]);
  const flat = batchesOf(scene.media).flat();
  for (const other of ['m-lunge-photo', 'm-lunge-link', 'm-rdl-link']) {
    expect(flat, `${other} is never asked from the list`).not.toContain(other);
  }
  // Each id is asked once, each batch in the house's name and after an antiforgery read.
  expect(new Set(flat).size).toBe(flat.length);
  expect(
    scene.media.filter((request) => request.path === '/api/media/access').map((r) => r.tenant),
  ).toEqual(batchesOf(scene.media).map(() => HOUSE.tenantId));
  expect(tokenBeforeEachBatch(scene.calls)).toBe(true);
});

test('for a person who asked for reduced motion each clip is a still, until Play demos plays them all', async ({
  page,
}) => {
  await openPool(page, 390, 844);
  const videos = ['Back squat', 'Goblet squat'].map((name) =>
    card(page, name).locator('app-demo-clip video'),
  );
  for (const video of videos) {
    await expectClipProperties(video);
    await expectStill(video);
  }
  const toggle = page.locator('[data-clips-toggle]');
  await expect(toggle).toHaveText('Play demos');

  await toggle.click();

  await expect(toggle).toHaveText('Pause demos');
  for (const video of videos) await expectPlaying(video);

  await toggle.click();

  await expect(toggle).toHaveText('Play demos');
  for (const video of videos) await expect(video).toHaveJSProperty('paused', true);
});

test('a picture stays a picture, a link is a play tile that asks for nothing, and an exercise with no demo shows none', async ({
  page,
}) => {
  const scene = await openPool(page, 1440, 900);
  const cards = page.locator('li.exercise');
  await cards.last().locator('app-demo-clip').scrollIntoViewIfNeeded();
  await expect(cards.last().locator('app-demo-clip')).toHaveAttribute('data-clip-state', 'ready');

  const picture = card(page, 'Dumbbell row').locator('app-demo-clip');
  await expect(picture).toHaveAttribute('data-clip-state', 'ready');
  const image = picture.locator('img');
  await expect(image).toHaveAttribute('src', '/api/media/m-row-photo/content');
  // A thumbnail the card's link names: no words of its own.
  await expect(image).toHaveAttribute('alt', '');
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(4);
  await expect(picture.locator('video')).toHaveCount(0);

  const tile = card(page, 'Romanian deadlift').locator('app-demo-clip');
  await expect(tile).toHaveAttribute('data-clip-state', 'tile');
  await expect(tile.locator('.tile')).toBeVisible();
  await expect(tile.locator('video, img, iframe, a, button')).toHaveCount(0);

  // No demo: no clip, only the exercise's letters, which assistive technology skips.
  for (const [name, letters] of [
    ['Bench press', 'BP'],
    ['Plank', 'PL'],
    ['Pull-up', 'PU'],
    ['Seated cable row', 'SC'],
  ]) {
    await expect(card(page, name).locator('app-demo-clip'), name).toHaveCount(0);
    await expect(card(page, name).locator('.letters'), name).toHaveText(letters);
    await expect(card(page, name).locator('.letters'), name).toHaveAttribute('aria-hidden', 'true');
  }
  // The list asks for the uploads it shows, each once, and never for a link.
  expect([...batchesOf(scene.media).flat()].sort()).toEqual([
    'clip-squat',
    'm-goblet-video',
    'm-lunge-video',
    'm-row-photo',
  ]);
  expect(askedFor(scene.media, 'm-rdl-link')).toEqual([]);

  // On its own page, the link opens on YouTube, in a new tab, after a grant of its own.
  await card(page, 'Romanian deadlift').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Romanian deadlift' })).toBeVisible();
  const demo = page.locator('.demo-area app-demo-clip');
  await expect(demo).toContainText(
    'This demo is a video on YouTube. It opens there, in a new tab.',
  );
  const watch = demo.locator('a[data-watch-external]');
  await expect(watch).toHaveAttribute('href', YOUTUBE_WATCH);
  await expect(watch).toHaveAttribute('target', '_blank');
  await expect(watch).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(watch).toHaveAccessibleName('Watch on YouTube (opens in a new tab)');
  await expect(demo.locator('video, img, iframe')).toHaveCount(0);
  expect(askedFor(scene.media, 'm-rdl-link').map((r) => `${r.method} ${r.path}`)).toEqual([
    'POST /api/media/m-rdl-link/access',
  ]);
  await expectNoAxeViolations(page);

  // An exercise with no demo has no demo area at all.
  await page.getByRole('link', { name: 'Exercises', exact: true }).click();
  await card(page, 'Bench press').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bench press' })).toBeVisible();
  await expect(page.locator('[data-fact="equipment"] dd')).toHaveText('Barbell');
  await expect(page.locator('.demo-area, app-demo-clip, app-exercise-demo')).toHaveCount(0);
});

test('with motion allowed, an exercise’s page plays its clip with a pause of its own, lists what it works and how it is done, and shows every demo', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const scene = await openExercise(page, 390, 844, POOL_WALKING_LUNGE);

  const clip = page.locator('.demo-area app-demo-clip');
  await expect(clip).toHaveAttribute('data-clip-state', 'ready');
  const video = clip.locator('video');
  await expect(video).toHaveAttribute('src', '/api/media/m-lunge-video/content');
  await expect(video).toHaveAttribute('aria-label', 'How to do Walking lunge');
  await expectClipProperties(video);
  await expectPlaying(video);
  await expectLoops(video);
  // Of three demos, only the video was asked for, in one batch.
  expect(batchesOf(scene.media)).toEqual([['m-lunge-video']]);

  const toggle = clip.locator('[data-clip-toggle]');
  await expect(toggle).toHaveAccessibleName('Pause the demo');
  await toggle.click();
  await expect(video).toHaveJSProperty('paused', true);
  await expect(toggle).toHaveAccessibleName('Play the demo');
  await toggle.click();
  await expectPlaying(video);
  await expect(toggle).toHaveAccessibleName('Pause the demo');

  // What it needs and works, in the trainee's words, and the house's own type.
  const fact = (key: string) => page.locator(`[data-fact="${key}"]`);
  await expect(page.locator('[data-fact]')).toHaveCount(5);
  await expect(fact('equipment').locator('dt')).toHaveText('Equipment');
  await expect(fact('equipment').locator('dd')).toHaveText('No equipment');
  await expect(fact('movement').locator('dd')).toHaveText('Locomotion');
  await expect(fact('type').locator('dd')).toHaveText('Rehab');
  await expect(fact('main').locator('dt')).toHaveText('Main muscle');
  await expect(fact('main').locator('dd')).toHaveText('Quadriceps');
  await expect(fact('also').locator('dt')).toHaveText('Also works');
  await expect(fact('also').locator('dd')).toHaveText('Glutes, Hamstrings');
  await expect(page.getByRole('heading', { level: 2, name: 'How to do it' })).toBeVisible();
  // The house's own words, kept as typed, line break and all.
  expect(await page.locator('.instructions').evaluate((element) => element.textContent)).toBe(
    'Step forward and lower the back knee.\nPush through the front heel to stand.',
  );
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9b4-exercise-390.png'),
    fullPage: true,
  });

  // Every demo, one at a time in a sheet: the picture, the video with its controls, the link.
  await page.getByRole('button', { name: 'See all 3 demos' }).click();
  const sheet = page.getByRole('dialog', { name: 'Walking lunge' });
  await expect(sheet.getByRole('img', { name: 'How to do Walking lunge' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Demo 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // A client's thumb in the sheet too (plan §2 rule 6), as on the page under it: each control's height
  // as laid out, since the sheet's entrance (a scale, with motion allowed) draws its box a hair smaller.
  const height = (target: Locator) =>
    target.evaluate((element) => (element as HTMLElement).offsetHeight);
  for (const name of ['Demo 1', 'Demo 2', 'Demo 3']) {
    expect(await height(sheet.getByRole('button', { name })), name).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: 'Demo 2' }).click();
  const sheetVideo = sheet.locator('video');
  await expect(sheetVideo).toHaveAttribute('src', '/api/media/m-lunge-video/content');
  await expectClipProperties(sheetVideo, { controls: true });
  await expect(sheetVideo).toHaveJSProperty('autoplay', true);
  await expectPlaying(sheetVideo);
  await sheet.getByRole('button', { name: 'Demo 3' }).click();
  const watch = sheet.locator('a[data-watch-external]');
  await expect(watch).toHaveAttribute('href', YOUTUBE_WATCH);
  expect(await height(watch), 'Watch on YouTube').toBeGreaterThanOrEqual(44);
  await expect(sheet.locator('video, img, iframe')).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('for a person who asked for reduced motion an exercise’s clip is a still, and Play the demo plays it', async ({
  page,
}) => {
  await openExercise(page, 390, 844, POOL_GOBLET_SQUAT);
  const clip = page.locator('.demo-area app-demo-clip');
  await expect(clip).toHaveAttribute('data-clip-state', 'ready');
  const video = clip.locator('video');
  await expectClipProperties(video);
  await expectStill(video);
  const toggle = clip.locator('[data-clip-toggle]');
  await expect(toggle).toHaveAccessibleName('Play the demo');
  // One demo: no sheet of them all.
  await expect(page.locator('app-exercise-demo')).toHaveCount(0);

  await toggle.click();

  await expectPlaying(video);
  await expect(toggle).toHaveAccessibleName('Pause the demo');

  await toggle.click();

  await expect(video).toHaveJSProperty('paused', true);
  await expect(toggle).toHaveAccessibleName('Play the demo');
});

test('Start a workout reads a fresh token, starts one, adds the exercise with its empty set and opens the player on it', async ({
  page,
}) => {
  const scene = await openExercise(page, 390, 844, POOL_GOBLET_SQUAT);
  await expect(page.locator('.demo-area app-demo-clip')).toHaveAttribute(
    'data-clip-state',
    'ready',
  );
  const start = page.locator('[data-pool-start]');
  // Which exercise, for a screen reader; a sighted person reads it above.
  await expect(start).toHaveAccessibleName(/^Start a workout\s+with\s+Goblet squat$/);
  await expect(page.locator('#pool-add-note')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  const from = scene.calls.length;

  await start.click();

  await expect(page).toHaveURL(`/training/today?sessionId=${OWN}`);
  await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
  await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
  // Its demo is in the player too, under its name.
  const playerClip = page.locator('app-demo-clip.exercise-clip');
  await expect(playerClip).toHaveAttribute('data-clip-state', 'ready');
  await expect(playerClip.locator('video')).toHaveAttribute(
    'src',
    /^\/api\/media\/m-goblet-video\/content/,
  );
  expect(scene.writes).toEqual([
    { route: 'POST /api/training/me/workouts', body: {} },
    {
      route: `POST ${OWN_ROUTE}/exercises`,
      body: { exerciseId: POOL_GOBLET_SQUAT.id, version: 1 },
    },
    {
      route: `POST ${OWN_ROUTE}/exercises/perf-${POOL_GOBLET_SQUAT.id}/sets`,
      body: { version: 2 },
    },
  ]);
  // One fresh token for the chain, before its first write.
  expect(
    scene.calls
      .slice(from)
      .filter((call) => call === 'GET /api/auth/csrf' || call.includes('/api/training/me/workouts'))
      .slice(0, 4),
  ).toEqual([
    'GET /api/auth/csrf',
    'POST /api/training/me/workouts',
    `POST ${OWN_ROUTE}/exercises`,
    `POST ${OWN_ROUTE}/exercises/perf-${POOL_GOBLET_SQUAT.id}/sets`,
  ]);
});

test('with a workout not finished, the page adds the exercise to it instead, with its empty set', async ({
  page,
}) => {
  const scene = await openExercise(page, 390, 844, POOL_DUMBBELL_ROW, {
    unfinished: ownWorkoutView(),
  });
  await expect(page.locator('.demo-area app-demo-clip')).toHaveAttribute(
    'data-clip-state',
    'ready',
  );
  const add = page.locator('[data-pool-start]');
  await expect(add).toHaveText('Add to your workout');
  await expect(add).toHaveAccessibleDescription('It goes into the workout you haven’t finished.');
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  await add.click();

  await expect(page).toHaveURL(`/training/today?sessionId=${OWN}`);
  await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
  await expect(page.locator('.exercise-heading .eyebrow')).toContainText('OF 2');
  // No new workout: the exercise and its set go into the one running, on its version.
  expect(scene.writes).toEqual([
    {
      route: `POST ${OWN_ROUTE}/exercises`,
      body: { exerciseId: POOL_DUMBBELL_ROW.id, version: 5 },
    },
    {
      route: `POST ${OWN_ROUTE}/exercises/perf-${POOL_DUMBBELL_ROW.id}/sets`,
      body: { version: 6 },
    },
  ]);
});

test('a client of the house who has a coach reads an exercise but is offered no workout of their own', async ({
  page,
}) => {
  const scene = await openExercise(page, 390, 844, POOL_GOBLET_SQUAT, { selfDirected: false });
  await expect(page.locator('[data-fact="equipment"] dd')).toHaveText('Kettlebell');
  await expect.poll(() => scene.calls.includes('GET /api/client-profile/me')).toBe(true);
  await expect(page.locator('.demo-area app-demo-clip')).toHaveAttribute(
    'data-clip-state',
    'ready',
  );
  await expect(page.locator('[data-pool-start], .offer')).toHaveCount(0);
});

test.describe('a start the server refuses', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\/me\/workouts/] },
  });

  test('one already running elsewhere is said with Carry on, and the page offers to add to it', async ({
    page,
  }) => {
    const scene = await openExercise(page, 390, 844, POOL_GOBLET_SQUAT, {
      runningElsewhere: ownWorkoutView(),
    });
    await expect(page.locator('.demo-area app-demo-clip')).toHaveAttribute(
      'data-clip-state',
      'ready',
    );

    await page.locator('[data-pool-start]').click();

    await expect(page.locator('.problem-box').getByRole('alert')).toHaveText(
      'You have a workout you haven’t finished. Carry on with it, or finish it first.',
    );
    const carryOn = page.locator('[data-carry-on]');
    await expect(carryOn).toHaveAccessibleName('Carry on');
    await expect(carryOn).toHaveAttribute('href', `/training/today?sessionId=${OWN}`);
    await expect(page.locator('[data-pool-start]')).toHaveText('Add to your workout');
    await expect(page).toHaveURL(`/training/pool/${POOL_GOBLET_SQUAT.id}`);
    expect(scene.writes.map((write) => write.route)).toEqual(['POST /api/training/me/workouts']);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await carryOn.click();

    await expect(page).toHaveURL(`/training/today?sessionId=${OWN}`);
    await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
  });
});

test('with Training closed the pool says so in TB Gym’s words, and so does an exercise’s page', async ({
  page,
}) => {
  const scene = await openPool(page, 390, 844, { closed: 'RelationshipBlocked' });
  const closed = page.locator('[data-pool-closed]');
  await expect(closed.getByRole('heading', { name: 'The pool is closed for now' })).toBeVisible();
  await expect(closed).toContainText('TB Gym has paused your access.');
  await expect(closed).not.toContainText(/coach/i);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('li.exercise, app-demo-clip')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  await page.goto(`/training/pool/${BACK_SQUAT.id}`);
  const closedHere = page.locator('[data-pool-closed]');
  await expect(
    closedHere.getByRole('heading', { level: 1, name: 'The pool is closed for now' }),
  ).toBeVisible();
  await expect(closedHere).toContainText('TB Gym has paused your access.');
  await expect(page.locator('[data-pool-start], app-demo-clip')).toHaveCount(0);
  expect(scene.media).toEqual([]);
  await expectNoAxeViolations(page);
});

test('an empty pool says TB Gym adds its exercises, with nothing to search', async ({ page }) => {
  await openPool(page, 390, 844, { pool: [] });
  const empty = page.locator('[data-pool-empty]');
  await expect(empty.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();
  await expect(empty).toContainText(
    'No exercises are in the pool yet. TB Gym adds them, so check back soon.',
  );
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('app-menu, li.exercise')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});

test('a search from the address that finds nothing says so, and Show all exercises brings them back', async ({
  page,
}) => {
  const scene = await openPool(page, 390, 844, { path: '/training/pool?q=zzz' });
  const none = page.locator('[data-pool-no-match]');
  await expect(none.getByRole('heading', { name: 'No exercise matches' })).toBeVisible();
  await expect(none).toContainText('Try another word, or clear the filters.');
  // The status line says it too, where the count was, so a screen reader hears what a search found.
  const status = page.locator('.summary[role="status"]');
  await expect(status).toHaveText('No exercise matches');
  const search = page.getByRole('searchbox', { name: 'Search exercises' });
  await expect(search).toHaveValue('zzz');
  expect(scene.reads.map((read) => Object.fromEntries(read))).toEqual([
    { skip: '0', take: '50', query: 'zzz' },
  ]);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  await none.getByRole('button', { name: 'Show all exercises' }).click();

  await expect(page.locator('li.exercise h2')).toHaveText(NAMES);
  await expect(page).toHaveURL(/\/training\/pool$/);
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(status).toHaveText('9 exercises');
});

test.describe('outside TB Gym’s own space', () => {
  // The pool's reads answer 404 there (LIB-006), which the browser logs.
  test.use({ allowedConsoleErrors: { patterns: [/status of 404 .*\/api\/exercise-pool/] } });

  test('a coach’s client reads that the pool isn’t open there, on the list and on an exercise’s page', async ({
    page,
  }) => {
    const scene = await openPool(page, 390, 844, {
      membership: ATLAS_CLIENT,
      selfDirected: false,
      gone: true,
    });
    const gone = page.locator('[data-pool-gone]');
    await expect(gone.getByRole('heading', { name: 'The pool isn’t open here' })).toBeVisible();
    await expect(gone).toContainText(
      'TB Gym’s exercise pool is for people training with TB Gym’s own space.',
    );
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.locator('li.exercise')).toHaveCount(0);
    await expect(page.getByText('The exercises couldn’t be loaded.')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await page.goto(`/training/pool/${BACK_SQUAT.id}`);
    const missing = page.locator('[data-pool-gone]');
    await expect(
      missing.getByRole('heading', { level: 1, name: 'This exercise isn’t in the pool' }),
    ).toBeVisible();
    await expect(missing.getByRole('link', { name: 'All exercises' })).toHaveAttribute(
      'href',
      '/training/pool',
    );
    await expect(page.locator('[data-pool-start], app-demo-clip')).toHaveCount(0);
    expect(scene.media).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test('at 390px the pool and an exercise follow dark mode, read right to left, and stay on the screen at 200% text', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openPool(page, 390, 844);
  await useRtl(page);
  const cards = page.locator('li.exercise');
  await expect(cards).toHaveCount(NAMES.length);
  await expect(cards.first().locator('app-demo-clip')).toHaveAttribute('data-clip-state', 'ready');
  const surface = await lightness(cards.first());
  expect(surface.alpha, 'a card draws its own background').toBe(255);
  expect(surface.luminance, 'a card is drawn dark').toBeLessThan(0.1);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9b4-pool-390-dark-rtl.png'),
    fullPage: true,
  });

  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
  expect.soft(await pastTheEdge(page, LIST_PARTS), 'the list at 200% text').toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9b4-pool-390-dark-rtl-200.png'),
    fullPage: true,
  });

  await card(page, 'Walking lunge').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Walking lunge' })).toBeVisible();
  await expect(page.locator('[data-pool-start]')).toBeVisible();
  await expect(page.locator('.demo-area app-demo-clip')).toHaveAttribute(
    'data-clip-state',
    'ready',
  );
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect.soft(await pastTheEdge(page, EXERCISE_PARTS), 'an exercise at 200% text').toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath('n9b4-exercise-390-dark-rtl-200.png'),
    fullPage: true,
  });
});
