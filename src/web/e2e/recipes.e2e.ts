import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { AddRecipeVersionRequest, CreateRecipeRequest } from '../src/app/core/api/generated';
import {
  OATS_FOOD,
  recipeDetail,
  recipeSummary,
  YOGURT_FOOD,
} from '../src/testing/recipe-fixtures';
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
import { docsPicture } from './docs-pictures';

/**
 * Recipes (C7, R4.4b) in a real browser: the cards, the editor with one serving adding up as amounts
 * are typed, a new recipe built from the food search and published in one save. The API is answered
 * by the shared fixtures, and every save is captured so the test reads what would have been sent.
 */

/** A drawn bowl stands in for a photo, so cards and the editor show one without a real upload. */
const BOWL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#e9dcc3"/><ellipse cx="160" cy="112" rx="104" ry="64" fill="#fffaf0"/><ellipse cx="160" cy="98" rx="86" ry="40" fill="#f3e3c3"/><circle cx="130" cy="92" r="14" fill="#c43d5a"/><circle cx="168" cy="84" r="12" fill="#4b4e9e"/><circle cx="192" cy="102" r="13" fill="#c43d5a"/><circle cx="150" cy="108" r="10" fill="#f2c14e"/></svg>`;

const RECIPES = [
  recipeSummary(),
  recipeSummary({
    id: 'recipe-shawarma',
    name: 'Chicken shawarma bowl',
    photoMediaAssetId: null,
    servings: 1,
    calories: 640,
    proteinGrams: 58,
    carbohydrateGrams: 62,
    fatGrams: 14,
    declaredAllergens: ['Milk'],
  }),
  recipeSummary({
    id: 'recipe-pancakes',
    name: 'Banana oat pancakes',
    status: 'Draft',
    publishedVersionId: null,
    photoMediaAssetId: null,
    servings: 1,
    calories: 470,
    proteinGrams: 21,
    carbohydrateGrams: 62,
    fatGrams: 15,
    declaredAllergens: ['GlutenCereals', 'Eggs'],
  }),
];

/** Both foods were edited since the recipe was saved (R4.4c), so each line is offered its new numbers. */
const EDITED = (() => {
  const detail = recipeDetail({ id: 'recipe-edited' });
  const newer = (food: typeof OATS_FOOD, versionId: string) => ({
    ...food,
    currentRevision: 2,
    currentVersion: { ...food.currentVersion, id: versionId },
  });
  const [oats, yogurt] = detail.latest.ingredients;
  return {
    ...detail,
    latest: {
      ...detail.latest,
      ingredients: [
        { ...oats, newerFood: newer(OATS_FOOD, 'oats-food-v2') },
        { ...yogurt, newerFood: newer(YOGURT_FOOD, 'yogurt-food-v2') },
      ],
    },
  };
})();

interface Sent {
  created: CreateRecipeRequest[];
  versions: AddRecipeVersionRequest[];
}

async function openRecipes(
  page: Page,
  width: number,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<Sent> {
  const sent: Sent = { created: [], versions: [] };
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width, height: 900 });
  await mockSession(page, {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      'GET /api/nutrition/recipes': (route: Route) =>
        json(route, 200, { items: RECIPES, total: RECIPES.length, skip: 0, take: 48 }),
      'GET /api/nutrition/recipes/recipe-oats': (route: Route) => json(route, 200, recipeDetail()),
      'GET /api/nutrition/recipes/recipe-new': (route: Route) =>
        json(route, 200, recipeDetail({ id: 'recipe-new', name: 'Oats & yogurt' })),
      'GET /api/nutrition/recipes/recipe-edited': (route: Route) => json(route, 200, EDITED),
      'POST /api/nutrition/recipes': (route: Route) => {
        sent.created.push(route.request().postDataJSON() as CreateRecipeRequest);
        return json(route, 200, recipeSummary({ id: 'recipe-new' }));
      },
      'POST /api/nutrition/recipes/recipe-oats/versions': (route: Route) => {
        sent.versions.push(route.request().postDataJSON() as AddRecipeVersionRequest);
        return json(route, 200, recipeSummary());
      },
      'GET /api/nutrition/foods': (route: Route) => {
        const query = (
          new URL(route.request().url()).searchParams.get('query') ?? ''
        ).toLowerCase();
        const items = [OATS_FOOD, YOGURT_FOOD].filter((food) =>
          food.name.toLowerCase().includes(query),
        );
        return json(route, 200, { items, total: items.length, skip: 0, take: 20 });
      },
      'GET /api/nutrition/providers/usda/search': (route: Route) =>
        json(route, 200, {
          skip: 0,
          take: 10,
          items: [
            {
              externalId: '173904',
              name: 'Oats, regular and quick, dry',
              dataType: 'SR Legacy',
              provider: 'UsdaFdc',
            },
          ],
        }),
      'GET /api/nutrition/ai-drafts/availability': (route: Route) =>
        json(route, 200, { isConfigured: false }),
      'POST /api/media/access': (route: Route) =>
        json(route, 200, {
          items: [
            {
              assetId: 'photo-1',
              kind: 'Image',
              source: 'Upload',
              contentType: 'image/svg+xml',
              url: '/api/media/photo-1/content',
              thumbnailUrl: '/api/media/photo-1/content/thumbnail',
              expiresAtUtc: '2026-10-07T12:00:00Z',
              downloadAllowed: true,
            },
          ],
        }),
      'GET /api/media/photo-1/content': (route: Route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: BOWL }),
      'GET /api/media/photo-1/content/thumbnail': (route: Route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: BOWL }),
    },
  });
  return sent;
}

