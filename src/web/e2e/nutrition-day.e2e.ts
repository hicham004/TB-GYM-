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
});

test('Nutrition day at 1440px reflows at 200% text', async ({ page }) => {
  await openNutrition(page, 1440, 900);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: '../../docs/design/r24-nutrition-1440.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
});
