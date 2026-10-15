import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type {
  CreateFoodItemRequest,
  UpdateNutritionSettingsRequest,
} from '../src/app/core/api/generated';
import {
  CHICKEN_FOOD,
  CHOBANI_RESULT,
  nutritionSettings,
  OATS_FOOD,
  usdaResult,
  YOGURT_FOOD,
} from '../src/testing/food-fixtures';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * Foods and Settings › Nutrition (C7, R4.4c) in a real browser: one search over the coach's foods and
 * USDA's, a USDA match copied with one button, a food of the coach's own added from the sheet with its
 * calories adding up as it is typed, the sheet asking before it closes with something typed, a food
 * archived with Undo and restored from the archived foods, and the owner's calculation defaults. The
 * API is answered by the shared fixtures, and every save is captured so the test reads what would
 * have been sent.
 */

const FOODS = [CHICKEN_FOOD, YOGURT_FOOD, OATS_FOOD];
const BASIC = [
  usdaResult(),
  usdaResult({
    externalId: '171077',
    name: 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw',
    dataType: 'SR Legacy',
    calories: 120,
    proteinGrams: 22.5,
    fatGrams: 2.62,
  }),
  usdaResult({
    externalId: '2705964',
    name: 'Chicken breast, grilled without sauce, skin not eaten',
    dataType: 'Survey (FNDDS)',
    calories: 155,
    proteinGrams: 29.6,
    fatGrams: 3.6,
  }),
];

interface Sent {
  imported: string[];
  created: CreateFoodItemRequest[];
  settings: UpdateNutritionSettingsRequest[];
  archived: [string, boolean][];
}

async function open(
  page: Page,
  width: number,
  options: { colorScheme?: 'light' | 'dark'; owner?: boolean } = {},
): Promise<Sent> {
  const sent: Sent = { imported: [], created: [], settings: [], archived: [] };
  const shelved = new Set<string>();
  const archive = (food: (typeof FOODS)[number]) => (route: Route) => {
    const { isArchived } = route.request().postDataJSON() as { isArchived: boolean };
    sent.archived.push([food.id, isArchived]);
    if (isArchived) shelved.add(food.id);
    else shelved.delete(food.id);
    return json(route, 200, {
      ...food,
      archivedAtUtc: isArchived ? '2026-10-07T09:00:00Z' : null,
    });
  };
  await page.emulateMedia({ colorScheme: options.colorScheme ?? 'light' });
  await page.setViewportSize({ width, height: 900 });
  await mockSession(page, {
    memberships: [options.owner ? OWNER_MEMBERSHIP : COACH_MEMBERSHIP],
    extra: {
      'GET /api/nutrition/foods': (route: Route) => {
        const params = new URL(route.request().url()).searchParams;
        const query = (params.get('query') ?? '').toLowerCase();
        const archived = params.get('archived') === 'true';
        const items = FOODS.filter(
          (food) => food.name.toLowerCase().includes(query) && shelved.has(food.id) === archived,
        ).map((food) =>
          shelved.has(food.id) ? { ...food, archivedAtUtc: '2026-10-07T09:00:00Z' } : food,
        );
        return json(route, 200, { items, total: items.length, skip: 0, take: 50 });
      },
      ...Object.fromEntries(
        FOODS.map((food) => [`PUT /api/nutrition/foods/${food.id}/archive`, archive(food)]),
      ),
      'GET /api/nutrition/providers/usda/search': (route: Route) => {
        const kind = new URL(route.request().url()).searchParams.get('kind');
        return json(route, 200, {
          skip: 0,
          take: 20,
          items: kind === 'Packaged' ? [CHOBANI_RESULT] : BASIC,
        });
      },
      'POST /api/nutrition/providers/usda/import': (route: Route) => {
        sent.imported.push((route.request().postDataJSON() as { fdcId: string }).fdcId);
        return json(route, 200, CHICKEN_FOOD);
      },
      'POST /api/nutrition/foods': (route: Route) => {
        const request = route.request().postDataJSON() as CreateFoodItemRequest;
        sent.created.push(request);
        return json(route, 200, { ...OATS_FOOD, id: 'food-labneh', name: request.name });
      },
      'GET /api/nutrition/settings': (route: Route) => json(route, 200, nutritionSettings()),
      'PUT /api/nutrition/settings': (route: Route) => {
        const request = route.request().postDataJSON() as UpdateNutritionSettingsRequest;
        sent.settings.push(request);
        return json(route, 200, nutritionSettings({ ...request, version: 8 }));
      },
    },
  });
  return sent;
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search your foods and USDA' }).fill(text);
  await expect(page.locator('section[aria-labelledby="usda-heading"] .row').first()).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`foods and a USDA search at ${width}`, async ({ page }) => {
    await open(page, width);
    await page.goto('/nutrition/foods');
    await expect(page.locator('section[aria-labelledby="own-heading"] .row')).toHaveCount(3);
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `../../docs/design/r44c-foods-${width}.png`, fullPage: true });

    await search(page, 'chicken');
    await expect(page.locator('section[aria-labelledby="own-heading"] .row')).toHaveCount(1);
    await expect(page.locator('section[aria-labelledby="usda-heading"] .row')).toHaveCount(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `../../docs/design/r44c-search-${width}.png`, fullPage: true });
  });

  test(`the food sheet at ${width}`, async ({ page }) => {
    await open(page, width);
    await page.goto('/nutrition/foods');
    await page.getByRole('button', { name: 'New food' }).click();
    const sheet = page.getByRole('dialog', { name: 'New food' });
    await sheet.getByRole('textbox', { name: 'Name' }).fill('Labneh');
    await sheet.getByRole('spinbutton', { name: 'Protein' }).fill('6');
    await sheet.getByRole('spinbutton', { name: 'Carbs' }).fill('4');
    await sheet.getByRole('spinbutton', { name: 'Fat' }).fill('10');
    await expect(sheet.locator('.estimate')).toHaveText(
      'About 130 kcal in 100 g, counted as on US-style labels.',
    );
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `../../docs/design/r44c-new-food-${width}.png` });
  });

  test(`Settings › Nutrition at ${width}`, async ({ page }) => {
    await open(page, width, { owner: true });
    await page.goto('/workspace/nutrition');
    await expect(page.getByRole('heading', { name: 'Counting calories' })).toBeVisible();
    await waitForFonts(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `../../docs/design/r44c-settings-${width}.png`, fullPage: true });
  });
}

