import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  CreateProgramDraftRequest,
  PreviewWeekProgressionRequest,
  ProgramDraftContent,
  ProgramTemplateVersionView,
  PublishProgramDraftRequest,
  SaveProgramDraftRequest,
} from '../src/app/core/api/generated';
import {
  draftSummary,
  LIBRARY,
  saveView,
  templateSummary,
  versionView,
} from '../src/testing/program-builder-fixtures';
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
      'GET /api/training/templates/template-1': (route: Route) =>
        json(route, 200, templateSummary()),
      'GET /api/training/template-versions/version-2': (route: Route) =>
        json(route, 200, options.program ?? versionView()),
      'GET /api/exercises': (route: Route) =>
        json(route, 200, { items: LIBRARY, total: LIBRARY.length }),
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

/** A drag the way a hand makes it: press, move past the CDK's threshold, travel, settle, release. */
async function drag(page: Page, from: Locator, to: Locator) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Both ends of the drag must be on screen.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
  await page.mouse.move(end.x + end.width / 2 + 1, end.y + end.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
}

const week = (page: Page, index: number) => page.locator('section.week').nth(index);

test('Programs at 390px and 1440px lists every program as a card, the coach’s new ones first', async ({
  page,
}) => {
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
    await expectNoHorizontalOverflow(page);
    await axe(page);
  }
});

test('the builder takes drags, keeps them as the coach’s draft, and publishes it', async ({
  page,
}) => {
  const sent = await openBuilder(page, 1440, 900);
  const first = week(page, 0);
  const lower = first.locator('.session-card', { hasText: 'Lower A' });

  // An exercise from the library into Lower A, then reorder it by its grip.
  await drag(
    page,
    page.locator('app-program-library .lib-item', { hasText: 'Goblet squat' }),
    lower.locator('.exercise-row').nth(1).locator('.exercise-heading'),
  );
  await expect(lower.locator('.exercise-name')).toHaveText([
    /Back squat/,
    'Romanian deadlift',
    'Goblet squat',
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
    lower.locator('.exercise-row').nth(2).locator('.exercise-grip'),
    lower.locator('.exercise-row').nth(1).locator('.exercise-heading'),
  );
  await expect(lower.locator('.exercise-name')).toHaveText([
    /Back squat/,
    'Goblet squat',
    'Romanian deadlift',
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
    ['Lower A', 0, ['squat', 'goblet', 'rdl']],
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
      patterns: [/status of 401 .*\/api\/auth\/me/, /ERR_INTERNET_DISCONNECTED .*program-drafts/],
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

  await expect(page.locator('app-program-library')).toHaveCount(1);
  await expect(page.locator('aside.library')).toBeHidden();
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

test('the builder and its session sheet pass axe in dark mode', async ({ page }) => {
  await openBuilder(page, 1440, 900, { colorScheme: 'dark' });
  await axe(page);

  await week(page, 0).getByRole('button', { name: 'Lower A', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit session' })).toBeVisible();
  await axe(page);
});

test('a session’s menu works from the keyboard', async ({ page }) => {
  await openBuilder(page, 1440, 900);
  const first = week(page, 0);

  await first.getByRole('button', { name: 'More for Lower A' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Edit session/ })).toBeFocused();
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
    await inline.getByRole('spinbutton', { name: 'Reps from', exact: true }).fill('3');
    await inline.getByRole('spinbutton', { name: 'Reps to', exact: true }).fill('6');
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
  await axe(page);
  await page.getByRole('button', { name: /^Epley curve/ }).click();

  await expect(page.getByRole('button', { name: 'Weights from RPE: Epley curve' })).toBeVisible();
  await expect(page.locator('.status')).toHaveText(/^Saved at/);
  const strategies = sent.contents
    .at(-1)!
    .weeks[0].sessions[0].exercises[0].sets.map((set) => set.loadStrategy);
  expect(strategies).toEqual(['RpeBasedEpley', 'RpeBasedEpley', 'RpeBasedEpley']);
  await expectNoHorizontalOverflow(page);
});
