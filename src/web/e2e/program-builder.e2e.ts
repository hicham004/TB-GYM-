import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  CreateProgramDraftRequest,
  HouseProgramListingView,
  OfferHouseProgramRequest,
  PreviewWeekProgressionRequest,
  ProgramDraftContent,
  ProgramTemplateVersionView,
  PublishProgramDraftRequest,
  SaveProgramDraftRequest,
  WithdrawHouseProgramRequest,
} from '../src/app/core/api/generated';
import {
  draftSummary,
  houseListing,
  LIBRARY,
  libraryPage,
  libraryQueryOf,
  saveView,
  templateSummary,
  versionView,
} from '../src/testing/program-builder-fixtures';
import { chooseOption } from './kit-controls';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  test,
  waitForFonts,
} from './support';

/**
 * Programs asks for TB Gym's programs for trainees (notes plan N9c4); outside TB Gym's own space the
 * server answers 404, which the browser logs, and the section shows nothing.
 */
const NOT_THE_HOUSE = /status of 404 .*\/api\/training\/house-programs/;

/**
 * The program builder (C4, R4.1 and R4.2a) in a real browser: Lea, a coach, opens "Strength base"
 * (two weeks, Lower A on day 1 and Upper A on day 3), drags with a real mouse, and her changes keep
 * themselves as her draft before she publishes. The API is answered by the shared fixtures; every
 * draft save and publish is captured so the test can read what would have been sent.
 */
interface Sent {
  /** The program as each autosave sent it, oldest first. */
  contents: ProgramDraftContent[];
  started: CreateProgramDraftRequest[];
  published: PublishProgramDraftRequest[];
  /** Each "Duplicate with progression" preview the coach asked for. */
  previews: PreviewWeekProgressionRequest[];
}

/** The copies the server would calculate: copy N is N steps from the source week. */
function steppedWeeks(request: PreviewWeekProgressionRequest) {
  const steps = request.steps;
  return Array.from({ length: Number(request.copies) }, (_, index) => {
    const k = index + 1;
    return {
      ...request.sourceWeek,
      sessions: request.sourceWeek.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            targetRpe:
              set.targetRpe == null ? null : Number(set.targetRpe) + Number(steps.rpeStep) * k,
            repetitionsMinimum:
              set.repetitionsMinimum == null
                ? null
                : Number(set.repetitionsMinimum) + Number(steps.repetitionsStep) * k,
            repetitionsMaximum:
              set.repetitionsMaximum == null
                ? null
                : Number(set.repetitionsMaximum) + Number(steps.repetitionsStep) * k,
            percentageWorkingMax:
              set.percentageWorkingMax == null
                ? null
                : Number(set.percentageWorkingMax) + Number(steps.percentageStep) * k,
          })),
        })),
      })),
    };
  });
}

async function openBuilder(
  page: Page,
  width: number,
  height: number,
  options: {
    url?: string;
    colorScheme?: 'light' | 'dark';
    offline?: boolean;
    program?: ProgramTemplateVersionView;
    /** Makes every progression preview answer 400 with this reason. */
    previewRefusal?: string;
  } = {},
): Promise<Sent> {
  const sent: Sent = { contents: [], started: [], published: [], previews: [] };
  let version = 1;
  await page.emulateMedia({ colorScheme: options.colorScheme ?? 'light' });
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      'GET /api/training/templates': (route: Route) =>
        json(route, 200, { items: [templateSummary()], total: 1, skip: 0, take: 100 }),
      'GET /api/training/program-drafts': (route: Route) => json(route, 200, []),
      // Leaving the builder lands on Programs, which asks for TB Gym's programs for trainees.
      'GET /api/training/house-programs': (route: Route) => json(route, 404, {}),
      'GET /api/training/templates/template-1': (route: Route) =>
        json(route, 200, templateSummary()),
      'GET /api/training/template-versions/version-2': (route: Route) =>
        json(route, 200, options.program ?? versionView()),
      // The library pages and searches on the server (WEA-14): the first page, a search, a chip, by id.
      'GET /api/exercises': (route: Route) =>
        json(route, 200, libraryPage(LIBRARY, libraryQueryOf(route.request().url()))),
      'GET /api/training/saved-sessions': (route: Route) => json(route, 200, []),
      'POST /api/media/access': (route: Route) => json(route, 200, { items: [] }),
      'POST /api/training/week-progression/preview': (route: Route) => {
        const body = route.request().postDataJSON() as PreviewWeekProgressionRequest;
        sent.previews.push(body);
        if (options.previewRefusal) {
          return json(route, 400, {
            title: 'One or more validation errors occurred.',
            errors: { progression: [options.previewRefusal] },
          });
        }
        return json(route, 200, {
          transformKey: 'WeekStep',
          transformVersion: '1.0',
          weeks: steppedWeeks(body),
        });
      },
      'POST /api/training/program-drafts': (route: Route) => {
        if (options.offline) return route.abort('internetdisconnected');
        const body = route.request().postDataJSON() as CreateProgramDraftRequest;
        sent.started.push(body);
        sent.contents.push(body.content);
        return json(route, 200, saveView('draft-1', version));
      },
      'PUT /api/training/program-drafts/draft-1': (route: Route) => {
        const body = route.request().postDataJSON() as SaveProgramDraftRequest;
        expect(body.version).toBe(version);
        sent.contents.push(body.content);
        return json(route, 200, saveView('draft-1', ++version));
      },
      'POST /api/training/program-drafts/draft-1/publish': (route: Route) => {
        sent.published.push(route.request().postDataJSON() as PublishProgramDraftRequest);
        return json(route, 200, versionView({ id: 'version-3', versionNumber: 3 }));
      },
      'GET /api/training/template-versions/version-3': (route: Route) =>
        json(route, 200, versionView({ id: 'version-3', versionNumber: 3 })),
    },
  });
  await page.goto(options.url ?? '/training/programs/template-1');
  await expect(page.locator('.session-card').first()).toBeVisible();
  await waitForFonts(page);
  return sent;
}