test('a USDA match is copied with one button, and packaged products are asked for', async ({
  page,
}) => {
  const sent = await open(page, 1440);
  await page.goto('/nutrition/foods');
  await search(page, 'chicken breast');
  const usda = page.locator('section[aria-labelledby="usda-heading"]');
  await expect(usda.locator('.database')).toHaveCount(0);
  await usda.getByText('Database details').click();
  await expect(usda.locator('.database').first()).toHaveText(
    'FoodData Central 2646170 · Foundation',
  );

  await usda.getByRole('button', { name: 'Add Chicken breast, grilled without sauce' }).click();
  await expect.poll(() => sent.imported).toEqual(['2705964']);
  await expect(usda.locator('.row').nth(2).locator('.added')).toHaveText('In your foods');

  await usda.getByRole('radio', { name: 'Packaged products' }).check();
  await expect(usda.locator('.row')).toHaveCount(1);
  await expect(usda.locator('.row .meta').first()).toHaveText('Chobani');
});

test('a food of the coach’s own is saved from the sheet, and a USDA food opens as a copy', async ({
  page,
}) => {
  const sent = await open(page, 1440);
  await page.goto('/nutrition/foods');
  await page.getByRole('button', { name: 'New food' }).click();
  const sheet = page.getByRole('dialog', { name: 'New food' });
  await sheet.getByRole('button', { name: 'Save food' }).click();
  await expect(sheet.locator('.summary')).toHaveText('Check the boxes marked below.');
  await expect(sheet.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Labneh');
  await sheet.getByRole('spinbutton', { name: 'Protein' }).fill('6');
  await sheet.getByRole('spinbutton', { name: 'Carbs' }).fill('4');
  await sheet.getByRole('spinbutton', { name: 'Fat' }).fill('10');
  await sheet.getByText('Milk', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Save food' }).click();
  await expect.poll(() => sent.created.length).toBe(1);
  expect(sent.created[0]).toMatchObject({
    name: 'Labneh',
    provenance: 'CoachAuthored',
    version: { proteinGrams: 6, carbohydrateGrams: 4, fatGrams: 10, declaredAllergens: ['Milk'] },
  });
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Chicken, breast, boneless, skinless, raw' }).click();
  const details = page.getByRole('dialog', { name: 'Chicken, breast, boneless, skinless, raw' });
  await expect(details).toContainText('USDA didn’t report fibre, sugar alcohols, alcohol');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '../../docs/design/r44c-details-1440.png' });
  await details.getByRole('button', { name: 'Edit a copy' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Your copy of Chicken, breast, boneless, skinless, raw' }),
  ).toBeVisible();
});

test('the food sheet asks before it closes with something typed', async ({ page }) => {
  await open(page, 1440);
  await page.goto('/nutrition/foods');
  await page.getByRole('button', { name: 'New food' }).click();
  const sheet = page.getByRole('dialog', { name: 'New food' });
  await sheet.getByRole('spinbutton', { name: 'Protein' }).fill('6');
  await page.keyboard.press('Escape');
  const question = page.getByRole('dialog', { name: 'Close without saving?' });
  await expect(question).toContainText(
    'This food isn’t saved. If you close it now, what you typed is lost.',
  );
  await page.waitForTimeout(300);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByRole('spinbutton', { name: 'Protein' })).toHaveValue('6');

  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await question.getByRole('button', { name: 'Close without saving' }).click();
  await expect(sheet).toHaveCount(0);
});

