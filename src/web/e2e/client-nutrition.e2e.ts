import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  allergens,
  calculationRecord,
  calculationView,
  clientPlan,
  CLIENT_ID,
  earlierRecord,
  profile,
  publishedPlans,
  workspace,
} from '../src/testing/client-nutrition-fixtures';
import { profileOverview } from '../src/testing/client-profile-fixtures';
import { enrollment, plansOverview } from '../src/testing/client-service-fixtures';
import { mayaWeighIns, progressView } from '../src/testing/progress-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * A client's Nutrition tab (R5.3d) in a real browser: Karim, owner of Atlas Performance, on Sat 10 Oct
 * 2026 reading Rana Haddad's record. Every read the page makes is answered, so the console guard stays
 * meaningful, and the writes are recorded so each sheet is held to the request it sends.
 */
const owner = { ...SIGNED_IN_USER, displayName: 'Karim Haddad' };
const BASE = `/api/nutrition/clients/${CLIENT_ID}`;

interface Writes {
  calculations: unknown[];
  allergens: unknown[];
  assignments: unknown[];
}

interface Options {
  calculations?: ReturnType<typeof calculationRecord>[];
  plans?: ReturnType<typeof clientPlan>[];
  declared?: ReturnType<typeof allergens>;
  featureClosed?: boolean;
  details?: Record<string, unknown>;
}

async function openNutrition(page: Page, width: number, height: number, options: Options = {}) {
  await page.clock.setFixedTime(new Date('2026-10-10T09:00:00Z'));
  await page.setViewportSize({ width, height });
  const writes: Writes = { calculations: [], allergens: [], assignments: [] };
  let calculations = options.calculations ?? [calculationRecord(), earlierRecord()];
  let plans = options.plans ?? [clientPlan()];
  let declared = options.declared ?? allergens('Peanuts', 'Milk');
  const covered = plansOverview(
    [enrollment({ endDateExclusive: '2026-10-29', lastActiveDate: '2026-10-28' })],
    options.featureClosed
      ? {
          featureAccess: [
            {
              feature: 'Nutrition',
              isAllowed: false,
              reason: 'Paused',
              enrollmentId: 'e-1',
              accessibleFrom: '2026-07-21',
              accessibleUntilExclusive: '2026-10-29',
            },
          ],
        }
      : {},
  );
  const reads: Record<string, (route: Route) => unknown> = {
    [`GET /api/clients/${CLIENT_ID}`]: (route) =>
      json(route, 200, { ...profile(), ...options.details }),
    [`GET /api/commercial/clients/${CLIENT_ID}`]: (route) => json(route, 200, covered),
    'GET /api/workspace': (route) => json(route, 200, workspace()),
    [`GET /api/clients/${CLIENT_ID}/overview`]: (route) => json(route, 200, profileOverview()),
    [`GET ${BASE}/allergens`]: (route) => json(route, 200, declared),
    [`PUT ${BASE}/allergens`]: (route) => {
      const body = route.request().postDataJSON() as { codes: typeof declared.codes };
      writes.allergens.push(body);
      declared = allergens(...body.codes);
      return route.fulfill({ status: 200, body: '' });
    },
    [`GET ${BASE}/calculations`]: (route) => json(route, 200, calculations),
    [`POST ${BASE}/calculations`]: (route) => {
      writes.calculations.push(route.request().postDataJSON());
      const made = calculationView({ id: 'calc-3', calorieTarget: 2154.8 });
      calculations = [
        calculationRecord({ result: made, calculatedAtUtc: '2026-10-10T09:00:00Z' }),
        ...calculations,
      ];
      return json(route, 200, made);
    },
    [`GET ${BASE}/plans`]: (route) => json(route, 200, plans),
    [`POST ${BASE}/plans`]: (route) => {
      const body = route.request().postDataJSON() as { startDate: string };
      writes.assignments.push(body);
      const made = clientPlan({
        id: 'cplan-2',
        startDate: body.startDate,
        endDateExclusive: '2026-10-24',
        calculationSnapshotId: 'calc-3',
      });
      plans = [made, ...plans];
      return json(route, 200, made);
    },
    'GET /api/nutrition/meal-plans': (route) =>
      json(route, 200, { total: 3, skip: 0, take: 100, items: publishedPlans() }),
    [`GET /api/progress/clients/${CLIENT_ID}`]: (route) =>
      json(route, 200, progressView(mayaWeighIns())),
  };
  await mockSession(page, { memberships: [OWNER_MEMBERSHIP], user: owner, extra: reads });
  await page.goto(`/clients/${CLIENT_ID}/nutrition`);
  await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad' })).toBeVisible();
  await expect(
    page.locator('[data-card="targets"], [data-closed], [data-error]').first(),
  ).toBeVisible();
  await waitForFonts(page);
  return writes;
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

const toast = (page: Page) => page.locator('app-toast-host');

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the Nutrition tab shows targets, the plan and the allergens at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openNutrition(page, width, height);

    await expect(page).toHaveTitle('Client nutrition | TB Gym');
    await expect(page.locator('[data-card="targets"] .calories')).toHaveText(
      '2,155 calories a day',
    );
    await expect(page.locator('[data-current-plan] .plan-name')).toHaveText('Spring cut');
    await expect(page.locator('[data-declared] .chip')).toHaveText(['Peanuts', 'Milk']);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `../../docs/design/r53d-nutrition-${width}.png`,
      fullPage: true,
    });
  });

  test(`the Nutrition tab follows dark mode at ${width}px and passes axe`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openNutrition(page, width, height);

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `../../docs/design/r53d-nutrition-dark-${width}.png`,
      fullPage: true,
    });
  });
}

