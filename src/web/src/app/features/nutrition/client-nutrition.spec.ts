import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, fill, press, query, settle, tick } from '../../../testing/dom';
import { ClientNutrition } from './client-nutrition';
import type {
  ClientNutritionPlan,
  MealPlanSummary,
  NutritionCalculation,
} from './nutrition.models';

const PUBLISHED_PLAN: MealPlanSummary = {
  id: 'plan-1',
  versionId: 'plan-version-1',
  revision: 1,
  name: 'Balanced 2400',
  dayCount: 7,
  status: 'Published',
  targetCalories: 2400,
  slotCount: 4,
};

const DRAFT_PLAN: MealPlanSummary = {
  ...PUBLISHED_PLAN,
  id: 'plan-2',
  versionId: 'plan-version-2',
  name: 'Work in progress',
  status: 'Draft',
};

const CALCULATION: NutritionCalculation = {
  id: 'calculation-1',
  bmrMethodKey: 'MifflinStJeor',
  bmrEstimate: 1620,
  activityModelPal: 1.45,
  tdeeEstimate: 2349,
  coachGoalAdjustment: -300,
  calorieTarget: 2049,
  protein: 150,
  carbohydrate: 200,
  fat: 57,
  warnings: [],
};

const ASSIGNMENT: ClientNutritionPlan = {
  id: 'client-plan-1',
  sourceMealPlanTemplateVersionId: 'plan-version-1',
  enrollmentId: 'enrollment-1',
  startDate: '2026-09-01',
  endDateExclusive: '2026-09-08',
  calorieTarget: 2049,
};

