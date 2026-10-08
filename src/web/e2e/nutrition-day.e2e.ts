import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const user = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Maya Rahman',
};
const decisions = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);
/** A 4×3 image, standing in for a coach's recipe photo. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4siAPjhhwcgCuMhXZQnoZuwAAAABJRU5ErkJggg==',
  'base64',
);

/** The client's copy of the lunch recipe (R4.4d). */
const chickenRecipe = {
  id: 'recipe-chicken',
  name: 'Chicken, rice & greens',
  servings: 2,
  prepMinutes: 15,
  cookMinutes: 20,
  instructions: ['Season and grill the chicken.', 'Cook the rice.', 'Serve over the greens.'].join(
    '\n',
  ),
  photoMediaAssetId: 'photo-chicken',
  ingredients: [
    { foodName: 'Chicken breast', quantity: 300, unit: 'Gram', basis: 'Raw' },
    { foodName: 'Basmati rice', quantity: 160, unit: 'Gram', basis: 'Raw' },
    { foodName: 'Spinach', quantity: 2, unit: 'Serving', basis: 'AsSold' },
  ],
};

const slots = [
  {
    id: 'breakfast',
    name: 'Breakfast',
    order: 0,
    selectedChoiceId: 'oats',
    actualServings: 1,
    choices: [
      {
        id: 'oats',
        recipeName: 'Overnight oats & berries',
        servings: 1,
        calories: 520,
        proteinGrams: 35,
        carbohydrateGrams: 65,
        fatGrams: 14,
      },
      {
        id: 'eggs',
        recipeName: 'Eggs and toast',
        servings: 1,
        calories: 480,
        proteinGrams: 30,
        carbohydrateGrams: 40,
        fatGrams: 20,
      },
    ],
  },
  {
    id: 'lunch',
    name: 'Lunch',
    order: 1,
    selectedChoiceId: null,
    actualServings: null,
    choices: [
      {
        id: 'chicken',
        recipeName: 'Chicken, rice & greens',
        recipeId: 'recipe-chicken',
        recipePhotoMediaAssetId: 'photo-chicken',
        servings: 1,
        calories: 680,
        proteinGrams: 50,
        carbohydrateGrams: 75,
        fatGrams: 18,
      },
      {
        id: 'salmon',
        recipeName: 'Salmon and potatoes',
        servings: 1,
        calories: 720,
        proteinGrams: 46,
        carbohydrateGrams: 70,
        fatGrams: 27,
      },
    ],
  },
  {
    id: 'dinner',
    name: 'Dinner',
    order: 2,
    selectedChoiceId: null,
    actualServings: null,
    choices: [
      {
        id: 'pasta',
        recipeName: 'Turkey pasta with tomato',
        servings: 1,
        calories: 610,
        proteinGrams: 42,
        carbohydrateGrams: 70,
        fatGrams: 17,
      },
    ],
  },
];

async function openNutrition(page: Page, width: number, height: number) {
  const state = {
    planId: 'plan',
    planDayId: 'plan-day',
    date: '2026-09-20',
    targetCalories: 2100,
    targetProteinGrams: 145,
    targetCarbohydrateGrams: 245,
    targetFatGrams: 68,
    dailyLogId: 'log',
    dailyLogVersion: 2,
    logStatus: 'InProgress',
    selectedCalories: 520,
    selectedProteinGrams: 35,
    selectedCarbohydrateGrams: 65,
    selectedFatGrams: 14,
    slots: structuredClone(slots),
    customFoods: [],
    safetyNotice: 'Allergen declarations may be incomplete. Ask your coach about concerns.',
  };
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [membership],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/nutrition/me/day': (route: Route) => json(route, 200, state),
      'PUT /api/nutrition/me/choices': (route: Route) => {
        const body = route.request().postDataJSON();
        const slot = state.slots.find((item) => item.id === body.planSlotId)!;
        slot.selectedChoiceId = body.choiceId;
        slot.actualServings = body.actualServings;
        state.selectedCalories += slot.choices.find((item) => item.id === body.choiceId)!.calories;
        state.dailyLogVersion++;
        return json(route, 200, state);
      },
      'POST /api/nutrition/me/custom-foods': (route: Route) => {
        const body = route.request().postDataJSON();
        state.customFoods.push({ id: 'extra-1', ...body });
        state.selectedCalories += body.calories;
        state.dailyLogVersion++;
        return json(route, 200, state);
      },
      'GET /api/nutrition/me/recipes/recipe-chicken': (route: Route) =>
        json(route, 200, chickenRecipe),
      'POST /api/media/photo-chicken/access': (route: Route) =>
        json(route, 200, {
          assetId: 'photo-chicken',
          kind: 'Image',
          source: 'Upload',
          contentType: 'image/png',
          url: '/api/media/photo-chicken/content?grant=e2e',
          expiresAtUtc: '2030-01-01T00:00:00Z',
          downloadAllowed: false,
          thumbnailUrl: null,
        }),
      // The day asks for its meal cards' photos in one batch (R4.4d).
      'POST /api/media/access': (route: Route) =>
        json(route, 200, {
          items: [
            {
              assetId: 'photo-chicken',
              kind: 'Image',
              source: 'Upload',
              contentType: 'image/png',
              url: '/api/media/photo-chicken/content?grant=e2e',
              expiresAtUtc: '2030-01-01T00:00:00Z',
              downloadAllowed: false,
              thumbnailUrl: null,
            },
          ],
        }),
      'GET /api/media/photo-chicken/content': (route: Route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }),
      'POST /api/nutrition/me/custom-foods/extra-1/reverse': (route: Route) => {
        state.selectedCalories -= state.customFoods[0].calories;
        state.customFoods.splice(0, 1);
        state.dailyLogVersion++;
        return json(route, 200, state);
      },
    },
  });
  await page.goto('/nutrition/today');
  await expect(page.getByRole('heading', { name: 'Meals for the day' })).toBeVisible();
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