test('an empty Nutrition tab invites the first targets and says what is missing', async ({
  page,
}) => {
  await openNutrition(page, 390, 844, {
    calculations: [],
    plans: [],
    declared: allergens(),
  });

  await expect(page.locator('[data-no-targets]')).toContainText(
    'No targets have been worked out for Rana yet.',
  );
  await expect(page.locator('[data-no-plan]')).toContainText(
    'Rana has no meal plan running or coming.',
  );
  await expect(page.locator('[data-none-declared]')).toHaveText('None declared for Rana.');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: '../../docs/design/r53d-nutrition-empty-390.png', fullPage: true });
});

test('a closed Nutrition tab says why, in the page, and asks nothing of the server', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/nutrition/clients/')) asked.push(url.pathname);
  });
  await openNutrition(page, 390, 844, { featureClosed: true });

  await expect(page.locator('[data-closed]')).toHaveText(
    'Rana’s plan is paused, so their nutrition isn’t shown.',
  );
  expect(asked).toEqual([]);
  await axe(page);
});

test('a right-to-left page keeps every card inside the screen', async ({ page }) => {
  await useRtl(page);
  await openNutrition(page, 390, 844);
  await expectNoHorizontalOverflow(page);
});

test('works targets out for the coach, from what the record knows, and sends exactly what was chosen', async ({
  page,
}) => {
  const writes = await openNutrition(page, 390, 844);

  await page.locator('[data-work-out]').click();
  const sheet = page.getByRole('dialog', { name: 'Work out targets for Rana' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Weight (kg)')).toHaveValue('80.2');
  await expect(sheet.getByLabel('Height (cm)')).toHaveValue('168');
  await expect(sheet.getByLabel('Age (years)')).toHaveValue('30');
  await expect(sheet.getByLabel('Steps a day, on average')).toHaveValue('8000');
  // Last time's choices carry over; today's facts come from the record.
  await expect(sheet.getByRole('radio', { name: 'Female', exact: true })).toBeChecked();
  await expect(sheet.locator('input[name="work"][value="Seated"]')).toBeChecked();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../docs/design/r53d-calculator-390.png' });
  await axe(page);

  await sheet.getByRole('button', { name: 'Lose faster −500' }).click();
  await sheet.getByRole('button', { name: '2.2 g a kilogram' }).click();
  await expect(sheet.getByLabel('Protein (grams a day)')).toHaveValue('176');
  await sheet.getByRole('button', { name: 'Work out targets' }).click();

  await expect(sheet.locator('[data-result]')).toContainText('2,155 calories a day');
  expect(writes.calculations).toEqual([
    {
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 80.2,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      coachGoalAdjustment: -500,
      calorieTarget: null,
      proteinGrams: 176,
      fatPercentage: 25,
      isEnergyDeficit: true,
    },
  ]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '../../docs/design/r53d-result-390.png' });
  await axe(page);
});

test('goes from new targets straight to assigning a meal plan with them', async ({ page }) => {
  const writes = await openNutrition(page, 1440, 900, { plans: [] });

  await page.locator('[data-work-out]').click();
  const sheet = page.getByRole('dialog', { name: 'Work out targets for Rana' });
  await sheet.getByRole('button', { name: 'Work out targets' }).click();
  await sheet.getByRole('button', { name: 'Assign a meal plan with these' }).click();

  const assign = page.getByRole('dialog', { name: 'Assign a meal plan to Rana' });
  await expect(assign).toBeVisible();
  await expect(assign.locator('[data-targets]')).toContainText('2,155 calories a day');
  await assign.locator('label.choice', { hasText: 'Spring cut' }).click();
  await expect(assign).toContainText('Runs Sat 10 Oct – Fri 23 Oct');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '../../docs/design/r53d-assign-1440.png' });
  await axe(page);

  await assign.getByRole('button', { name: 'Assign meal plan' }).click();
  await expect(toast(page)).toContainText('Spring cut assigned from Sat 10 Oct.');
  expect(writes.assignments).toEqual([
    {
      mealPlanTemplateVersionId: 'plan-v5',
      enrollmentId: 'e-1',
      calculationSnapshotId: 'calc-3',
      startDate: '2026-10-10',
      acknowledgeAllergenWarnings: false,
    },
  ]);
  await expect(page.locator('[data-current-plan] .plan-name')).toHaveText('Spring cut');
});

test('edits the declared allergens in a sheet that opens with what is declared now', async ({
  page,
}) => {
  const writes = await openNutrition(page, 390, 844);

  await page.locator('[data-edit-allergens]').click();
  const sheet = page.getByRole('dialog', { name: 'Allergens for Rana' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-theirs]')).toContainText('Peanuts');
  await expect(sheet.getByLabel('Peanuts', { exact: true })).toBeChecked();
  await expect(sheet.getByLabel('Milk', { exact: true })).toBeChecked();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../docs/design/r53d-allergens-390.png' });
  await axe(page);

  await sheet.getByLabel('Milk', { exact: true }).uncheck();
  await sheet.getByLabel('Sesame', { exact: true }).check();
  await sheet.getByRole('button', { name: 'Save allergens' }).click();

  await expect(toast(page)).toContainText('Allergens saved for Rana.');
  expect(writes.allergens).toEqual([{ codes: ['Peanuts', 'Sesame'] }]);
  await expect(page.locator('[data-declared] .chip')).toHaveText(['Peanuts', 'Sesame']);
});
