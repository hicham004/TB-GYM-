import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type { SaveProgramTemplateRequest } from '../src/app/core/api/generated';
import { LIBRARY, templateSummary, versionView } from '../src/testing/program-builder-fixtures';
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
 * The program builder (C4, R4.1) in a real browser: Lea, a coach, opens "Strength base" (two weeks,
 * Lower A on day 1 and Upper A on day 3), drags with a real mouse, and saves. The API is answered by
 * the shared fixtures; every save is captured so the test can read what would have been sent.
 */
interface Saved {
  bodies: SaveProgramTemplateRequest[];
}

async function openBuilder(
  page: Page,
  width: number,
  height: number,
  options: { url?: string; colorScheme?: 'light' | 'dark' } = {},
): Promise<Saved> {
  const saved: Saved = { bodies: [] };
  await page.emulateMedia({ colorScheme: options.colorScheme ?? 'light' });
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      'GET /api/training/templates': (route: Route) =>
        json(route, 200, { items: [templateSummary()], total: 1, skip: 0, take: 100 }),
      'GET /api/training/templates/template-1': (route: Route) =>
        json(route, 200, templateSummary()),
      'GET /api/training/template-versions/version-2': (route: Route) =>
        json(route, 200, versionView()),
      'GET /api/exercises': (route: Route) =>
        json(route, 200, { items: LIBRARY, total: LIBRARY.length }),
      'GET /api/training/saved-sessions': (route: Route) => json(route, 200, []),
      'POST /api/media/access': (route: Route) => json(route, 200, { items: [] }),
      'POST /api/training/templates/template-1/versions': (route: Route) => {
        saved.bodies.push(route.request().postDataJSON() as SaveProgramTemplateRequest);
        return json(route, 200, versionView({ id: 'version-3', versionNumber: 3 }));
      },
      'GET /api/training/template-versions/version-3': (route: Route) =>
        json(route, 200, versionView({ id: 'version-3', versionNumber: 3, isPublished: false })),
    },
  });
  await page.goto(options.url ?? '/training/programs/template-1');
  await expect(page.locator('.session-card').first()).toBeVisible();
  await waitForFonts(page);
  return saved;
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

test('Programs at 390px and 1440px lists every program as a card', async ({ page }) => {
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
      },
    });
    await page.goto('/training/programs');
    await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Strength base' })).toHaveAttribute(
      'href',
      '/training/programs/template-1',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
  }
});

test('the builder takes drags from the library and between days, and saves them', async ({
  page,
}) => {
  const saved = await openBuilder(page, 1440, 900);
  const first = week(page, 0);
  const lower = first.locator('.session-card', { hasText: 'Lower A' });

  // An exercise from the library into Lower A, between its two exercises.
  await drag(
    page,
    page.locator('app-program-library .lib-item', { hasText: 'Goblet squat' }),
    lower.locator('.exercise-row').nth(1),
  );
  await expect(lower.locator('.exercise-name')).toHaveText([
    /Back squat/,
    'Goblet squat',
    'Romanian deadlift',
  ]);
  await expect(page.locator('.status')).toHaveText('Unsaved changes');

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
  await axe(page);

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved. Publish it when it is ready to assign.')).toBeVisible();
  const body = saved.bodies[0];
  expect(body.publish).toBe(false);
  expect(body.templateVersion).toBe(41);
  expect(
    body.weeks[0].sessions.map((session) => [
      session.name,
      session.dayOffset,
      session.exercises.map((exercise) => exercise.exerciseId),
    ]),
  ).toEqual([
    ['Lower A', 0, ['squat', 'goblet', 'rdl']],
    ['Training day', 1, ['row']],
    ['Upper A', 4, ['bench']],
  ]);
  expect(body.weeks[1].sessions.map((session) => session.dayOffset)).toEqual([0, 2]);
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