/**
 * With a menu open, the part of the grid under it is not a target: the overlay's backdrop takes
 * the click. Axe would still measure a half-covered button there, so that rule is left out then.
 */
async function axe(page: Page, options: { menuOpen?: boolean } = {}) {
  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ]);
  const result = await (
    options.menuOpen ? builder.disableRules(['target-size']) : builder
  ).analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/**
 * A drag the way a hand makes it: press, move past the CDK's threshold, travel, settle, release. It
 * lands at `at` of the target's height (the middle unless told), since the middle of a row is where
 * the list decides between before and after it by a pixel.
 */
async function drag(page: Page, from: Locator, to: Locator, at = 0.5) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Both ends of the drag must be on screen.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  });
  const landing = end.y + end.height * at;
  await page.mouse.move(end.x + end.width / 2, landing, { steps: 16 });
  await page.mouse.move(end.x + end.width / 2 + 1, landing + 1, { steps: 2 });
  await page.mouse.up();
}

const week = (page: Page, index: number) => page.locator('section.week').nth(index);

test.describe('Programs in a coach’s own space', () => {
  test.use({ allowedConsoleErrors: { patterns: [NOT_THE_HOUSE] } });

  test('Programs at 390px and 1440px lists every program as a card, the coach’s new ones first', async ({
    page,
  }) => {
    let houseReads = 0;
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await mockSession(page, {
        memberships: [COACH_MEMBERSHIP],
        extra: {
          'GET /api/training/templates': (route: Route) =>
            json(route, 200, { items: [templateSummary()], total: 1, skip: 0, take: 100 }),
          'GET /api/training/program-drafts': (route: Route) =>
            json(route, 200, [
              draftSummary({ id: 'draft-new', templateId: null, name: 'Hypertrophy block' }),
            ]),
          'GET /api/training/house-programs': (route: Route) => {
            houseReads += 1;
            return json(route, 404, {});
          },
        },
      });
      await page.goto('/training/programs');
      await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Strength base' })).toHaveAttribute(
        'href',
        '/training/programs/template-1',
      );
      await expect(page.getByRole('link', { name: 'Hypertrophy block' })).toHaveAttribute(
        'href',
        '/training/programs/new?draft=draft-new',
      );
      await expect(page.locator('.card').first()).toContainText(
        'Only you can see it until you publish it',
      );
      // Outside TB Gym's own space nothing of its programs for trainees shows.
      await expect.poll(() => houseReads).toBeGreaterThan(0);
      await expect(page.getByRole('heading', { name: 'Programs trainees can start' })).toHaveCount(
        0,
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
    }
  });
});

