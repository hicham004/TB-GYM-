import type {
  FoodItemView,
  RecipeDetail,
  RecipeIngredientView,
  RecipeSummary,
} from '../app/core/api/generated';

/**
 * Recipes for the recipe pages' specs (C7, R4.4b): a published two-serving overnight oats with a
 * photo, its ingredient lines, and foods as the search returns them.
 */
export function food(
  overrides: Partial<FoodItemView> & { versionOverrides?: object } = {},
): FoodItemView {
  const { versionOverrides, ...rest } = overrides;
  return {
    id: 'food-oats',
    name: 'Rolled oats',
    provenance: 'CoachAuthored',
    externalId: null,
    externalDataType: null,
    currentRevision: 1,
    currentVersion: {
      id: 'oats-food-v1',
      revision: 1,
      basisQuantity: 100,
      basisUnit: 'Gram',
      preparationBasis: 'AsSold',
      computedCalories: 380,
      providerCalories: null,
      hasCalorieDiscrepancy: false,
      proteinGrams: 13,
      carbohydrateGrams: 68,
      fatGrams: 7,
      fibreGrams: 10,
      polyolGrams: 0,
      ethanolGrams: 0,
      energyPolicyKey: 'Atwater',
      energyPolicyVersion: '1',
      sourceAttribution: 'Coach-authored food',
      sourceRecordVersion: 'coach-entry-v1',
      declaredAllergens: ['GlutenCereals'],
      unreportedNutrients: [],
      ...versionOverrides,
    },
    ...rest,
  };
}

export const OATS_FOOD = food();
export const YOGURT_FOOD = food({
  id: 'food-yogurt',
  name: 'Greek yogurt',
  versionOverrides: {
    id: 'yogurt-food-v1',
    computedCalories: 70,
    proteinGrams: 10,
    carbohydrateGrams: 4,
    fatGrams: 2,
    declaredAllergens: ['Milk'],
  },
});

export function ingredient(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
  return {
    foodItemId: 'food-oats',
    foodItemVersionId: 'oats-food-v1',
    foodName: 'Rolled oats',
    foodProvenance: 'CoachAuthored',
    quantity: 80,
    unit: 'Gram',
    basis: 'AsSold',
    calories: 304,
    proteinGrams: 10.4,
    carbohydrateGrams: 54.4,
    fatGrams: 5.6,
    declaredAllergens: ['GlutenCereals'],
    yieldFactorId: null,
    retentionFactorId: null,
    ...overrides,
  };
}

export function recipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: 'recipe-oats',
    name: 'Overnight oats',
    currentRevision: 1,
    publishedVersionId: 'oats-v1',
    latest: {
      id: 'oats-v1',
      revision: 1,
      status: 'Published',
      publishedAtUtc: '2026-10-07T08:00:00Z',
      instructions: 'Stir everything together and chill overnight.',
      servings: 2,
      calories: 444,
      proteinGrams: 30.4,
      carbohydrateGrams: 62.4,
      fatGrams: 9.6,
      photoMediaAssetId: 'photo-1',
      declaredAllergens: ['GlutenCereals', 'Milk'],
      ingredients: [
        ingredient(),
        ingredient({
          foodItemId: 'food-yogurt',
          foodItemVersionId: 'yogurt-food-v1',
          foodName: 'Greek yogurt',
          quantity: 200,
          calories: 140,
          proteinGrams: 20,
          carbohydrateGrams: 8,
          fatGrams: 4,
          declaredAllergens: ['Milk'],
        }),
      ],
    },
    ...overrides,
  };
}

export function recipeSummary(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: 'recipe-oats',
    versionId: 'oats-v1',
    revision: 1,
    name: 'Overnight oats',
    status: 'Published',
    servings: 2,
    calories: 444,
    proteinGrams: 30.4,
    carbohydrateGrams: 62.4,
    fatGrams: 9.6,
    declaredAllergens: ['GlutenCereals', 'Milk'],
    photoMediaAssetId: 'photo-1',
    publishedVersionId: 'oats-v1',
    ...overrides,
  };
}
