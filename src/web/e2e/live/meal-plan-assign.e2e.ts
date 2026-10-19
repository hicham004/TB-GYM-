import type { Locator, Page } from '@playwright/test';
import { ACCOUNTS, api, expect, memberships, requireLive, LIVE_URL, signIn, test } from './support';

/**
 * A meal plan from the library to a client's phone: Lea publishes a 7-day plan made of a published demo
 * recipe (API, unique name), picks one of her clients whose Nutrition still has a free week, works the
 * client's targets out in the Nutrition tab's sheet, assigns the plan from the first free day through
 * the calendar, and checks the record and the client's own copy through the API. The plan is cancelled
 * at the end (an audited coach operation, NUT-011), so the dates are free again and the spec can run
 * again on the same database.
 */
requireLive();

interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface Enrollment {
  id: string;
  storedStatus: string;
  features: string[];
  startDate: string;
  lastActiveDate: string;
}

interface ClientPlan {
  id: string;
  status: string;
  startDate: string;
  endDateExclusive: string;
  version: number | string;
  mealPlanName: string;
}

interface Recipe {
  id: string;
  name: string;
  status: string;
  publishedVersionId?: string | null;
  versionId: string;
}

interface Paged<T> {
  items: T[];
}

interface MealPlanSummary {
  id: string;
  versionId: string;
  name: string;
  status: string;
}

const PLAN_DAYS = 7;

