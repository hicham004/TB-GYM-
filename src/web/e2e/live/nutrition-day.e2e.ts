import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * The client's nutrition day against a live API (M4, NUT-005, NUT-012, ADR 0032): the macro rings
 * equal the meals and extra food logged, an extra food reverses once, a day outside the plan and a
 * client without nutrition read friendly words. The write test adds an extra food and removes it
 * again, so a rerun on the same database changes no total.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

interface Choice {
  id: string;
  recipeName: string;
  servings: number;
  calories: number;
}
interface Slot {
  id: string;
  name: string;
  choices: Choice[];
  selectedChoiceId: string | null;
  actualServings: number | null;
}
interface CustomFood {
  id: string;
  name: string;
  calories: number;
}
interface DayView {
  planDayId: string;
  date: string;
  dailyLogId: string | null;
  dailyLogVersion: number | null;
  logStatus: string | null;
  targetCalories: number;
  selectedCalories: number;
  slots: Slot[];
  customFoods: CustomFood[];
}

const planClients = [ACCOUNTS.sara, ACCOUNTS.maya];

async function signInWithOpenDay(page: Parameters<typeof signIn>[0]) {
  for (const email of planClients) {
    await signIn(page, email);
    const tenantId = (await memberships(page))[0].tenantId;
    const day = await api<DayView>(page, 'GET', '/api/nutrition/me/day', { tenantId });
    if (day.status === 200 && day.body.logStatus !== 'Completed') {
      return { email, tenantId, day: day.body };
    }
    await api(page, 'POST', '/api/auth/logout');
  }
  return null;
}

function caloriesLogged(day: DayView): number {
  let total = 0;
  for (const slot of day.slots) {
    if (!slot.selectedChoiceId) continue;
    const choice = slot.choices.find((item) => item.id === slot.selectedChoiceId)!;
    total += (choice.calories * (slot.actualServings ?? choice.servings)) / choice.servings;
  }
  return total + day.customFoods.reduce((sum, food) => sum + food.calories, 0);
}

test('the rings show what was logged against the plan, and an extra food reverses once', async ({
  page,
}) => {
  const open = await signInWithOpenDay(page);
  test.skip(!open, 'Every demo client with a meal plan has completed today.');
  const { tenantId, day } = open!;

  await page.goto('/nutrition/today');
  await expect(page.getByRole('heading', { name: 'Meals for the day' })).toBeVisible();
  const rings = page.locator('app-progress-ring');
  await expect(rings).toHaveCount(4);
  const logged = Math.round(caloriesLogged(day));
  const target = Math.round(day.targetCalories);
  await expect(rings.first()).toContainText(
    `${logged.toLocaleString('en-US')} / ${target.toLocaleString('en-US')} kcal`,
  );
  await expect(page.getByText(/of \d+ planned meals logged/)).toBeVisible();

  await test.step('Add food logs an extra food for the amount eaten', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Food name').fill('Live-check dark chocolate');
    await page.getByLabel('Amount eaten').fill('20');
    await page.getByLabel('Unit').selectOption('Gram');
    await page.getByLabel('Calories (kcal)').fill('110');
    await page.getByLabel('Protein (g)').fill('1');
    await page.getByLabel('Carbs (g)').fill('12');
    await page.getByLabel('Fat (g)').fill('7');
    await page.getByRole('button', { name: 'Log extra food' }).click();
    await expect(page.getByText('Extra food logged.')).toBeVisible();
    await expect(page.locator('.extra-list')).toContainText('Live-check dark chocolate');
    await expect(rings.first()).toContainText(
      `${(logged + 110).toLocaleString('en-US')} / ${target.toLocaleString('en-US')} kcal`,
    );
  });

  await test.step('Remove reverses it once; a second reversal is refused', async () => {
    const after = await api<DayView>(page, 'GET', '/api/nutrition/me/day', { tenantId });
    const mine = after.body.customFoods.find((food) => food.name === 'Live-check dark chocolate')!;
    expect(mine).toBeTruthy();
    await page.getByRole('button', { name: /Remove Live-check dark chocolate/ }).click();
    await expect(page.getByText("Extra food removed from today's totals.")).toBeVisible();
    // With no other extra food the list gives way to its empty line, so check the name itself.
    await expect(page.getByText('Live-check dark chocolate')).toHaveCount(0);
    await expect(rings.first()).toContainText(
      `${logged.toLocaleString('en-US')} / ${target.toLocaleString('en-US')} kcal`,
    );
    const again = await api<{ code?: string }>(
      page,
      'POST',
      `/api/nutrition/me/custom-foods/${mine.id}/reverse`,
      { tenantId, body: { reason: 'live check, second time' } },
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('nutrition_food_reversal_conflict');
  });
});

test('a day outside the plan and a client without nutrition read friendly words', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.maya);
  const tenantId = (await memberships(page))[0].tenantId;
  const farPast = await api(page, 'GET', '/api/nutrition/me/day?localDate=2025-01-15', {
    tenantId,
  });
  // Nothing for that day: "nothing here" is a 200 with null, not a 404 (audit AUTH-12).
  expect(farPast.status).toBe(200);
  expect(farPast.body).toBeNull();
  await page.goto('/nutrition/today');
  await expect(page.getByRole('heading', { name: 'Meals for the day' })).toBeVisible();
  for (let week = 0; week < 6; week++) {
    await page.getByRole('button', { name: 'Previous week' }).click();
  }
  await page.locator('.day-nav button').nth(1).click();
  await expect(
    page.getByRole('heading', { name: "Your coach hasn't set a meal plan for this day yet" }),
  ).toBeVisible();
  await expect(page.getByText('No authorized nutrition plan')).toHaveCount(0);

  await api(page, 'POST', '/api/auth/logout');
  await signIn(page, ACCOUNTS.rami);
  await expect(page.getByRole('link', { name: 'Nutrition' })).toHaveCount(0);
  await page.goto('/nutrition/today');
  await expect(page.getByRole('heading', { name: 'Meals are closed for now' })).toBeVisible();
  await expect(page.getByText('Nutrition is not in your plan. Ask your coach.')).toBeVisible();
  await expect(page.getByText('No authorized nutrition plan')).toHaveCount(0);
});
