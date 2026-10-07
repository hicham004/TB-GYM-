import type {
  MealPlanDraftContent,
  MealPlanDraftSaveView,
  MealPlanDraftSummary,
  MealPlanDraftView,
  MealPlanTemplateDetail,
  MealPlanTemplateSummary,
  MealPlanVersionView,
  RecipeSummary,
} from '../app/core/api/generated';

/**
 * A small meal-plan library for the meal-plan builder's specs (C7, R4.4a): three published recipes
 * of one serving each, and a two-day plan made of them, published at version 2.
 */
export function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: 'recipe-oats',
    versionId: 'oats-v1',
    revision: 1,
    name: 'Overnight oats',
    status: 'Published',
    servings: 1,
    calories: 400,
    proteinGrams: 30,
    carbohydrateGrams: 50,
    fatGrams: 9,
    declaredAllergens: ['Milk'],
    ...overrides,
  };
}

export const OATS = recipe();
export const CHICKEN = recipe({
  id: 'recipe-chicken',
  versionId: 'chicken-v1',
  name: 'Chicken & rice',
  calories: 600,
  proteinGrams: 50,
  carbohydrateGrams: 70,
  fatGrams: 12,
  declaredAllergens: [],
});
/** A recipe cooked in a batch of four: its totals are four servings' worth. */
export const LENTILS = recipe({
  id: 'recipe-lentils',
  versionId: 'lentils-v1',
  name: 'Lentil soup',
  servings: 4,
  calories: 1200,
  proteinGrams: 72,
  carbohydrateGrams: 160,
  fatGrams: 24,
  declaredAllergens: [],
});
export const RECIPES = [CHICKEN, LENTILS, OATS];

export function planDetail(
  overrides: Partial<MealPlanTemplateDetail> = {},
): MealPlanTemplateDetail {
  return {
    id: 'plan-1',
    name: 'Lean bulk',
    currentRevision: 2,
    versions: [
      {
        id: 'plan-v2',
        revision: 2,
        status: 'Published',
        createdAtUtc: '2026-10-05T09:00:00Z',
        publishedAtUtc: '2026-10-05T09:00:00Z',
        dayCount: 2,
        targetCalories: 2000,
        slotCount: 3,
      },
      {
        id: 'plan-v1',
        revision: 1,
        status: 'Published',
        createdAtUtc: '2026-10-01T09:00:00Z',
        publishedAtUtc: '2026-10-01T09:00:00Z',
        dayCount: 1,
        targetCalories: 1800,
        slotCount: 2,
      },
    ],
    draft: null,
    ...overrides,
  };
}

/**
 * Day 1: Breakfast (oats) and Lunch (chicken, or two servings of lentil soup); day 2: Breakfast
 * (oats, one and a half servings). Targets 2,000 kcal, 150 g protein, 200 g carbs, 67 g fat.
 */
export function versionView(overrides: Partial<MealPlanVersionView> = {}): MealPlanVersionView {
  return {
    id: 'plan-v2',
    mealPlanTemplateId: 'plan-1',
    revision: 2,
    status: 'Published',
    dayCount: 2,
    targetCalories: 2000,
    targetProteinGrams: 150,
    targetCarbohydrateGrams: 200,
    targetFatGrams: 67,
    slots: [
      {
        dayOffset: 1,
        order: 0,
        name: 'Breakfast',
        choices: [
          {
            recipeVersionId: 'oats-v1',
            recipeName: 'Overnight oats',
            servings: 1.5,
            calories: 600,
            proteinGrams: 45,
            carbohydrateGrams: 75,
            fatGrams: 13.5,
          },
        ],
      },
      {
        dayOffset: 0,
        order: 1,
        name: 'Lunch',
        choices: [
          {
            recipeVersionId: 'chicken-v1',
            recipeName: 'Chicken & rice',
            servings: 1,
            calories: 600,
            proteinGrams: 50,
            carbohydrateGrams: 70,
            fatGrams: 12,
          },
          {
            recipeVersionId: 'lentils-v1',
            recipeName: 'Lentil soup',
            servings: 2,
            calories: 600,
            proteinGrams: 36,
            carbohydrateGrams: 80,
            fatGrams: 12,
          },
        ],
      },
      {
        dayOffset: 0,
        order: 0,
        name: 'Breakfast',
        choices: [
          {
            recipeVersionId: 'oats-v1',
            recipeName: 'Overnight oats',
            servings: 1,
            calories: 400,
            proteinGrams: 30,
            carbohydrateGrams: 50,
            fatGrams: 9,
          },
        ],
      },
    ],
    recipes: RECIPES,
    ...overrides,
  };
}

export function draftContent(overrides: Partial<MealPlanDraftContent> = {}): MealPlanDraftContent {
  return {
    name: 'Lean bulk',
    targetCalories: 2100,
    targetProteinGrams: 150,
    targetCarbohydrateGrams: 220,
    targetFatGrams: 67,
    days: [
      {
        meals: [{ name: 'Breakfast', choices: [{ recipeVersionId: 'oats-v1', servings: 2 }] }],
      },
    ],
    ...overrides,
  };
}

export function draftView(overrides: Partial<MealPlanDraftView> = {}): MealPlanDraftView {
  return {
    id: 'draft-1',
    mealPlanTemplateId: 'plan-1',
    sourceVersionId: 'plan-v2',
    startedAtRevision: 2,
    updatedAtUtc: '2026-10-06T08:15:00Z',
    version: 7,
    content: draftContent(),
    recipes: [OATS],
    ...overrides,
  };
}

export function draftSummary(overrides: Partial<MealPlanDraftSummary> = {}): MealPlanDraftSummary {
  return {
    id: 'draft-1',
    mealPlanTemplateId: 'plan-1',
    name: 'Lean bulk',
    dayCount: 1,
    updatedAtUtc: '2026-10-06T08:15:00Z',
    ...overrides,
  };
}

export function saveView(id = 'draft-1', version = 8): MealPlanDraftSaveView {
  return { id, updatedAtUtc: '2026-10-07T09:30:00Z', version };
}

export function planSummary(
  overrides: Partial<MealPlanTemplateSummary> = {},
): MealPlanTemplateSummary {
  return {
    id: 'plan-1',
    versionId: 'plan-v2',
    revision: 2,
    name: 'Lean bulk',
    dayCount: 7,
    status: 'Published',
    targetCalories: 2000,
    slotCount: 28,
    targetProteinGrams: 150,
    targetCarbohydrateGrams: 200,
    targetFatGrams: 67,
    changedAtUtc: '2026-10-05T09:00:00Z',
    draft: null,
    ...overrides,
  };
}
