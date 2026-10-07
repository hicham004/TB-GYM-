import type {
  FoodSearchResult,
  NutritionWorkspaceSettingsView,
  ProviderFoodSearchPage,
} from '../app/core/api/generated';
import { food, OATS_FOOD, YOGURT_FOOD } from './recipe-fixtures';

/**
 * Foods for the Foods page's specs (C7, R4.4c): the coach's own oats and yogurt from the recipe
 * fixtures, a chicken breast copied from USDA without its fibre, USDA's matches as the search returns
 * them, and the workspace's nutrition settings.
 */
export { OATS_FOOD, YOGURT_FOOD };

export const CHICKEN_FOOD = food({
  id: 'food-chicken',
  name: 'Chicken, breast, boneless, skinless, raw',
  provenance: 'UsdaFdc',
  externalId: '2646170',
  externalDataType: 'Foundation',
  versionOverrides: {
    id: 'chicken-food-v1',
    preparationBasis: 'Raw',
    computedCalories: 107.5,
    providerCalories: null,
    proteinGrams: 22.5,
    carbohydrateGrams: 0,
    fatGrams: 1.93,
    fibreGrams: 0,
    sourceAttribution: 'USDA FoodData Central',
    declaredAllergens: [],
    unreportedNutrients: ['Fibre', 'Polyols', 'Ethanol'],
  },
});

/** USDA lists this cut's carbohydrate at -0.42825 g; it is counted as 0 g (R4.4c). */
export const CHICKEN_SKIN_FOOD = food({
  id: 'food-chicken-skin',
  name: 'Chicken, breast, meat and skin, raw',
  provenance: 'UsdaFdc',
  externalId: '2727569',
  externalDataType: 'Foundation',
  versionOverrides: {
    id: 'chicken-skin-food-v1',
    preparationBasis: 'Raw',
    computedCalories: 128.618,
    providerCalories: 126.905,
    proteinGrams: 21.40625,
    carbohydrateGrams: 0,
    fatGrams: 4.777,
    fibreGrams: 0,
    sourceAttribution: 'USDA FoodData Central',
    declaredAllergens: [],
    unreportedNutrients: ['Fibre', 'Polyols', 'Ethanol'],
    reportedCarbohydrateGrams: -0.42825,
  },
});

export function usdaResult(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    externalId: '2646170',
    name: 'Chicken, breast, boneless, skinless, raw',
    dataType: 'Foundation',
    provider: 'UsdaFdc',
    brand: null,
    calories: 106,
    proteinGrams: 22.5,
    carbohydrateGrams: 0,
    fatGrams: 1.93,
    ...overrides,
  };
}

export const CHOBANI_RESULT = usdaResult({
  externalId: '2038865',
  name: 'Greek yogurt',
  dataType: 'Branded',
  brand: 'CHOBANI',
  calories: 80,
  proteinGrams: 8.67,
  carbohydrateGrams: 10.7,
  fatGrams: 0,
});

export function usdaPage(
  items: FoodSearchResult[],
  failure: Partial<ProviderFoodSearchPage> = {},
): ProviderFoodSearchPage {
  return { skip: 0, take: 20, items, failureCode: null, message: null, ...failure };
}

export function nutritionSettings(
  overrides: Partial<NutritionWorkspaceSettingsView> = {},
): NutritionWorkspaceSettingsView {
  return {
    energyPolicyKey: 'Atwater',
    energyPolicyVersion: '1.0',
    providerCalorieTolerance: 25,
    aiMonthlyRequestLimit: 50,
    aiMonthlyCostLimit: 2,
    aiCostCurrency: 'USD',
    version: 7,
    aiMaximumMonthlyRequests: 100,
    aiMaximumMonthlyCost: 3,
    ...overrides,
  };
}