test('a food is archived with Undo, listed apart and restored, at 200% text right to left', async ({
  page,
}) => {
  const sent = await open(page, 1440);
  await page.goto('/nutrition/foods');
  await page.getByRole('button', { name: 'Greek yogurt', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Greek yogurt' })
    .getByRole('button', { name: 'Archive food' })
    .click();
  await expect(page.getByText('Greek yogurt is archived.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Greek yogurt', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Greek yogurt', exact: true })).toBeVisible();
  expect(sent.archived).toEqual([
    ['food-yogurt', true],
    ['food-yogurt', false],
  ]);

  await page.getByRole('button', { name: 'Rolled oats', exact: true }).click();
  await page.getByRole('button', { name: 'Archive food' }).click();
  await page.getByRole('button', { name: 'Archived foods' }).click();
  await expect(page.getByRole('heading', { name: 'Archived foods' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="own-heading"] .row')).toHaveCount(1);
  await expect(page.locator('section[aria-labelledby="usda-heading"]')).toHaveCount(0);
  await waitForFonts(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Rolled oats', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Rolled oats' });
  await expect(details).toContainText('Archived on 7 Oct 2026.');
  await expect(details.getByRole('button', { name: 'Edit food' })).toHaveCount(0);
  await details.getByRole('button', { name: 'Restore food' }).click();
  await expect(page.getByText('Rolled oats is back in your foods.')).toBeVisible();
  expect(sent.archived.at(-1)).toEqual(['food-oats', false]);
});

test('the owner saves how calories are counted', async ({ page }) => {
  const sent = await open(page, 1440, { owner: true });
  await page.goto('/workspace/nutrition');
  await page.getByText('EU-style labels', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Suggestions a month' }).fill('150');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('TB Gym allows up to 100 a month.', { exact: true })).toBeVisible();
  expect(sent.settings).toHaveLength(0);
  await page.getByRole('spinbutton', { name: 'Suggestions a month' }).fill('80');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => sent.settings.length).toBe(1);
  expect(sent.settings[0]).toMatchObject({
    energyPolicyKey: 'Eu1169',
    aiMonthlyRequestLimit: 80,
    version: 7,
  });
});

test('foods in dark, right to left and at 200% text', async ({ page }) => {
  await open(page, 1440, { colorScheme: 'dark' });
  await page.goto('/nutrition/foods');
  await search(page, 'chicken');
  await waitForFonts(page);
  await page.screenshot({ path: '../../docs/design/r44c-search-dark-1440.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
