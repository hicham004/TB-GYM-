import type {
  ClientAllergensView,
  ClientNutritionPlanSummary,
  CoachClientProgramView,
  EnergyModelView,
  EnergyPreviewView,
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
 * below that, 140 g of protein and 25 % of calories from fat. A6 adds the coach's own macros over them
 * and a plan the coach stopped.
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

/**
 * The coach's own macros over the latest calculation, set on Sat 10 Oct (INV-2): 150 g protein,
 * 230 g carbs and 60 g fat make 2,060 calories, 394.8 under the same TDEE.
 */
export function adjustedRecord(
  overrides: Partial<NutritionCalculationRecord> = {},
): NutritionCalculationRecord {
  return calculationRecord({
    result: calculationView({
      id: 'calc-3',
      coachGoalAdjustment: -394.8,
      calorieTarget: 2060,
      proteinGrams: 150,
      carbohydrateGrams: 230,
      fatGrams: 60,
    }),
    calculatedAtUtc: '2026-10-10T07:15:00Z',
    adjustment: {
      overrideId: 'override-1',
      reason: 'More protein while she cuts',
      adjustedAtUtc: '2026-10-10T07:15:00Z',
      adjustedFromCalculationId: 'calc-2',
      fromCalorieTarget: 2154.8,
      fromProteinGrams: 140,
      fromCarbohydrateGrams: 264.025,
      fromFatGrams: 59.855556,
    },
    ...overrides,
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

/** A plan the coach stopped on Sun 4 Oct, the day after it began, and why (NCM-1). */
export function stoppedPlan(
  overrides: Partial<ClientNutritionPlanSummary> = {},
): ClientNutritionPlanSummary {
  return clientPlan({
    id: 'cplan-0',
    startDate: '2026-10-03',
    endDateExclusive: '2026-10-10',
    status: 'Cancelled',
    version: 2,
    mealPlanName: 'Lean bulk',
    stoppedAtUtc: '2026-10-04T06:00:00Z',
    stopReason: 'Assigned to the wrong client',
    ...overrides,
  });
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

// ------------------------------------------------------------------------------------------------
// Energy version 2 (critique B8a, B8b)
// ------------------------------------------------------------------------------------------------

/** What the server says the model in force takes: version 1 everywhere until B8c, version 2 in development. */
export function energyModelView(version: 1 | 2 = 1): EnergyModelView {
  return version === 1
    ? {
        version: 1,
        activityModelKey: 'OccupationStepsPal',
        activityModelVersion: '1.0',
        kindsOfWork: ['Seated', 'Mixed', 'Physical'],
        maximumWorkoutsPerWeek: null,
        coachChosen: null,
      }
    : {
        version: 2,
        activityModelKey: 'OccupationStepsPal',
        activityModelVersion: '2.0',
        kindsOfWork: ['Seated', 'Mixed', 'OnTheirFeet', 'HeavyManual'],
        maximumWorkoutsPerWeek: 7,
        coachChosen: {
          methodKey: 'CoachChosenPal',
          methodVersion: '1.0',
          minimum: 1.4,
          maximum: 2.4,
          picks: [
            { pal: 1.4, words: 'little movement, no exercise' },
            { pal: 1.55, words: 'moderate exercise 3 to 5 days a week' },
            { pal: 1.725, words: 'hard exercise 6 to 7 days a week' },
            { pal: 1.9, words: 'very hard training daily or heavy manual work' },
            { pal: 2.2, words: 'heavy manual work and hard training most days' },
            { pal: 2.4, words: 'heavy manual work all day and training every day' },
          ],
        },
      };
}

/** Rana at her desk with 8,000 steps and four workouts a week, under version 2: × 1.63. */
export const RANA_WORDS = {
  activity:
    'Counts as somewhat active: × 1.63 (seated work with 8,000 steps a day × 1.55, plus 4 workouts a week + 0.08)',
  walking: 'Their 8,000 steps are inside that, worth about 210 calories a day at 70 kg.',
  goal: '−300 a day ≈ 0.3 kg a week, 87% of what they burn',
} as const;

/** The same targets worked out by version 2 on Sat 10 Oct: 1,444 × 1.63 = 2,353.72, then 300 below. */
export function versionTwoRecord(
  overrides: Partial<NutritionCalculationRecord> = {},
): NutritionCalculationRecord {
  return calculationRecord({
    result: calculationView({
      id: 'calc-4',
      activityModelVersion: '2.0',
      activityModelPal: 1.63,
      tdeeEstimate: 2353.72,
      calorieTarget: 2053.72,
      carbohydrateGrams: 239.257,
      fatGrams: 57.047778,
      activity: {
        methodKey: 'OccupationStepsPal',
        methodVersion: '2.0',
        pal: 1.63,
        words: RANA_WORDS.activity,
        occupationType: 'Seated',
        averageDailySteps: 8000,
        stepsBand: 'SomewhatActive',
        stepsBandName: 'somewhat active',
        workoutsPerWeek: 4,
        tableValue: 1.55,
        workoutTerm: 0.08,
        chosenWords: null,
        reason: null,
      },
      walking: {
        averageDailySteps: 8000,
        weightKilograms: 70,
        kilocalories: 210,
        words: RANA_WORDS.walking,
        methodKey: 'WalkingCost',
        methodVersion: '1.0',
      },
      goal: {
        goalAdjustment: -300,
        kilogramsPerWeek: -0.3,
        shareOfMaintenance: 87,
        words: RANA_WORDS.goal,
        methodKey: 'WeeklyWeightChange',
        methodVersion: '1.0',
      },
    }),
    inputs: {
      ...calculationRecord().inputs!,
      workoutsPerWeek: 4,
      chosenPal: null,
      chosenPalReason: null,
    },
    calculatedAtUtc: '2026-10-10T06:30:00Z',
    ...overrides,
  });
}

/**
 * What the preview answers for Rana's sheet under version 2: what she burns, 2,353.72 a day, and each
 * goal pick's rate and share.
 */
export function previewView(overrides: Partial<EnergyPreviewView> = {}): EnergyPreviewView {
  const goal = (adjustment: number, perWeek: number, share: number, words: string) => ({
    goalAdjustment: adjustment,
    kilogramsPerWeek: perWeek,
    shareOfMaintenance: share,
    words,
    methodKey: 'WeeklyWeightChange',
    methodVersion: '1.0',
  });
  return {
    activity: versionTwoRecord().result.activity ?? null,
    walking: versionTwoRecord().result.walking ?? null,
    bmrEstimate: 1444,
    tdeeEstimate: 2353.72,
    goals: [
      goal(-500, -0.5, 79, '−500 a day ≈ 0.5 kg a week, 79% of what they burn'),
      goal(-300, -0.3, 87, RANA_WORDS.goal),
      goal(0, 0, 100, '0 a day ≈ no change in weight, 100% of what they burn'),
      goal(250, 0.2, 111, '+250 a day ≈ 0.2 kg a week, 111% of what they burn'),
      goal(400, 0.4, 117, '+400 a day ≈ 0.4 kg a week, 117% of what they burn'),
    ],
    ...overrides,
  };
}

/** Rana's program on Sat 10 Oct: week 2 of a running block, four workouts in it. */
export function programView(
  overrides: Partial<CoachClientProgramView> = {},
): CoachClientProgramView {
  const session = (id: string, date: string) => ({
    sessionId: id,
    name: `Workout ${id}`,
    scheduledDate: date,
    state: null,
    workoutExecutionId: null,
    exerciseCount: 5,
    setCount: 15,
  });
  return {
    isAllowed: true,
    accessReason: 'Allowed',
    localDate: '2026-10-10',
    blocks: [
      {
        id: 'block-1',
        enrollmentId: 'e-1',
        name: 'Lean & Strong',
        startDate: '2026-10-03',
        endDateExclusive: '2026-10-31',
        status: 'Active',
        revealAllWeeks: false,
        isShownEarly: false,
        version: 1,
        weekCount: 4,
        currentWeekNumber: 2,
        sessionCount: 16,
        completedCount: 4,
        missedCount: 0,
        weeks: [
          {
            id: 'week-1',
            weekNumber: 1,
            label: null,
            startDate: '2026-10-03',
            isShared: true,
            isVisible: true,
            unlockDate: '2026-10-03',
            sessions: [
              session('a', '2026-10-03'),
              session('b', '2026-10-04'),
              session('c', '2026-10-06'),
            ],
          },
          {
            id: 'week-2',
            weekNumber: 2,
            label: null,
            startDate: '2026-10-10',
            isShared: true,
            isVisible: true,
            unlockDate: '2026-10-10',
            sessions: [
              session('d', '2026-10-10'),
              session('e', '2026-10-11'),
              session('f', '2026-10-13'),
              session('g', '2026-10-15'),
            ],
          },
        ],
        lifecycle: [],
      },
    ],
    sessionStateRuleKey: 'ClientSessionState',
    sessionStateRuleVersion: 1,
    finishedPrograms: { canSeeFinishedPrograms: true, version: 0 },
    ...overrides,
  };
}
