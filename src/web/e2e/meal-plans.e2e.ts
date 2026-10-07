import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  CreateMealPlanDraftRequest,
  MealPlanDraftContent,
  PublishMealPlanDraftRequest,
  SaveMealPlanDraftRequest,
} from '../src/app/core/api/generated';
import {
  draftSummary,
  planDetail,
  planSummary,
  RECIPES,
  saveView,
  versionView,
} from '../src/testing/meal-plan-fixtures';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The meal-plan builder (C7, R4.4a) in a real browser: a coach opens "Lean bulk" (day 1 Breakfast
 * and Lunch with two options, day 2 Breakfast), drags with a real mouse, and the changes keep
 * themselves as the coach's draft before they publish. The API is answered by the shared fixtures;
 * every draft save and publish is captured so the test can read what would have been sent.
 */
interface Sent {
  contents: MealPlanDraftContent[];
  started: CreateMealPlanDraftRequest[];
  published: PublishMealPlanDraftRequest[];
}

async function openBuilder(
  page: Page,
  width: number,
  height: number,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<Sent> {
  const sent: Sent = { contents: [], started: [], published: [] };
  let version = 1;
  let published = false;
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      'GET /api/nutrition/meal-plans': (route: Route) =>
        json(route, 200, { items: [planSummary()], total: 1, skip: 0, take: 100 }),
      'GET /api/nutrition/meal-plan-drafts': (route: Route) => json(route, 200, []),
      'GET /api/nutrition/meal-plans/plan-1': (route: Route) =>
        json(
          route,
          200,
          published
            ? planDetail({
                currentRevision: 3,
                versions: [
                  { ...planDetail().versions[0], id: 'plan-v3', revision: 3 },
                  ...planDetail().versions,
                ],
              })
            : planDetail(),
        ),
      'GET /api/nutrition/meal-plan-versions/plan-v2': (route: Route) =>
        json(route, 200, versionView()),
      'GET /api/nutrition/meal-plan-versions/plan-v3': (route: Route) =>
        json(route, 200, versionView({ id: 'plan-v3', revision: 3 })),
      'GET /api/nutrition/recipes': (route: Route) =>
        json(route, 200, { items: RECIPES, total: RECIPES.length, skip: 0, take: 100 }),
      'POST /api/nutrition/meal-plan-drafts': (route: Route) => {
        const body = route.request().postDataJSON() as CreateMealPlanDraftRequest;
        sent.started.push(body);
        sent.contents.push(body.content);
        return json(route, 200, saveView('draft-1', version));
      },
      'PUT /api/nutrition/meal-plan-drafts/draft-1': (route: Route) => {
        const body = route.request().postDataJSON() as SaveMealPlanDraftRequest;
        expect(body.version).toBe(version);
        sent.contents.push(body.content);
        return json(route, 200, saveView('draft-1', ++version));
      },
      'POST /api/nutrition/meal-plan-drafts/draft-1/publish': (route: Route) => {
        sent.published.push(route.request().postDataJSON() as PublishMealPlanDraftRequest);
        published = true;
        return json(route, 200, planSummary({ versionId: 'plan-v3', revision: 3 }));
      },
    },
  });
  await page.goto('/nutrition/plans/plan-1');
  await expect(page.locator('.meal-card').first()).toBeVisible();
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
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Both ends of the drag must be on screen.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
  await page.mouse.move(end.x + end.width / 2 + 1, end.y + end.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
}

const day = (page: Page, index: number) => page.locator('section.day').nth(index);

test('Meal plans at 390px and 1440px lists every plan as a card, the coach’s new ones first', async ({
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
        'GET /api/nutrition/meal-plans': (route: Route) =>
          json(route, 200, { items: [planSummary()], total: 1, skip: 0, take: 100 }),
        'GET /api/nutrition/meal-plan-drafts': (route: Route) =>
          json(route, 200, [
            draftSummary({ id: 'draft-new', mealPlanTemplateId: null, name: 'Cut, phase 1' }),
          ]),
      },
    });
    await page.goto('/nutrition');
    await expect(page.getByRole('heading', { name: 'Meal plans', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lean bulk' })).toHaveAttribute(
      'href',
      '/nutrition/plans/plan-1',
    );
    await expect(page.getByRole('link', { name: 'Cut, phase 1' })).toHaveAttribute(
      'href',
      '/nutrition/plans/new?draft=draft-new',
    );
    await expect(page.locator('.card').nth(1)).toContainText('Protein 30% · Carbs 40% · Fat 30%');
    await expectNoHorizontalOverflow(page);
    await axe(page);
  }
});