test('the builder takes drags, keeps them as the coach’s draft, and publishes it', async ({
  page,
}) => {
  const sent = await openBuilder(page, 1440, 900);
  const first = week(page, 0);
  const lower = first.locator('.session-card', { hasText: 'Lower A' });

  // The library starts as a rail; opening it gives the grid the drags below. Its first-use tip
  // (B5b) is folded first, so the rows are where a returning coach finds them.
  await expect(page.locator('app-program-library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exercises' }).click();
  await expect(page.locator('app-program-library')).toBeVisible();
  await page.locator('app-program-library').getByRole('button', { name: 'Got it' }).click();

  // An exercise from the library onto the top of the second row of Lower A, which puts it there,
  // then reorder it by its grip.
  await drag(
    page,
    page.locator('app-program-library .lib-item', { hasText: 'Goblet squat' }),
    lower.locator('.exercise-row').nth(1),
    0.25,
  );
  await expect(lower.locator('.exercise-name')).toHaveText([
    /Back squat/,
    'Goblet squat',
    'Romanian deadlift',
  ]);
  // A moment after the drop the change is the coach's own draft on the server.
  await expect(page.locator('.status')).toHaveText(/^Saved at \d\d:\d\d, not published yet$/);
  expect(sent.started).toHaveLength(1);
  expect(sent.started[0]).toMatchObject({
    templateId: 'template-1',
    sourceVersionId: 'version-2',
    templateVersionNumber: 2,
  });
  await drag(
    page,
    lower.locator('.exercise-row').nth(1).locator('.exercise-grip'),
    lower.locator('.exercise-row').nth(2).locator('.exercise-heading'),
  );
  await expect(lower.locator('.exercise-name')).toHaveText([
    /Back squat/,
    'Romanian deadlift',
    'Goblet squat',
  ]);

  // Upper A from day 3 onto day 5, a rest day.
  await drag(
    page,
    first.locator('.session-card', { hasText: 'Upper A' }).locator('.session-grip'),
    first.locator('.day').nth(4),
  );
  await expect(first.locator('.day').nth(4).locator('.session-name')).toHaveText('Upper A');
  await expect(first.locator('.day').nth(2)).toHaveClass(/rest/);

  // A library exercise onto an empty day starts a session there.
  await drag(
    page,
    page.locator('app-program-library .lib-item', { hasText: 'Chest-supported row' }),
    first.locator('.day').nth(1),
  );
  await expect(first.locator('.day').nth(1).locator('.exercise-name')).toHaveText(
    'Chest-supported row',
  );
  await expect(page.locator('.status')).toHaveText(/^Saved at/);
  await axe(page);

  // The newest content the server holds is what the grid shows.
  const content = sent.contents.at(-1)!;
  expect(
    content.weeks[0].sessions.map((session) => [
      session.name,
      session.dayOffset,
      session.exercises.map((exercise) => exercise.exerciseId),
    ]),
  ).toEqual([
    ['Lower A', 0, ['squat', 'rdl', 'goblet']],
    ['Training day', 1, ['row']],
    ['Upper A', 4, ['bench']],
  ]);
  expect(content.weeks[1].sessions.map((session) => session.dayOffset)).toEqual([0, 2]);

  await page.getByRole('button', { name: 'Publish' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview before publishing' });
  await expect(preview).toBeVisible();
  expect(sent.published).toEqual([]);
  await preview.getByRole('button', { name: 'Publish program', exact: true }).click();
  await expect(
    page.getByText('Published. Clients already on this program keep their own copy.'),
  ).toBeVisible();
  expect(sent.published).toEqual([{ version: sent.contents.length, replaceNewer: false }]);
});

test.describe('with no connection', () => {
  // The browser logs each refused draft save itself. Anything else — an Angular ERROR from a
  // rejection nobody handled, or an uncaught page error — still fails through the guard.
  test.use({
    allowedConsoleErrors: {
      patterns: [/ERR_INTERNET_DISCONNECTED .*program-drafts/, NOT_THE_HOUSE],
    },
  });

  test('leaving with changes that cannot be saved asks first, and staying keeps them', async ({
    page,
  }) => {
    await openBuilder(page, 1440, 900, { offline: true });

    await page.getByRole('textbox', { name: 'Program name' }).fill('Strength base, heavier');
    await expect(page.locator('.status')).toHaveText('Not saved yet. Trying again…');

    await page.getByRole('link', { name: 'All programs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await axe(page);
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/\/training\/programs\/template-1$/);
    await expect(page.getByRole('textbox', { name: 'Program name' })).toHaveValue(
      'Strength base, heavier',
    );

    await page.getByRole('link', { name: 'All programs' }).click();
    await dialog.getByRole('button', { name: 'Leave without saving' }).click();
    await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible();
  });
});

test('a phone shows one week at a time and adds through the sheet', async ({ page }) => {
  await openBuilder(page, 390, 844);

  // A phone has no library beside the grid and no rail: it adds through the sheet.
  await expect(page.locator('app-program-library')).toHaveCount(0);
  await expect(page.locator('.library-rail')).toBeHidden();
  await expect(week(page, 0)).toBeVisible();
  await expect(week(page, 1)).toBeHidden();
  // The chip a thumb presses; the radio inside it is what a screen reader reads.
  await page.locator('label.week-chip').nth(1).click();
  await expect(page.getByRole('radio', { name: 'Week 2' })).toBeChecked();
  await expect(week(page, 1)).toBeVisible();
  await expect(week(page, 0)).toBeHidden();

  await week(page, 1).getByRole('button', { name: 'Add to week 2, day 2' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add to week 2, day 2' });
  await sheet.getByRole('button', { name: 'Add Goblet squat' }).click();
  await expect(sheet.getByText('Added', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('status')).toHaveText('Goblet squat added.');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(week(page, 1).locator('.day').nth(1).locator('.exercise-name')).toHaveText(
    'Goblet squat',
  );

  await expectNoHorizontalOverflow(page);
  await axe(page);
});

test('an exercise goes in without dragging: + chooses it, Add here takes it (B5b)', async ({
  page,
}) => {
  const sent = await openBuilder(page, 1440, 900);
  await page.locator('.library-rail').click();
  const library = page.locator('app-program-library');
  await expect(library.locator('.help')).toHaveText(
    'Drag an exercise into a workout, or press + to add it.',
  );
  const how = library.locator('.how details');
  await expect(how).toHaveAttribute('open', '');

  const plus = library.getByRole('button', { name: 'Add Goblet squat' });
  await plus.click();
  await expect(plus).toHaveAttribute('aria-pressed', 'true');
  const bar = page.locator('app-adding-bar');
  await expect(bar).toContainText('Adding Goblet squat: press Add here where it goes.');
  await expect(bar).toBeInViewport();
  // Two workouts and five rest days a week, two weeks.
  await expect(page.locator('.add-here')).toHaveCount(14);
  await expectNoHorizontalOverflow(page);
  await axe(page);

  // A second press lets it go.
  await plus.click();
  await expect(page.locator('.add-here')).toHaveCount(0);

  await plus.click();
  await week(page, 0).getByRole('button', { name: 'Add here: Upper A, week 1, day 3' }).click();
  const upper = week(page, 0).locator('.session-card', { hasText: 'Upper A' });
  await expect(upper.locator('.exercise-name')).toHaveText(['Bench press', 'Goblet squat']);
  await expect(
    page.locator('.tb-toast__message', { hasText: 'Goblet squat added to Upper A.' }),
  ).toBeVisible();
  await expect(how).not.toHaveAttribute('open', '');

  // On a rest day it starts a workout there.
  await library.getByRole('button', { name: 'Add Chest-supported row' }).click();
  await week(page, 0)
    .getByRole('button', { name: 'Add here: a new workout on week 1, day 5' })
    .click();
  await expect(week(page, 0).locator('.day').nth(4).locator('.session-name')).toHaveText(
    'Training day',
  );
  await expect(page.locator('.status')).toHaveText(/^Saved at/);
  expect(
    sent.contents.at(-1)?.weeks?.[0].sessions?.map((session) => [session.dayOffset, session.name]),
  ).toEqual([
    [0, 'Lower A'],
    [2, 'Upper A'],
    [4, 'Training day'],
  ]);
  await axe(page);
});

test('a phone chooses an exercise in a sheet, then presses Add here (B5b)', async ({ page }) => {
  await openBuilder(page, 390, 844, { colorScheme: 'dark' });

  await page.getByRole('button', { name: 'Exercises' }).click();
  const sheet = page.getByRole('dialog', { name: 'Exercises' });
  await expect(sheet).toContainText(
    'Choose an exercise or a saved workout, then press Add here where it goes.',
  );
  await sheet.getByRole('button', { name: 'Add Bench press' }).click();
  await expect(sheet).toBeHidden();

  const bar = page.locator('app-adding-bar');
  await expect(bar).toBeInViewport();
  await expect(week(page, 0).locator('.add-here')).toHaveCount(7);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await week(page, 0).getByRole('button', { name: 'Add here: Lower A, week 1, day 1' }).click();
  await expect(
    week(page, 0).locator('.session-card', { hasText: 'Lower A' }).locator('.exercise-name'),
  ).toHaveText([/Back squat/, 'Romanian deadlift', 'Bench press']);
  await expect(bar).toHaveCount(0);
});

/** A one-pixel picture, so a demo opens without a media server. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('an exercise with a demo offers it on the grid, and it opens in a sheet (P4)', async ({
  page,
}) => {
  await openBuilder(page, 1440, 900);
  const grants: string[] = [];
  await page.route('**/api/media/media-row/access', (route: Route) => {
    grants.push(route.request().method());
    return json(route, 200, {
      assetId: 'media-row',
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/png',
      url: PIXEL,
      expiresAtUtc: '2026-10-07T12:00:00Z',
      downloadAllowed: true,
    });
  });

  // Squat has no demo in the library; the row added from the library has one.
  await expect(week(page, 0).getByRole('button', { name: /^Watch the .* demo$/ })).toHaveCount(0);
  await week(page, 1).getByRole('button', { name: 'Add to week 2, day 2' }).click();
  const add = page.getByRole('dialog', { name: 'Add to week 2, day 2' });
  await add.getByRole('button', { name: 'Add Chest-supported row' }).click();
  await add.getByRole('button', { name: 'Done' }).click();

  await week(page, 1).getByRole('button', { name: 'Watch the Chest-supported row demo' }).click();
  const demo = page.getByRole('dialog', { name: 'Chest-supported row' });
  await expect(demo).toBeVisible();
  await expect(demo.getByRole('img', { name: 'How to do Chest-supported row' })).toBeVisible();
  expect(grants).toEqual(['POST']);
  await axe(page);

  await page.keyboard.press('Escape');
  await expect(demo).toHaveCount(0);
});

test('the builder and its session sheet pass axe in dark mode', async ({ page }) => {
  await openBuilder(page, 1440, 900, { colorScheme: 'dark' });
  await axe(page);

  await week(page, 0).getByRole('button', { name: 'Lower A', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit workout' })).toBeVisible();
  await axe(page);
});

test('a session’s menu works from the keyboard', async ({ page }) => {
  await openBuilder(page, 1440, 900);
  const first = week(page, 0);

  await first.getByRole('button', { name: 'More for Lower A' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Edit workout/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // A copy lands on the next free day, and focus is back on the menu's button.
  await expect(first.locator('.day').nth(1).locator('.session-name')).toHaveText('Lower A');
  await expect(first.getByRole('button', { name: 'More for Lower A' }).first()).toBeFocused();
});

for (const width of [390, 1440]) {
  test(`inline sets at ${width}px autosave exact values and preview before publishing`, async ({
    page,
  }) => {
    const sent = await openBuilder(page, width, 900);
    const exercise = week(page, 0).locator('.exercise-row').first();
    await exercise.getByRole('button', { name: 'Edit sets for Back squat' }).click();
    const inline = exercise.locator('.inline-sets');
    await inline.getByRole('textbox', { name: 'Reps', exact: true }).fill('3-6');
    await inline.getByRole('spinbutton', { name: '% of training max', exact: true }).fill('82.5');
    await inline.getByRole('button', { name: 'Effort: RPE', exact: true }).click();
    await inline.getByRole('button', { name: 'RIR', exact: true }).click();
    await inline.getByRole('spinbutton', { name: 'RIR target', exact: true }).fill('2');
    await expect(page.locator('.status')).toHaveText(/^Saved at/);
    const sets = sent.contents.at(-1)!.weeks[0].sessions[0].exercises[0].sets;
    expect(sets[0]).toMatchObject({
      repetitionsMinimum: 3,
      repetitionsMaximum: 6,
      percentageWorkingMax: 82.5,
      targetRir: 2,
      targetRpe: null,
    });
    expect(sets[1]).toMatchObject({
      repetitionsMinimum: 5,
      percentageWorkingMax: 75,
      targetRpe: 7,
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    // A menu's list is in the top layer since critique B2a, so opening one no longer scrolls the
    // page: at this scroll the day's own menu button sits under the sticky top bar, so it is judged
    // where a coach reaches it.
    await week(page, 0)
      .getByRole('button', { name: 'More for Lower A' })
      .evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await axe(page);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Preview before publishing' });
    await expect(preview).toContainText('3–6 · 82.5% of training max · RIR 2');
    expect(sent.published).toEqual([]);
    await axe(page);
    await preview.getByRole('button', { name: 'Back to editing' }).click();
    await expect(inline.getByRole('spinbutton', { name: 'RIR target', exact: true })).toHaveValue(
      '2',
    );
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await preview.getByRole('button', { name: 'Publish program', exact: true }).click();
    await expect(
      page.getByText('Published. Clients already on this program keep their own copy.'),
    ).toBeVisible();
    expect(sent.published).toHaveLength(1);
  });
}

for (const width of [390, 1440]) {
  test(`a last time + step set at ${width}px autosaves its step and start, and Publish checks the step (N6a)`, async ({
    page,
  }) => {
    const sent = await openBuilder(page, width, 900);
    const exercise = week(page, 0).locator('.exercise-row').first();
    await exercise.getByRole('button', { name: 'Edit sets for Back squat' }).click();
    const inline = exercise.locator('.inline-sets');
    await inline.getByRole('button', { name: '% of training max', exact: true }).click();
    await page.getByRole('button', { name: 'Last time + step', exact: true }).click();

    const step = inline.getByRole('spinbutton', { name: 'Step (kg)', exact: true });
    const start = inline.getByRole('spinbutton', { name: 'Starting weight (kg)', exact: true });
    // The cursor goes to the step; the set's 75% is never read as a 75 kg start.
    await expect(step).toBeFocused();
    await expect(step).not.toHaveAttribute('aria-invalid');
    await expect(start).toHaveValue('');
    await expect(
      inline.getByText('You add the step each week, after reading the logged sets.'),
    ).toBeVisible();
    await expect(
      inline.getByText('Optional. Without one, the client picks the weight.'),
    ).toBeVisible();
    await step.fill('2');
    await start.fill('5');

    await expect
      .poll(() => sent.contents.at(-1)?.weeks[0].sessions[0].exercises[0].sets[0])
      .toMatchObject({
        loadStrategy: 'LastTimeStep',
        loadStep: 2,
        directLoad: 5,
        loadUnit: 'Kilogram',
        percentageWorkingMax: null,
        manualLoadOverride: null,
        repetitionsMaximum: 5,
      });
    await expect(page.locator('.status')).toHaveText(/^Saved at/);
    // The other two sets keep their share; the grid says the step, then the start.
    expect(sent.contents.at(-1)!.weeks[0].sessions[0].exercises[0].sets[1]).toMatchObject({
      loadStrategy: 'PercentageWorkingMax',
      percentageWorkingMax: 75,
      loadStep: null,
    });
    await expect(exercise.locator('app-set-lines .run')).toHaveText([
      '1 × 5 · last time + 2 kg · start 5 kg · RPE 7',
      '2 × 5 · 75% of training max · RPE 7',
    ]);
    await expectNoHorizontalOverflow(page);
    await week(page, 0)
      .getByRole('button', { name: 'More for Lower A' })
      .evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await axe(page);

    // A step of 0 is refused by Publish's check, which names the set and sends nothing.
    await step.fill('0');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'a step must be' })).toHaveText(
      /Week 1, Lower A: a step must be more than 0 and at most 50 kg, with at most two decimals\./,
    );
    await expect(page.getByRole('dialog', { name: 'Preview before publishing' })).toHaveCount(0);
    expect(sent.published).toEqual([]);
    await page.getByRole('button', { name: 'Fix the set', exact: true }).click();
    await expect(step).toBeFocused();
    await expect(step).toHaveAttribute('aria-invalid', 'true');
  });
}

test('a dark preview hides unshared content and reflows at 200% text in RTL', async ({ page }) => {
  const program = versionView();
  program.weeks[0].isPublished = false;
  program.weeks[0].sessions[0].name = 'Not shared session';
  await openBuilder(page, 390, 844, { colorScheme: 'dark', program });
  await week(page, 0).getByRole('button', { name: 'Edit sets for Back squat' }).click();
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.evaluate(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.style.fontSize = '';
  });
  await page.getByRole('textbox', { name: 'Program name' }).fill('Strength base, reviewed');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview before publishing' });
  await expect(preview).toContainText('Your coach hasn’t shared this week yet');
  await expect(preview.getByText('Not shared session')).toHaveCount(0);
  await preview.getByRole('radio', { name: 'Week 2', exact: true }).check();
  await expect(preview).toContainText('75% of training max');
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
  const body = page.locator('.tb-modal__body');
  expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await axe(page);
});

async function openProgression(page: Page) {
  await week(page, 0).getByRole('button', { name: 'More for week 1' }).click();
  await page.getByRole('button', { name: 'Duplicate with progression…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate with progression' });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const width of [390, 1440]) {
  test(`Duplicate with progression at ${width}px shows the weeks first, then adds them to the draft`, async ({
    page,
  }) => {
    const sent = await openBuilder(page, width, 900);
    const dialog = await openProgression(page);

    await dialog.getByRole('spinbutton', { name: 'Copies' }).fill('3');
    await dialog.getByRole('spinbutton', { name: '% of training max a week' }).fill('2.5');
    await expect(dialog.getByText('No set in this week has a fixed weight.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);

    await dialog.getByRole('button', { name: 'Show the new weeks' }).click();
    await expect(
      dialog.getByRole('heading', { name: '3 new weeks after week 1', level: 3 }),
    ).toBeVisible();
    expect(sent.previews).toHaveLength(1);
    expect(sent.previews[0]).toMatchObject({
      copies: 3,
      steps: { rpeStep: 0.5, repetitionsStep: 0, percentageStep: 2.5, loadStep: 0 },
      weeksInProgram: 2,
    });
    await expect(dialog).toContainText('3 × 5 · 77.5% of training max · RPE 7.5');
    await expect(dialog).toContainText('3 × 5 · 82.5% of training max · RPE 8.5');
    // Reading the weeks adds nothing to the draft.
    await expect(page.locator('section.week')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/p1-progression-${width}.png` });

    await dialog.getByRole('button', { name: 'Add 3 weeks' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('section.week')).toHaveCount(5);
    await expect(page.locator('.status')).toHaveText(/^Saved at/);
    const weeks = sent.contents.at(-1)!.weeks;
    expect(weeks).toHaveLength(5);
    expect(weeks[1].sessions[0].exercises[0].sets[0]).toMatchObject({
      targetRpe: 7.5,
      percentageWorkingMax: 77.5,
    });
    expect(weeks[3].sessions[0].exercises[0].sets[0]).toMatchObject({
      targetRpe: 8.5,
      percentageWorkingMax: 82.5,
    });
    // The original second week is now the fifth, and keeps its own values.
    expect(weeks[4].sessions[0].exercises[0].sets[0]).toMatchObject({
      targetRpe: 7,
      percentageWorkingMax: 75,
    });
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });
}

test.describe('a refused progression', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of 400 .*\/api\/training\/week-progression/] },
  });

  test('says why beside the button and adds nothing', async ({ page }) => {
    const reason =
      'Copy 3, Lower A, Back squat, set 1: RPE would be 10.5, and RPE runs from 5 to 10. Use a smaller step or fewer copies.';
    await openBuilder(page, 390, 844, { previewRefusal: reason });
    const dialog = await openProgression(page);

    await dialog.getByRole('button', { name: 'Show the new weeks' }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText(reason);
    await expect(alert).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Add the weeks' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });
});

test('the progression sheet passes axe in dark mode and reflows at 200% text in RTL', async ({
  page,
}) => {
  await openBuilder(page, 390, 844, { colorScheme: 'dark' });
  const dialog = await openProgression(page);
  await dialog.getByRole('button', { name: 'Show the new weeks' }).click();
  await expect(dialog.getByRole('heading', { name: /new weeks after week 1/ })).toBeVisible();
  await axe(page);

  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
  const body = page.locator('.tb-modal__body');
  expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expect(dialog.getByRole('button', { name: /^Add \d+ weeks$/ })).toBeVisible();
  await axe(page);
});

test('the program picks one formula for loads from RPE, and every set follows it', async ({
  page,
}) => {
  const program = versionView();
  for (const set of program.weeks[0].sessions[0].exercises[0].sets) {
    set.loadStrategy = 'RpeChart';
    set.percentageWorkingMax = null;
  }
  const sent = await openBuilder(page, 1440, 900, { program });

  const menu = page.getByRole('button', { name: 'Weights from RPE: RTS chart' });
  await menu.click();
  await expect(page.getByRole('button', { name: /^RTS chart \(recommended\)/ })).toBeVisible();
  await axe(page, { menuOpen: true });
  await page.getByRole('button', { name: /^Epley curve/ }).click();

  await expect(page.getByRole('button', { name: 'Weights from RPE: Epley curve' })).toBeVisible();
  await expect(page.locator('.status')).toHaveText(/^Saved at/);
  const strategies = sent.contents
    .at(-1)!
    .weeks[0].sessions[0].exercises[0].sets.map((set) => set.loadStrategy);
  expect(strategies).toEqual(['RpeBasedEpley', 'RpeBasedEpley', 'RpeBasedEpley']);
  // A template has no client, so the Epley curve's share shows, not a weight (critique B15).
  await expect(page.locator('.session-card app-set-lines .run').first()).toHaveText(
    '3 × 5 · RPE 7 · 79% of training max',
  );
  await expectNoHorizontalOverflow(page);
});

// ---------- TB Gym's own space: the programs its trainees can start (notes plan N9c4) ----------

const HOUSE_COACH = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Coach',
};

const PLACE_TAKEN =
  '"Strength base" is already block 1 of Foundations. Give this one another place, or withdraw that one first.';

interface HouseSent {
  offers: OfferHouseProgramRequest[];
  withdrawals: WithdrawHouseProgramRequest[];
  /** Each csrf read and write, in order, so a fresh token is seen before each write. */
  calls: string[];
}

/**
 * Programs in TB Gym's own space, as a coach of it reads them: Strength base offered as block 1 of
 * Foundations, Powerbuilding withdrawn, and Upper lower published and not listed yet. The list is the
 * server's: an offer or a withdrawal changes what the next read answers.
 */
async function openHousePrograms(
  page: Page,
  width: number,
  height: number,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<HouseSent> {
  const sent: HouseSent = { offers: [], withdrawals: [], calls: [] };
  let listings: HouseProgramListingView[] = [
    houseListing(),
    houseListing({
      listingId: 'listing-3',
      templateId: 'template-3',
      templateName: 'Powerbuilding',
      suits: 'Lifters with a year behind them.',
      runName: null,
      runPosition: null,
      weeks: 6,
      isOffered: false,
      timesStarted: 0,
      version: 7,
    }),
  ];
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width, height });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return;
    if (path === '/api/auth/csrf' || request.method() !== 'GET') {
      sent.calls.push(`${request.method()} ${path}`);
    }
  });
  await mockSession(page, {
    memberships: [HOUSE_COACH],
    extra: {
      'GET /api/training/templates': (route: Route) =>
        json(route, 200, {
          items: [
            templateSummary(),
            templateSummary({ id: 'template-2', name: 'Upper lower' }),
            templateSummary({ id: 'template-3', name: 'Powerbuilding' }),
          ],
          total: 3,
          skip: 0,
          take: 100,
        }),
      'GET /api/training/program-drafts': (route: Route) => json(route, 200, []),
      'GET /api/training/house-programs': (route: Route) => json(route, 200, listings),
      'PUT /api/training/templates/template-2/house-listing': (route: Route) => {
        const body = route.request().postDataJSON() as OfferHouseProgramRequest;
        sent.offers.push(body);
        if (body.runName === 'Foundations' && Number(body.runPosition) === 1) {
          return json(route, 409, {
            code: 'house_program_run_position_taken',
            message: PLACE_TAKEN,
          });
        }
        const offered = houseListing({
          listingId: 'listing-2',
          templateId: 'template-2',
          templateName: 'Upper lower',
          suits: body.suits ?? '',
          runName: body.runName ?? null,
          runPosition: body.runPosition ?? null,
          timesStarted: 0,
          version: 1,
        });
        listings = [listings[0], offered, listings[1]];
        return json(route, 200, offered);
      },
      'POST /api/training/templates/template-1/house-listing/withdraw': (route: Route) => {
        sent.withdrawals.push(route.request().postDataJSON() as WithdrawHouseProgramRequest);
        const withdrawn = { ...listings[0], isOffered: false, version: 4 };
        listings = [...listings.slice(1), withdrawn];
        return json(route, 200, withdrawn);
      },
    },
  });
  await page.goto('/training/programs');
  await expect(page.getByRole('heading', { name: 'Programs trainees can start' })).toBeVisible();
  await waitForFonts(page);
  // The session's own first token is not one of the writes'.
  sent.calls.length = 0;
  return sent;
}

const houseRow = (page: Page, name: string) =>
  page
    .locator('app-house-listings .row')
    .filter({ has: page.getByRole('heading', { name, level: 3, exact: true }) });

test.describe('TB Gym’s own space: the programs its trainees can start', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/house-listing/] } });

  test('a coach offers a program, hears a place already taken by its field, and withdraws another', async ({
    page,
  }) => {
    const sent = await openHousePrograms(page, 1440, 900);
    const section = page.locator('app-house-listings');

    await expect(houseRow(page, 'Strength base')).toContainText('Block 1 of Foundations');
    await expect(houseRow(page, 'Strength base')).toContainText(
      'For: New to the barbell, two days a week.',
    );
    await expect(houseRow(page, 'Strength base')).toContainText(
      '2 weeks · kg Loads rounded to 2.5 kg, nearest Started 2 times',
    );
    await expect(houseRow(page, 'Powerbuilding').locator('app-status-pill')).toHaveText(
      'Withdrawn',
    );
    await expect(
      houseRow(page, 'Strength base').getByRole('link', { name: 'Strength base' }),
    ).toHaveAttribute('href', '/training/programs/template-1');
    // New program stays the page's one filled button.
    await expect(page.locator('.tb-button--filled')).toHaveCount(1);
    await axe(page);

    await section.getByRole('button', { name: 'Offer a program' }).click();
    const sheet = page.getByRole('dialog', { name: 'Offer to trainees' });
    await expect(sheet).toContainText(
      'A trainee’s copy shows every week, even weeks not shared with clients.',
    );
    await chooseOption(sheet, 'Program', 'Upper lower');
    await sheet.getByLabel('Whom it suits').fill('Two days a week, any level.');
    await sheet.getByLabel('Run (optional)').fill('  Foundations ');
    await sheet.getByLabel('Block number').fill('1');
    await sheet.getByRole('button', { name: 'Offer to trainees' }).click();
    await expect(sheet.getByLabel('Block number')).toHaveAccessibleDescription(PLACE_TAKEN);
    await expect(sheet.locator('app-form-summary')).toHaveText('Check the fields marked above.');
    await axe(page);
    await page.screenshot({ path: test.info().outputPath('n9c4-offer-taken-1440.png') });

    await sheet.getByLabel('Block number').fill('2');
    await sheet.getByRole('button', { name: 'Offer to trainees' }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.locator('.tb-toast__message', { hasText: 'Upper lower is offered to trainees.' }),
    ).toBeVisible();
    await expect(houseRow(page, 'Upper lower')).toContainText('Block 2 of Foundations');
    expect(sent.offers).toEqual([
      {
        suits: 'Two days a week, any level.',
        runName: 'Foundations',
        runPosition: 1,
        loadIncrement: 2.5,
        loadRoundingMode: 'Nearest',
        version: null,
      },
      {
        suits: 'Two days a week, any level.',
        runName: 'Foundations',
        runPosition: 2,
        loadIncrement: 2.5,
        loadRoundingMode: 'Nearest',
        version: null,
      },
    ]);

    await houseRow(page, 'Strength base')
      .getByRole('button', { name: 'Withdraw, Strength base' })
      .click();
    await expect(houseRow(page, 'Strength base').locator('app-status-pill')).toHaveText(
      'Withdrawn',
    );
    await expect(
      page.locator('.tb-toast__message', {
        hasText: 'Strength base withdrawn. Trainees who started it keep their copy.',
      }),
    ).toBeVisible();
    await expect(
      houseRow(page, 'Strength base').getByRole('button', { name: 'Offer again, Strength base' }),
    ).toBeFocused();
    expect(sent.withdrawals).toEqual([{ version: 3 }]);
    // A fresh antiforgery token before each of the three writes.
    expect(sent.calls).toEqual([
      'GET /api/auth/csrf',
      'PUT /api/training/templates/template-2/house-listing',
      'GET /api/auth/csrf',
      'PUT /api/training/templates/template-2/house-listing',
      'GET /api/auth/csrf',
      'POST /api/training/templates/template-1/house-listing/withdraw',
    ]);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: test.info().outputPath('n9c4-house-programs-1440.png'),
      fullPage: true,
    });
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`the section and its sheet at ${width}px in ${colorScheme} pass axe with no sideways scroll`, async ({
        page,
      }) => {
        await openHousePrograms(page, width, height, colorScheme);

        await expectNoHorizontalOverflow(page);
        await axe(page);
        await page.screenshot({
          path: test.info().outputPath(`n9c4-house-programs-${width}-${colorScheme}.png`),
          fullPage: true,
        });

        await houseRow(page, 'Strength base')
          .getByRole('button', { name: 'Edit for trainees, Strength base' })
          .click();
        const sheet = page.getByRole('dialog', { name: 'Edit for trainees' });
        await expect(sheet.getByLabel('Whom it suits')).toHaveValue(
          'New to the barbell, two days a week.',
        );
        await sheet.getByText('Rounding', { exact: true }).click();
        await expect(sheet.getByLabel('Round loads to')).toHaveValue('2.5');
        await expectNoHorizontalOverflow(page);
        await axe(page);
        await page.screenshot({
          path: test.info().outputPath(`n9c4-house-sheet-${width}-${colorScheme}.png`),
        });

        if (width === 390) {
          // 200% text: the page and the sheet reflow, nothing scrolls sideways.
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '32px';
          });
          await expectNoHorizontalOverflow(page);
          const body = page.locator('.tb-modal__body');
          expect(
            await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          ).toBe(true);
          await axe(page);
          await page.screenshot({
            path: test.info().outputPath(`n9c4-house-sheet-390-${colorScheme}-200.png`),
          });
          await sheet.getByRole('button', { name: 'Not now' }).click();
          await expect(sheet).toBeHidden();
          await expectNoHorizontalOverflow(page);
          await page.screenshot({
            path: test.info().outputPath(`n9c4-house-programs-390-${colorScheme}-200.png`),
            fullPage: true,
          });
        }
      });
    }
  }
});
