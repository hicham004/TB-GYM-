import type {
  CookingConversionView,
  CookingFactorView,
  FoodItemView,
  RecipeIngredientView,
} from '../app/core/api/generated';
import type { Conversion } from '../app/features/nutrition/cooking-conversion.models';
import type { RecipeFood } from '../app/features/nutrition/recipe.models';
import { food, ingredient } from './recipe-fixtures';

/**
 * Raw-to-cooked conversions as the API answers them and as the recipe editor holds them (audit INV-6),
 * with a raw food to weigh cooked. The numbers are a coach's own, as TB Gym seeds none.
 */

function factor(
  id: string,
  kind: CookingFactorView['kind'],
  sourceKey: string,
  sourceVersion: string,
  value: number | string,
): CookingFactorView {
  return { id, kind, sourceKey, sourceVersion, fromBasis: 'Raw', toBasis: 'Cooked', factor: value };
}

/** A conversion as the list and the save answer it. */
export function conversionView(
  overrides: {
    id?: string;
    sourceKey?: string;
    sourceVersion?: string;
    yieldFactor?: number | string;
    retentionFactor?: number | string;
  } = {},
): CookingConversionView {
  const id = overrides.id ?? 'rice';
  const sourceKey = overrides.sourceKey ?? 'White rice, boiled';
  const sourceVersion = overrides.sourceVersion ?? 'USDA cooking yields, 2014';
  return {
    sourceKey,
    sourceVersion,
    yield: factor(`y-${id}`, 'Yield', sourceKey, sourceVersion, overrides.yieldFactor ?? 2.9),
    retention: factor(
      `r-${id}`,
      'Retention',
      sourceKey,
      sourceVersion,
      overrides.retentionFactor ?? 1,
    ),
  };
}

export const RICE_BOILED: Conversion = {
  yieldId: 'y-rice',
  retentionId: 'r-rice',
  yield: 2.9,
  retention: 1,
  name: 'White rice, boiled',
  source: 'USDA cooking yields, 2014',
};

/** Chicken loses weight cooking and some of its fat with it. */
export const CHICKEN_GRILLED: Conversion = {
  yieldId: 'y-chicken',
  retentionId: 'r-chicken',
  yield: 0.75,
  retention: 0.95,
  name: 'Chicken breast, grilled',
  source: 'Weighed in my kitchen',
};

/** Boiled rice in the coach's own numbers: it weighs 2.5 times its raw weight and keeps 90%. */
export const RICE_WEIGHED = conversionView({
  id: 'rice-weighed',
  sourceVersion: 'Weighed in my kitchen',
  yieldFactor: 2.5,
  retentionFactor: 0.9,
});

/** Raw rice as the food search, and a food's newer numbers, answer it. */
export const RAW_RICE_FOOD: FoodItemView = food({
  id: 'food-rice',
  name: 'White rice, raw',
  versionOverrides: {
    id: 'rice-v1',
    preparationBasis: 'Raw',
    computedCalories: 353,
    proteinGrams: 7,
    carbohydrateGrams: 80,
    fatGrams: 0.6,
    fibreGrams: 0,
    declaredAllergens: [],
  },
});

/**
 * Raw rice weighed cooked through `RICE_WEIGHED`, as the server reads the line back: 150 g cooked is 60 g
 * raw, of which 90% is kept, so 3.78 g protein, 43.2 g carbs, 0.324 g fat and 190.62 kcal.
 */
export function cookedRiceLine(
  overrides: Partial<RecipeIngredientView> = {},
): RecipeIngredientView {
  return ingredient({
    foodItemId: 'food-rice',
    foodItemVersionId: 'rice-v1',
    foodName: 'White rice, raw',
    quantity: 150,
    unit: 'Gram',
    basis: 'Cooked',
    calories: 190.62,
    proteinGrams: 3.78,
    carbohydrateGrams: 43.2,
    fatGrams: 0.324,
    declaredAllergens: [],
    yieldFactorId: RICE_WEIGHED.yield.id,
    retentionFactorId: RICE_WEIGHED.retention.id,
    yieldFactor: RICE_WEIGHED.yield,
    retentionFactor: RICE_WEIGHED.retention,
    ...overrides,
  });
}

/** The same rice weighed raw, 100 g, as a line saved before anyone weighed it cooked. */
export function rawRiceLine(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
  return ingredient({
    foodItemId: 'food-rice',
    foodItemVersionId: 'rice-v1',
    foodName: 'White rice, raw',
    quantity: 100,
    unit: 'Gram',
    basis: 'Raw',
    calories: 353,
    proteinGrams: 7,
    carbohydrateGrams: 80,
    fatGrams: 0.6,
    declaredAllergens: [],
    ...overrides,
  });
}

/** 100 g of raw rice: 7 g protein, 80 g carbs, 0.6 g fat, 353 kcal. */
export const RAW_RICE: RecipeFood = {
  foodId: 'food-rice',
  versionId: 'rice-v1',
  name: 'White rice, raw',
  source: 'CoachAuthored',
  basisQuantity: 100,
  unit: 'Gram',
  basis: 'Raw',
  calories: 353,
  protein: 7,
  carbs: 80,
  fat: 0.6,
  allergens: [],
};