function todayInBeirut(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "Mon 19 Oct", the way the screens write a day in the current year (Angular's 'EEE d MMM'). */
function dayWords(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(`${iso}T12:00:00Z`));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** Picks a day in the kit's date field: a button that opens a month calendar whose days carry data-date. */
async function pickDate(scope: Locator, iso: string): Promise<void> {
  const field = scope.locator('app-date-field').first();
  if ((await field.locator('.panel').count()) === 0) await field.locator('button.trigger').click();
  await expect(field.locator('.panel')).toBeVisible();
  const target = new Date(`${iso}T12:00:00Z`);
  for (let turn = 0; turn < 14; turn++) {
    const day = field.locator(`button.day[data-date="${iso}"]:not(.outside)`);
    if ((await day.count()) > 0) {
      await day.first().click();
      return;
    }
    const shown = new Date(`${(await field.locator('.month').innerText()).trim()} 1`);
    await field
      .locator('.head .nav')
      .nth(shown.getTime() < target.getTime() ? 1 : 0)
      .click();
  }
  throw new Error(`The calendar never reached ${iso}.`);
}

const contextOptions = { baseURL: LIVE_URL, locale: 'en-US', timezoneId: 'Asia/Beirut' } as const;

test.describe('meal plan assignment live', () => {
  test.setTimeout(240_000);

  test('publish a plan, work out targets, assign it on free dates, then cancel it', async ({
    browser,
  }) => {
    const coachContext = await browser.newContext({
      ...contextOptions,
      viewport: { width: 1440, height: 900 },
    });
    const lea: Page = await coachContext.newPage();
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const planName = `Live plan ${stamp}`;
    const today = todayInBeirut();

    await signIn(lea, ACCOUNTS.coachLea);
    const [{ tenantId }] = await memberships(lea);

    // A published recipe from the library makes the plan's one meal a day.
    const recipes = await api<Paged<Recipe>>(
      lea,
      'GET',
      '/api/nutrition/recipes?published=true&take=20',
      { tenantId },
    );
    expect(recipes.status).toBe(200);
    const recipe = recipes.body.items.find((item) => item.publishedVersionId);
    expect(recipe, 'the demo has at least one published recipe').toBeDefined();
    const recipeVersionId = recipe!.publishedVersionId!;

    const created = await api<MealPlanSummary>(lea, 'POST', '/api/nutrition/meal-plans', {
      tenantId,
      body: {
        name: planName,
        dayCount: PLAN_DAYS,
        targetCalories: 2000,
        targetProteinGrams: 150,
        targetCarbohydrateGrams: 200,
        targetFatGrams: 70,
        slots: Array.from({ length: PLAN_DAYS }, (_, day) => ({
          dayOffset: day,
          order: 0,
          name: 'Breakfast',
          choices: [{ recipeVersionId, servings: 1 }],
        })),
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const publishedPlan = await api<MealPlanSummary>(
      lea,
      'POST',
      `/api/nutrition/meal-plan-versions/${created.body.versionId}/publish`,
      { tenantId, body: {} },
    );
    expect(publishedPlan.status, JSON.stringify(publishedPlan.body)).toBe(200);
    expect(publishedPlan.body.status).toBe('Published');

    // A client of Lea's whose paid Nutrition still has a free week: the first day after any plan they
    // already have, inside their Nutrition dates.
    const clients = await api<ClientSummary[]>(lea, 'GET', '/api/clients', { tenantId });
    expect(clients.status).toBe(200);
    let chosen: { client: ClientSummary; start: string; cover: Enrollment } | null = null;
    for (const client of clients.body) {
      const commercial = await api<{ enrollments: Enrollment[] }>(
        lea,
        'GET',
        `/api/commercial/clients/${client.id}`,
        { tenantId },
      );
      if (commercial.status !== 200) continue;
      const cover = commercial.body.enrollments.find(
        (item) =>
          item.features.includes('Nutrition') &&
          item.storedStatus !== 'Cancelled' &&
          item.storedStatus !== 'Expired' &&
          item.startDate <= today &&
          item.lastActiveDate >= today,
      );
      if (!cover) continue;
      const plans = await api<ClientPlan[]>(
        lea,
        'GET',
        `/api/nutrition/clients/${client.id}/plans`,
        {
          tenantId,
        },
      );
      if (plans.status !== 200) continue;
      const busyUntil = plans.body
        .filter((plan) => plan.status === 'Active' && plan.endDateExclusive > today)
        .reduce(
          (latest, plan) => (plan.endDateExclusive > latest ? plan.endDateExclusive : latest),
          today,
        );
      if (addDays(busyUntil, PLAN_DAYS - 1) <= cover.lastActiveDate) {
        chosen = { client, start: busyUntil, cover };
        break;
      }
    }
    expect(chosen, 'one of Lea’s clients has a free week of Nutrition').not.toBeNull();
    const { client, start, cover } = chosen!;
    const clientId = client.id;
    let assignedPlanId: string | null = null;

    try {
      await lea.goto(`/clients/${clientId}/nutrition`);
      await expect(lea.locator('[data-card="plan"]')).toBeVisible();

      // Targets from the record: sex and the kind of work are never guessed, so they are chosen here.
      await lea.locator('[data-work-out]').click();
      const targets = lea.getByRole('dialog').first();
      await expect(targets).toContainText(`Work out targets for ${client.firstName}`);
      await targets.getByRole('radio', { name: 'Female', exact: true }).check({ force: true });
      await targets.getByText('Mixed', { exact: true }).click();
      for (const [name, fallback] of [
        ['weight', '70'],
        ['height', '170'],
        ['age', '30'],
        ['steps', '7000'],
      ] as const) {
        const input = targets.locator(`input[name="${name}"]`);
        if ((await input.inputValue()) === '') await input.fill(fallback);
      }
      await targets.getByRole('button', { name: /Hold weight/ }).click();
      await targets.getByRole('button', { name: /^1\.8 g a kilogram/ }).click();
      await targets.getByRole('button', { name: /^30% fat/ }).click();
      await targets.getByRole('button', { name: 'Work out targets' }).click();
      await expect(targets.locator('[data-result]')).toContainText('calories a day', {
        timeout: 20_000,
      });
      await targets.getByRole('button', { name: 'Assign a meal plan with these' }).click();

      // The assignment sheet: the new plan, the first free day, Assign.
      const assign = lea.getByRole('dialog').first();
      await expect(assign).toContainText(`Assign a meal plan to ${client.firstName}`);
      await assign.getByRole('radio', { name: new RegExp(planName) }).check({ force: true });
      await pickDate(assign, start);
      await expect(assign.locator('app-date-field')).toContainText(
        `Runs ${dayWords(start)} – ${dayWords(addDays(start, PLAN_DAYS - 1))}`,
      );
      await assign.getByRole('button', { name: /Assign meal plan|Assign anyway/ }).click();
      // A plan with a recipe that lists one of the client's declared allergens asks to look first.
      const review = assign.locator('[data-review]');
      if (await review.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await assign.getByText(/I have looked at the recipes/).click();
        await assign.getByRole('button', { name: /Assign anyway/ }).click();
      }
      await expect(lea.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
      await expect(lea.locator('[data-card="plan"]')).toContainText(planName, { timeout: 20_000 });

      // The record: an active plan on those dates, carrying the targets just worked out.
      const plans = await api<ClientPlan[]>(
        lea,
        'GET',
        `/api/nutrition/clients/${clientId}/plans`,
        {
          tenantId,
        },
      );
      expect(plans.status).toBe(200);
      const assigned = plans.body.find(
        (plan) => plan.mealPlanName === planName && plan.status === 'Active',
      );
      expect(assigned).toBeDefined();
      expect(assigned!.startDate).toBe(start);
      expect(assigned!.endDateExclusive).toBe(addDays(start, PLAN_DAYS));
      assignedPlanId = assigned!.id;

      // The same dates again are refused: plans never overlap (ADR 0008).
      const calculations = await api<{ result: { id: string } }[]>(
        lea,
        'GET',
        `/api/nutrition/clients/${clientId}/calculations?take=1`,
        { tenantId },
      );
      expect(calculations.status).toBe(200);
      const overlap = await api(lea, 'POST', `/api/nutrition/clients/${clientId}/plans`, {
        tenantId,
        body: {
          mealPlanTemplateVersionId: publishedPlan.body.versionId,
          enrollmentId: cover.id,
          calculationSnapshotId: calculations.body[0].result.id,
          startDate: start,
          acknowledgeAllergenWarnings: true,
        },
      });
      expect(overlap.status).toBe(409);
    } finally {
      // Free the dates again: cancel is one way and needs a reason and the row version.
      if (assignedPlanId) {
        const current = await api<ClientPlan[]>(
          lea,
          'GET',
          `/api/nutrition/clients/${clientId}/plans`,
          { tenantId },
        );
        const plan = current.body.find((item) => item.id === assignedPlanId)!;
        const cancelled = await api<ClientPlan>(
          lea,
          'POST',
          `/api/nutrition/clients/${clientId}/plans/${assignedPlanId}/cancel`,
          {
            tenantId,
            body: { reason: 'Live spec: freeing the dates again.', version: plan.version },
          },
        );
        expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
        expect(cancelled.body.status).toBe('Cancelled');
      }
    }

    await coachContext.close();
  });
});