for (const width of [390, 1440]) {
  test(`recipe cards at ${width}`, async ({ page }) => {
    await openRecipes(page, width);
    await page.goto('/nutrition/recipes');
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('img')).toBeVisible();
    await expect(cards.nth(0)).toContainText('222 kcal a serving');
    await expect(cards.nth(2)).toContainText('Draft');
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await docsPicture(page, `r44b-recipes-${width}.png`, { fullPage: true });
  });

  test(`the recipe editor at ${width}`, async ({ page }) => {
    await openRecipes(page, width);
    await page.goto('/nutrition/recipes/recipe-oats');
    await expect(page.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Overnight oats');
    await expect(page.locator('.totals .big')).toHaveText('222 kcal');
    await expect(page.locator('.photo img')).toBeVisible();
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await docsPicture(page, `r44b-editor-${width}.png`, { fullPage: true });
  });
}

test('one serving adds up as amounts are typed, and changes publish as a new version', async ({
  page,
}) => {
  const sent = await openRecipes(page, 1440);
  await page.goto('/nutrition/recipes/recipe-oats');
  await page.getByRole('spinbutton', { name: 'Amount of Rolled oats' }).fill('160');
  await expect(page.locator('.totals .big')).toHaveText('374 kcal');
  await expect(page.locator('.standing')).toContainText('Changes not published');
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await expect.poll(() => sent.versions.length).toBe(1);
  expect(sent.versions[0]).toMatchObject({
    publish: true,
    baseRevision: 1,
    photoMediaAssetId: 'photo-1',
  });
  expect(sent.versions[0].ingredients.map((line) => line.quantity)).toEqual([160, 200]);
});

test('a new recipe from the food search, published in one save', async ({ page }) => {
  const sent = await openRecipes(page, 1440);
  await page.goto('/nutrition/recipes/new');
  await page.getByRole('textbox', { name: 'Recipe name' }).fill('Oats & yogurt');
  const search = page.getByRole('combobox', { name: 'Add an ingredient' });
  await search.fill('oats');
  // The coach's own food comes first; USDA's match is offered under it.
  await expect(page.getByRole('option').first()).toContainText('Rolled oats');
  await expect(page.getByRole('group', { name: 'From USDA, added to your foods' })).toBeVisible();
  await docsPicture(page, 'r44b-search-1440.png');
  await search.press('Enter');
  await search.fill('yogurt');
  await expect(page.getByRole('option').first()).toContainText('Greek yogurt');
  await page.getByRole('option').first().click();
  await expect(page.locator('.line .line-name')).toHaveText(['Rolled oats', 'Greek yogurt']);
  await expect(page.locator('.totals .big')).toHaveText('450 kcal');
  await page.getByRole('textbox', { name: 'How to make it' }).fill('Stir and chill.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page).toHaveURL(/\/nutrition\/recipes\/recipe-new$/);
  expect(sent.created).toHaveLength(1);
  expect(sent.created[0]).toMatchObject({ name: 'Oats & yogurt', publish: true, servings: 1 });
});

test('lines whose foods were edited since are offered the new numbers, at 200% text', async ({
  page,
}) => {
  await openRecipes(page, 1440);
  await page.goto('/nutrition/recipes/recipe-edited');
  await expect(page.locator('.line-newer')).toHaveCount(2);
  await expect(page.locator('.banner.info')).toContainText(
    '2 of these foods were edited since this recipe was saved.',
  );
  await waitForFonts(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('button', { name: 'Publish changes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Use all the new numbers' }).click();
  await expect(page.locator('.line-newer')).toHaveCount(0);
  await expect(page.locator('.banner.info')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish changes' })).toBeEnabled();
});

test('the editor in dark, right to left and at 200% text', async ({ page }) => {
  await openRecipes(page, 1440, 'dark');
  await page.goto('/nutrition/recipes/recipe-oats');
  await expect(page.locator('.totals .big')).toHaveText('222 kcal');
  await waitForFonts(page);
  await docsPicture(page, 'r44b-editor-dark-1440.png', { fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
