import type { ClientPlanRecipeView } from '../app/core/api/generated';
import type { NutritionChoice } from '../app/features/nutrition/nutrition.models';

/**
 * A recipe as a client's plan copied it (R4.4d): overnight oats for two, with a line in each unit and
 * one weighed raw, and the breakfast option a client opens it from.
 */
export function planRecipeView(
  overrides: Partial<ClientPlanRecipeView> = {},
): ClientPlanRecipeView {
  return {
    id: 'plan-recipe-1',
    name: 'Overnight oats',
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 0,
    instructions: '1. Stir the oats into the milk.\n2. Chill overnight.',
    photoMediaAssetId: 'photo-1',
    ingredients: [
      { foodName: 'Rolled oats', quantity: 80, unit: 'Gram', basis: 'AsSold' },
      { foodName: 'Chicken breast', quantity: 150.5, unit: 'Gram', basis: 'Raw' },
      { foodName: 'Milk', quantity: 250, unit: 'Millilitre', basis: 'AsSold' },
      { foodName: 'Protein bar', quantity: 1, unit: 'Serving', basis: 'AsSold' },
    ],
    ...overrides,
  };
}

export const OATS_CHOICE: NutritionChoice = {
  id: 'choice-1',
  recipeName: 'Overnight oats',
  recipeId: 'plan-recipe-1',
  photoId: 'photo-1',
  servings: 1,
  calories: 431.6,
  protein: 30.2,
  carbohydrate: 45.4,
  fat: 12.1,
};