test('the builder takes drags, keeps them as the coach’s draft, and publishes it', async ({
  page,
}) => {
  const sent = await openBuilder(page, 1440, 1000);
  await page.getByRole('button', { name: 'Hide recipes' }).waitFor();

  // A recipe dropped under day 2 starts a meal there, named after the day's next usual meal.
  await drag(
    page,
    page.locator('app-meal-plan-library .lib-item', { hasText: 'Chicken & rice' }),
    day(page, 1).locator('.new-meal'),
  );
  await expect(day(page, 1).locator('.meal-name')).toHaveText(['Breakfast', 'Lunch']);
  await expect(page.locator('.status')).toHaveText(/^Saved at \d\d:\d\d, not published yet$/);
  expect(sent.started[0]).toMatchObject({
    mealPlanTemplateId: 'plan-1',
    sourceVersionId: 'plan-v2',
    templateRevision: 2,
  });

  // A recipe dropped onto day 1's Breakfast becomes another option of it.
  await drag(
    page,
    page.locator('app-meal-plan-library .lib-item', { hasText: 'Lentil soup' }),
    day(page, 0).locator('.meal-card', { hasText: 'Breakfast' }).locator('.option-list'),
  );
  await expect(
    day(page, 0).locator('.meal-card', { hasText: 'Breakfast' }).locator('.option-row'),
  ).toHaveCount(2);

  // Day 1's Lunch moves to day 2 by its grip.
  await drag(
    page,
    day(page, 0).locator('.meal-card', { hasText: 'Lunch' }).locator('.meal-grip'),
    day(page, 1).locator('.meal-list'),
  );
  await expect(day(page, 0).locator('.meal-name')).toHaveText(['Breakfast']);
  await expect(page.locator('.status')).toHaveText(/^Saved at/);
  await axe(page);

  // The newest content the server holds is what the grid shows.
  const content = sent.contents.at(-1)!;
  expect(content.days?.map((one) => one.meals?.map((meal) => meal.name))).toEqual([
    ['Breakfast'],
    expect.arrayContaining(['Breakfast', 'Lunch', 'Lunch']),
  ]);
  expect(content.days?.[0].meals?.[0].choices?.map((choice) => choice.recipeVersionId)).toEqual([
    'oats-v1',
    'lentils-v1',
  ]);

  // Publish sends the draft's version, and the page opens the new version.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('Published: you can assign it');
  expect(sent.published).toEqual([{ version: sent.contents.length, replaceNewer: false }]);
});

test('a phone shows one day at a time, in dark, right to left and at 200% text', async ({
  page,
}) => {
  await openBuilder(page, 390, 844, 'dark');

  await expect(page.locator('aside.library')).toBeHidden();
  await expect(page.locator('section.day:visible')).toHaveCount(1);
  // The chip is what a thumb taps; its radio is there for a screen reader.
  await expect(page.getByRole('radio', { name: 'Day 1' })).toBeChecked();
  await page.locator('label.day-chip').nth(1).click();
  await expect(page.getByRole('radio', { name: 'Day 2' })).toBeChecked();
  await expect(page.locator('section.day:visible .day-number')).toHaveText('Day 2');
  await expectNoHorizontalOverflow(page);
  await axe(page);

  // The meal sheet and the recipe sheet are the phone's way to change a meal.
  await page.getByRole('button', { name: 'Edit Breakfast on day 2' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit meal' });
  await expect(editor.getByLabel('Servings of Overnight oats')).toHaveValue('1.5');
  await axe(page);
  await editor.getByRole('button', { name: 'Add another option' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a recipe to Breakfast' });
  await picker.getByRole('button', { name: 'Add Chicken & rice' }).click();
  await expect(picker).toBeHidden();
  await expect(editor.locator('.option')).toHaveCount(2);
  await editor.getByRole('button', { name: 'Done' }).click();

  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalOverflow(page);
  await axe(page);
});