test('Nutrition day at 390px shows the plan and logs a meal in one tap', async ({ page }) => {
  await openNutrition(page, 390, 844);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: '../../docs/design/r24-nutrition-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Ate as planned' }).first().click();
  await expect(page.getByText('2 of 3 planned meals logged')).toBeVisible();
  await page.getByRole('button', { name: 'Add food' }).click();
  await page.getByLabel('Food name').fill('Apple');
  await page.getByLabel('Amount eaten').fill('150');
  await page.getByLabel('Calories (kcal)').fill('80');
  await page.getByLabel('Protein (g)').fill('0');
  await page.getByLabel('Carbs (g)').fill('21');
  await page.getByLabel('Fat (g)').fill('0');
  await page.getByRole('button', { name: 'Log extra food' }).click();
  await expect(page.getByText('Apple')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Apple' }).click();
  await expect(page.getByText('Apple')).toHaveCount(0);
  await expect(page.getByText("Extra food removed from today's totals.")).toBeVisible();
});

test('Nutrition day at 1440px reflows at 200% text', async ({ page }) => {
  await openNutrition(page, 1440, 900);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: '../../docs/design/r24-nutrition-1440.png', fullPage: true });
  // The day follows the person's mode since R4.4d, so it passes in dark as well.
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
});

test('A meal’s recipe opens in a sheet at 390px, in light and dark, and reflows at 200% text', async ({
  page,
}) => {
  await openNutrition(page, 390, 844);
  await expect(page.getByRole('button', { name: 'Overnight oats & berries Recipe' })).toHaveCount(
    0,
  );
  // The lunch card leads with its recipe's photo; a meal without one shows none.
  const cardPhoto = page.locator('.meal-card img.meal-photo');
  await expect(cardPhoto).toHaveCount(1);
  await expect
    .poll(() => cardPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(4);
  await page.getByRole('button', { name: 'Chicken, rice & greens Recipe' }).click();

  const sheet = page.getByRole('dialog', { name: 'Chicken, rice & greens' });
  await expect(sheet.locator('.facts li')).toHaveText([
    'Prep 15 min',
    'Cook 20 min',
    'Makes 2 servings',
  ]);
  await expect(sheet.getByText('Your plan: 1 serving · 680 kcal')).toBeVisible();
  // The client's 1 serving of a recipe that makes 2 first, the whole recipe a tap away.
  await expect(sheet.locator('.note')).toHaveText(
    'For your 1 serving. The method is for the whole recipe.',
  );
  await expect(sheet.locator('.ingredients li')).toHaveText([
    'Chicken breast 150 g raw',
    'Basmati rice 80 g raw',
    'Spinach 1 serving',
  ]);
  await sheet.getByRole('radio', { name: 'Whole recipe' }).click();
  await expect(sheet.locator('.ingredients li')).toHaveText([
    'Chicken breast 300 g raw',
    'Basmati rice 160 g raw',
    'Spinach 2 servings',
  ]);
  await expect(sheet.getByRole('radio', { name: 'Whole recipe' })).toBeChecked();
  await expect(sheet.locator('.steps li')).toHaveText([
    'Season and grill the chicken.',
    'Cook the rice.',
    'Serve over the greens.',
  ]);
  const photo = sheet.getByRole('img', { name: 'Chicken, rice & greens, as your coach made it' });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(4);

  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe(page);

  // On paper the sheet prints alone and light, without its own controls.
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await expect(page.locator('app-root')).toBeHidden();
  await expect(sheet.getByRole('heading', { name: 'Chicken, rice & greens' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Print recipe' })).toBeHidden();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeHidden();
  await expect(sheet.locator('h2')).toHaveCSS('color', 'rgb(24, 45, 39)');
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' });
  await expect(sheet.getByRole('button', { name: 'Print recipe' })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
});
