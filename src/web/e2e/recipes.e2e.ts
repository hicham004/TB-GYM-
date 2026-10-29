import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type {
  AddRecipeVersionRequest,
  CreateRecipeDraftRequest,
  CreateRecipeRequest,
  PublishRecipeDraftRequest,
  RecipeDraftContent,
  RecipeDraftSummary,
  SaveRecipeDraftRequest,
} from '../src/app/core/api/generated';
import {
  draftSaved,
  draftSummary,
  OATS_FOOD,
  recipeDetail,
  recipeDraftView,
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
  /** The coach's draft as each autosave sent it (critique B5d), the first one starting it. */
  started: CreateRecipeDraftRequest[];
  saved: SaveRecipeDraftRequest[];
  published: PublishRecipeDraftRequest[];
}

/** What the coach's draft last held, as the newest autosave sent it. */
function lastContent(sent: Sent): RecipeDraftContent | undefined {
  return sent.saved.at(-1)?.content ?? sent.started.at(-1)?.content;
}

/** The coach's own drafts the Recipes page lists: by default, none. */
let drafts: RecipeDraftSummary[] = [];

async function openRecipes(
  page: Page,
  width: number,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<Sent> {
  const sent: Sent = { created: [], versions: [], started: [], saved: [], published: [] };
  let version = 0;
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width, height: 900 });
  await mockSession(page, {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      'GET /api/nutrition/recipes': (route: Route) =>
        json(route, 200, {
          items: RECIPES,
          total: RECIPES.length,
          skip: 0,
          take: 48,
          counts: { all: 3, published: 2, drafts: 1 },
        }),
      'GET /api/nutrition/recipes/recipe-oats': (route: Route) => json(route, 200, recipeDetail()),
      'GET /api/nutrition/recipes/recipe-new': (route: Route) =>
        json(route, 200, recipeDetail({ id: 'recipe-new', name: 'Oats & yogurt' })),
      'GET /api/nutrition/recipes/recipe-edited': (route: Route) => json(route, 200, EDITED),
      'GET /api/nutrition/recipes/recipe-changing': (route: Route) =>
        json(
          route,
          200,
          recipeDetail({
            id: 'recipe-changing',
            draft: draftSummary({ id: 'draft-1', recipeId: 'recipe-changing', name: 'Berry oats' }),
          }),
        ),
      'GET /api/nutrition/recipe-drafts': (route: Route) => json(route, 200, drafts),
      'GET /api/nutrition/recipe-drafts/draft-1': (route: Route) =>
        json(route, 200, recipeDraftView({ recipeId: 'recipe-changing' })),
      'POST /api/nutrition/recipe-drafts': (route: Route) => {
        const request = route.request().postDataJSON() as CreateRecipeDraftRequest;
        sent.started.push(request);
        version = 1;
        return json(route, 200, draftSaved(request.recipeId ? 'draft-1' : 'draft-new', version));
      },
      'PUT /api/nutrition/recipe-drafts/draft-new': (route: Route) => {
        sent.saved.push(route.request().postDataJSON() as SaveRecipeDraftRequest);
        return json(route, 200, draftSaved('draft-new', ++version));
      },
      'PUT /api/nutrition/recipe-drafts/draft-1': (route: Route) => {
        sent.saved.push(route.request().postDataJSON() as SaveRecipeDraftRequest);
        return json(route, 200, draftSaved('draft-1', ++version));
      },
      'POST /api/nutrition/recipe-drafts/draft-new/publish': (route: Route) => {
        sent.published.push(route.request().postDataJSON() as PublishRecipeDraftRequest);
        return json(route, 200, recipeSummary({ id: 'recipe-new' }));
      },
      'POST /api/nutrition/recipe-drafts/draft-1/publish': (route: Route) => {
        sent.published.push(route.request().postDataJSON() as PublishRecipeDraftRequest);
        return json(route, 200, recipeSummary());
      },
      // The editor saves through the coach's draft since B5d; these answer only if it ever did not.
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
  // The change is the coach's own, kept as they type (critique B5d), beside the recipe's status.
  await expect(page.locator('.standing')).toContainText('Published In progress');
  await expect(page.locator('.save-status')).toContainText('not published yet');
  expect(sent.started[0]).toMatchObject({ recipeId: 'recipe-oats', recipeRevision: 1 });
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await expect.poll(() => sent.published.length).toBe(1);
  expect(sent.published[0]).toMatchObject({ replaceNewer: false, keepAsDraft: false });
  expect(lastContent(sent)).toMatchObject({ photoMediaAssetId: 'photo-1' });
  expect(lastContent(sent)?.lines?.map((line) => line.quantity)).toEqual([160, 200]);
  expect(sent.versions).toHaveLength(0);
});

test('a new recipe from the food search, kept as it is typed and published from its draft', async ({
  page,
}) => {
  const sent = await openRecipes(page, 1440);
  await page.goto('/nutrition/recipes/new');
  await page.getByRole('textbox', { name: 'Recipe name' }).fill('Oats & yogurt');
  // The first pause starts the coach's draft, which the address keeps for a refresh.
  await expect(page).toHaveURL(/\/nutrition\/recipes\/new\?draft=draft-new$/);
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
  expect(sent.started).toHaveLength(1);
  expect(sent.started[0]).toMatchObject({ recipeId: null, content: { name: 'Oats & yogurt' } });
  expect(lastContent(sent)).toMatchObject({
    name: 'Oats & yogurt',
    servings: 1,
    instructions: 'Stir and chill.',
  });
  expect(sent.published).toEqual([
    { version: sent.saved.length + 1, replaceNewer: false, keepAsDraft: false },
  ]);
  expect(sent.created).toHaveLength(0);
});

for (const width of [390, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`recipes in progress at ${width}, ${colorScheme} (critique B5d)`, async ({ page }) => {
      drafts = [draftSummary()];
      try {
        await openRecipes(page, width, colorScheme);
        await page.goto('/nutrition/recipes');
        const cards = page.locator('.card');
        await expect(cards).toHaveCount(4);
        await expect(cards.first()).toContainText('Lentil soup');
        await expect(cards.first().locator('.pills')).toHaveText('In progress');
        await expect(cards.first()).toContainText('Only you see it until you publish it.');
        await expect(page.locator('.lede')).toHaveText('3 recipes, 1 still a draft, 1 in progress');
        await expect(page.getByText('Drafts (2)')).toBeVisible();
        await waitForFonts(page);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await expectNoHorizontalOverflow(page);

        // A saved recipe with the coach's changes opens on them, said beside its status.
        await page.goto('/nutrition/recipes/recipe-changing');
        await expect(page.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Berry oats');
        await expect(page.locator('.standing')).toContainText(
          'Published In progress Only you see these changes.',
        );
        await expect(page.locator('.save-status')).toHaveText(
          'Saved on Tue 20 Oct, not published yet',
        );
        await expect(page.getByRole('button', { name: 'Discard changes' })).toBeVisible();
        await waitForFonts(page);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await expectNoHorizontalOverflow(page);
      } finally {
        drafts = [];
      }
    });
  }
}

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
