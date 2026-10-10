import type {
  ClientAllergensView,
  ClientNutritionPlanSummary,
  MealPlanTemplateSummary,
  NutritionCalculationRecord,
  NutritionCalculationView,
} from '../app/core/api/generated';
import type { CoachClientDetails } from '../app/core/api/api.models';
import { coachView, finishedProfile } from './intake-fixtures';
import { planSummary } from './meal-plan-fixtures';

export { NOW, TODAY, workspace } from './intake-fixtures';

/**
 * The coach's Nutrition tab for Rana Haddad (R5.3d), read on Sat 10 Oct 2026 in Asia/Beirut: a
 * 70 kg, 168 cm woman of 30 (born 2 April 1996) with a desk job, steps from her intake, and targets
 * worked out the day before. The numbers are the server's: BMR 1,444, PAL 1.7, TDEE 2,454.8, then 300
 * below that, 140 g of protein and 25 % of calories from fat.
 */

export const CLIENT_ID = 'client-1';

/** What the coach already reads about her: age from the birth date, height and steps from her intake. */
export function profile(overrides: Partial<CoachClientDetails> = {}): CoachClientDetails {
  return { ...coachView(finishedProfile({ averageDailySteps: 8000 })), ...overrides };
}

export function calculationView(
  overrides: Partial<NutritionCalculationView> = {},
): NutritionCalculationView {
  return {
    id: 'calc-2',
    bmrMethodKey: 'MifflinStJeor',
    bmrMethodVersion: '1.0',
    bmrEstimate: 1444,
    activityModelKey: 'OccupationStepsPal',
    activityModelVersion: '1.0',
    activityModelPal: 1.7,
    tdeeMethodKey: 'BmrTimesPal',
    tdeeMethodVersion: '1.0',
    tdeeEstimate: 2454.8,
    coachGoalAdjustment: -300,
    calorieTarget: 2154.8,
    proteinGrams: 140,
    carbohydrateGrams: 264.025,
    fatGrams: 59.855556,
    energyPolicyKey: 'Atwater',
    energyPolicyVersion: '1.0',
    warnings: [],
    ...overrides,
  };
}

export function calculationRecord(
  overrides: Partial<NutritionCalculationRecord> = {},
): NutritionCalculationRecord {
  return {
    result: calculationView(),
    inputs: {
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 70,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      coachGoalAdjustment: -300,
      calorieTarget: null,
      proteinGrams: 140,
      fatPercentage: 25,
      isEnergyDeficit: true,
    },
    calculatedAtUtc: '2026-10-09T08:30:00Z',
    ...overrides,
  };
}

/** The one before it: heavier, holding weight. */
export function earlierRecord(): NutritionCalculationRecord {
  return calculationRecord({
    result: calculationView({
      id: 'calc-1',
      bmrEstimate: 1489,
      tdeeEstimate: 2531.3,
      coachGoalAdjustment: 0,
      calorieTarget: 2531.3,
      proteinGrams: 120,
      carbohydrateGrams: 354.619,
      fatGrams: 70.313889,
    }),
    inputs: {
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 75,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      coachGoalAdjustment: 0,
      calorieTarget: null,
      proteinGrams: 120,
      fatPercentage: 25,
      isEnergyDeficit: false,
    },
    calculatedAtUtc: '2026-09-20T09:00:00Z',
  });
}

/** Spring cut, 14 days from Mon 5 Oct, assigned with the calculation above. */
export function clientPlan(
  overrides: Partial<ClientNutritionPlanSummary> = {},
): ClientNutritionPlanSummary {
  return {
    id: 'cplan-1',
    sourceMealPlanTemplateVersionId: 'plan-v2',
    enrollmentId: 'e-1',
    startDate: '2026-10-05',
    endDateExclusive: '2026-10-19',
    calorieTarget: 2154.8,
    status: 'Active',
    version: 1,
    mealPlanName: 'Spring cut',
    proteinGrams: 140,
    carbohydrateGrams: 264.025,
    fatGrams: 59.855556,
    calculationSnapshotId: 'calc-2',
    ...overrides,
  };
}

export function allergens(...codes: ClientAllergensView['codes']): ClientAllergensView {
  return { codes: [...codes] };
}

/** The plans a coach may assign: the library's published ones. */
export function publishedPlans(): MealPlanTemplateSummary[] {
  return [
    planSummary({ id: 'plan-1', versionId: 'plan-v2', name: 'Lean bulk', dayCount: 7 }),
    planSummary({
      id: 'plan-2',
      versionId: 'plan-v5',
      name: 'Spring cut',
      dayCount: 14,
      targetCalories: 2100,
    }),
    planSummary({ id: 'plan-3', versionId: 'plan-v1', name: 'Draft only', status: 'Draft' }),
  ];
}