/** An enrollment covering Nutrition, and one that does not, so the picker has to choose. */
function commercialOverview() {
  return {
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: [],
    enrollments: [
      { id: 'enrollment-1', features: ['Nutrition', 'Training'] },
      { id: 'enrollment-2', features: ['Training'] },
    ],
  };
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [ClientNutrition],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          listMealPlans: vi.fn(() => of({ total: 2, items: [PUBLISHED_PLAN, DRAFT_PLAN] })),
          listClientNutritionPlans: vi.fn(() => of([])),
          getClientCommercialOverview: vi.fn(() => of(commercialOverview())),
          calculateNutritionTargets: vi.fn(() => of(CALCULATION)),
          replaceClientAllergens: vi.fn(() => of(undefined)),
          assignNutritionPlan: vi.fn(() => of(undefined)),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientNutrition);
  fixture.componentRef.setInput('clientId', 'client-1');
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('ClientNutrition', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The calculation is snapshotted and later referenced by the assignment, so the inputs the coach
   * typed have to be the ones that reach the formula. A control that never writes back would
   * silently snapshot the component's defaults under the coach's name.
   */
  it('calculates targets from the values the coach entered', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'BMR strategy', 'MifflinStJeor');
    fill(host, 'Weight (kg)', '72.4');
    fill(host, 'Height (cm)', '168');
    fill(host, 'Age', '29');
    fill(host, 'Formula sex', 'Female');
    fill(host, 'Occupation', 'Mixed');
    fill(host, 'Average daily steps', '9000');
    fill(host, 'Coach goal adjustment (kcal)', '-250');
    fill(host, 'Protein (g)', '145');
    fill(host, 'Fat percentage (%)', '28');
    await settle(fixture);

    press(host, 'Calculate and snapshot');
    await settle(fixture);

    expect(api.calculateNutritionTargets).toHaveBeenCalledWith('client-1', {
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 72.4,
      heightCentimeters: 168,
      ageYears: 29,
      sex: 'Female',
      // Body fat only belongs to the strategy that uses it.
      bodyFatPercentage: null,
      occupationType: 'Mixed',
      averageDailySteps: 9000,
      coachGoalAdjustment: -250,
      calorieTarget: null,
      proteinGrams: 145,
      fatPercentage: 28,
      isEnergyDeficit: true,
    });
    // The calculation is shown with its provenance, not just a number.
    expect(host.textContent).toContain('Calorie target: 2,049 kcal/day');
    expect(host.textContent).toContain('TDEE estimate');
  });

  /** Katch-McArdle is the only strategy that takes body fat, so it is the only one that asks. */
  it('asks for body fat only for the strategy that uses it', async () => {
    const { fixture, host, api } = await render();

    expect(() => field(host, 'Body fat (%)')).toThrow();

    fill(host, 'BMR strategy', 'KatchMcArdle');
    await settle(fixture);
    fill(host, 'Body fat (%)', '22.5');
    await settle(fixture);
    press(host, 'Calculate and snapshot');
    await settle(fixture);

    expect(api.calculateNutritionTargets).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ bmrMethodKey: 'KatchMcArdle', bodyFatPercentage: 22.5 }),
    );
  });

  /**
   * The assignment creates an immutable client snapshot, so every identifier it carries has to be
   * the one the coach picked: the plan version, the nutrition-covering enrollment, and the
   * calculation the targets came from.
   */
  it('assigns the snapshot the coach chose, against the calculation just made', async () => {
    const { fixture, host, api } = await render({
      listClientNutritionPlans: vi
        .fn()
        .mockReturnValueOnce(of([]))
        .mockReturnValueOnce(of([ASSIGNMENT])),
    });

    press(host, 'Calculate and snapshot');
    await settle(fixture);

    fill(host, 'Published plan', 'plan-version-1');
    fill(host, 'Nutrition enrollment', 'enrollment-1');
    fill(host, 'Start date', '2026-09-01');
    tick(
      host,
      'I reviewed any declared allergen conflicts. I understand TB Gym does not assert this plan is safe.',
    );
    await settle(fixture);

    press(host, 'Assign immutable snapshot');
    await settle(fixture);

    expect(api.assignNutritionPlan).toHaveBeenCalledWith('client-1', {
      mealPlanTemplateVersionId: 'plan-version-1',
      enrollmentId: 'enrollment-1',
      calculationSnapshotId: 'calculation-1',
      startDate: '2026-09-01',
      acknowledgeAllergenWarnings: true,
    });
    expect(host.textContent).toContain('Client nutrition snapshot assigned.');
    expect(host.textContent).toContain('2026-09-01');
  });

  /** Nothing may be assigned against a calculation that was never made. */
  it('refuses to assign before any calculation exists', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Published plan', 'plan-version-1');
    fill(host, 'Start date', '2026-09-01');
    await settle(fixture);
    press(host, 'Assign immutable snapshot');
    await settle(fixture);

    expect(api.assignNutritionPlan).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Choose a published plan, nutrition enrollment, start date, and calculation snapshot.',
    );
  });

  it('refuses to assign with no start date', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Calculate and snapshot');
    await settle(fixture);
    fill(host, 'Published plan', 'plan-version-1');
    await settle(fixture);
    press(host, 'Assign immutable snapshot');
    await settle(fixture);

    expect(api.assignNutritionPlan).not.toHaveBeenCalled();
  });

  /** A draft plan is not assignable, so it is never offered as one. */
  it('offers only published meal plans', async () => {
    const { host } = await render();

    const options = Array.from(field<HTMLSelectElement>(host, 'Published plan').options).map(
      (option) => option.value,
    );
    expect(options).toEqual(['', 'plan-version-1']);
  });

  /** Only an enrollment that actually covers Nutrition can authorize a nutrition plan. */
  it('offers only enrollments that cover nutrition', async () => {
    const { host } = await render();

    const options = Array.from(field<HTMLSelectElement>(host, 'Nutrition enrollment').options).map(
      (option) => option.value,
    );
    expect(options).toEqual(['', 'enrollment-1']);
  });

  it('saves the allergen declarations that were ticked', async () => {
    const { fixture, host, api } = await render();

    tick(host, 'Peanuts');
    tick(host, 'Milk');
    await settle(fixture);
    press(host, 'Save declarations');
    await settle(fixture);

    expect(api.replaceClientAllergens).toHaveBeenCalledWith('client-1', ['Peanuts', 'Milk']);
    expect(host.textContent).toContain('Structured allergen declarations saved.');
  });

  it('removes a declaration that was unticked rather than keeping it', async () => {
    const { fixture, host, api } = await render();

    tick(host, 'Peanuts');
    tick(host, 'Milk');
    tick(host, 'Peanuts', false);
    await settle(fixture);
    press(host, 'Save declarations');
    await settle(fixture);

    expect(api.replaceClientAllergens).toHaveBeenCalledWith('client-1', ['Milk']);
  });

  it('shows every calculation warning rather than only the target', async () => {
    const { fixture, host } = await render({
      calculateNutritionTargets: vi.fn(() =>
        of({ ...CALCULATION, warnings: ['Protein exceeds the deficit ceiling.'] }),
      ),
    });

    press(host, 'Calculate and snapshot');
    await settle(fixture);

    expect(host.textContent).toContain('Protein exceeds the deficit ceiling.');
  });

  it('reports a rejected assignment instead of listing a snapshot that does not exist', async () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { title: 'That enrollment does not cover nutrition for this date.' },
    });
    const { fixture, host } = await render({
      assignNutritionPlan: vi.fn(() => throwError(() => refused)),
    });

    press(host, 'Calculate and snapshot');
    await settle(fixture);
    fill(host, 'Published plan', 'plan-version-1');
    fill(host, 'Nutrition enrollment', 'enrollment-1');
    fill(host, 'Start date', '2026-09-01');
    await settle(fixture);
    press(host, 'Assign immutable snapshot');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'That enrollment does not cover nutrition for this date.',
    );
    expect(host.textContent).not.toContain('Client nutrition snapshot assigned.');
  });

  it('reports a failed load rather than an empty plan picker', async () => {
    const { host } = await render({
      listMealPlans: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Client nutrition could not be loaded.',
    );
  });
});
