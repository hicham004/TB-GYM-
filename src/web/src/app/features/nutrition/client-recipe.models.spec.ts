import { describe, expect, it } from 'vitest';
import {
  clientRecipe,
  methodSteps,
  minutesLabel,
  portionDigits,
  portionQuantity,
} from './client-recipe.models';
import { OATS_CHOICE, planRecipeView } from '../../../testing/client-recipe-fixtures';

describe('a recipe in the client’s plan (R4.4d)', () => {
  it('reads its times, yield, the client’s portion, lines and steps', () => {
    const recipe = clientRecipe(planRecipeView(), OATS_CHOICE, 'en-US');

    expect(recipe.facts).toEqual(['Prep 10 min', 'No cooking', 'Makes 2 servings']);
    expect(recipe.portion).toBe('Your plan: 1 serving · 432 kcal');
    expect(recipe.portionMacros).toBe('30 g protein · 45 g carbs · 12 g fat');
    // The client cooks their 1 serving of a recipe that makes 2: every amount is halved.
    expect(recipe.scaled).toBe(true);
    expect(recipe.notes).toEqual({
      portion: 'For your 1 serving. The method is for the whole recipe.',
      whole: 'For the whole recipe, 2 servings.',
    });
    expect(recipe.ingredients).toEqual([
      { name: 'Rolled oats', amounts: { whole: '80 g', portion: '40 g' }, basis: null },
      { name: 'Chicken breast', amounts: { whole: '150.5 g', portion: '75 g' }, basis: 'raw' },
      { name: 'Milk', amounts: { whole: '250 ml', portion: '125 ml' }, basis: null },
      {
        name: 'Protein bar',
        amounts: { whole: '1 serving', portion: '0.5 servings' },
        basis: null,
      },
    ]);
    // A food whose name already says how it is weighed is not told twice.
    const rice = clientRecipe(
      planRecipeView({
        ingredients: [{ foodName: 'Cooked rice', quantity: 180, unit: 'Gram', basis: 'Cooked' }],
      }),
      OATS_CHOICE,
      'en-US',
    );
    expect(rice.ingredients[0].basis).toBeNull();
    // A raw food weighed cooked (audit A16b) keeps its word unless the name says it as a word of its own.
    const weighed = clientRecipe(
      planRecipeView({
        ingredients: [
          { foodName: 'Quinoa, uncooked', quantity: 185, unit: 'Gram', basis: 'Cooked' },
          { foodName: 'Precooked lentils', quantity: 120, unit: 'Gram', basis: 'Cooked' },
          { foodName: 'Rice, pre-cooked', quantity: 150, unit: 'Gram', basis: 'Cooked' },
        ],
      }),
      OATS_CHOICE,
      'en-US',
    );
    expect(weighed.ingredients.map((line) => line.basis)).toEqual(['cooked', 'cooked', null]);
    expect(recipe.steps).toEqual(['Stir the oats into the milk.', 'Chill overnight.']);
    expect(recipe.photoId).toBe('photo-1');
  });

  it('leaves out a time the coach did not give and says a single serving plainly', () => {
    const recipe = clientRecipe(
      planRecipeView({ servings: 1, prepMinutes: null, cookMinutes: 45, photoMediaAssetId: null }),
      { ...OATS_CHOICE, servings: 1.5 },
      'en-US',
    );

    expect(recipe.facts).toEqual(['Cook 45 min', 'Makes 1 serving']);
    expect(recipe.portion).toBe('Your plan: 1.5 servings · 432 kcal');
    expect(recipe.notes).toEqual({
      portion: 'For your 1.5 servings. The method is for the whole recipe.',
      whole: 'For the whole recipe, one serving.',
    });
    expect(recipe.photoId).toBeNull();
  });

  it('lists the whole recipe alone when the client’s portion is all of it', () => {
    const recipe = clientRecipe(planRecipeView(), { ...OATS_CHOICE, servings: 2 }, 'en-US');

    expect(recipe.scaled).toBe(false);
    expect(recipe.notes.portion).toBe('For the whole recipe, 2 servings.');
    expect(recipe.ingredients.map((line) => line.amounts.portion)).toEqual([
      '80 g',
      '150.5 g',
      '250 ml',
      '1 serving',
    ]);
  });

  it('scales an amount by the portion’s share of the recipe and rounds it for a kitchen scale', () => {
    // Reference values: amount × the client's servings ÷ the servings the recipe makes.
    expect(portionQuantity(80, 1, 2)).toBe(40);
    expect(portionQuantity(150, 1.5, 4)).toBe(56.25);
    expect(portionQuantity(3, 1, 4)).toBe(0.75);
    // Whole grams or millilitres from 10, one decimal from 1, two below; servings keep two.
    expect(
      (
        [
          [56.25, 'Gram'],
          [10, 'Millilitre'],
          [2.5, 'Gram'],
          [0.75, 'Gram'],
          [0.33, 'Serving'],
          [12.5, 'Serving'],
        ] as const
      ).map(([quantity, unit]) => portionDigits(quantity, unit)),
    ).toEqual(['1.0-0', '1.0-0', '1.0-1', '1.0-2', '1.0-2', '1.0-2']);
    const salted = clientRecipe(
      planRecipeView({
        servings: 4,
        ingredients: [
          { foodName: 'Salt', quantity: 3, unit: 'Gram', basis: 'AsSold' },
          { foodName: 'Olive oil', quantity: 10, unit: 'Millilitre', basis: 'AsSold' },
          { foodName: 'Rice', quantity: 300, unit: 'Gram', basis: 'Raw' },
        ],
      }),
      { ...OATS_CHOICE, servings: 1 },
      'en-US',
    );
    expect(salted.ingredients.map((line) => line.amounts.portion)).toEqual([
      '0.75 g',
      '2.5 ml',
      '75 g',
    ]);
  });

  it('writes minutes as minutes and hours', () => {
    expect([0, 10, 60, 90, 480].map((minutes) => minutesLabel(minutes, 'en-US'))).toEqual([
      '0 min',
      '10 min',
      '1 h',
      '1 h 30 min',
      '8 h',
    ]);
  });

  it('numbers a method a line a step, and keeps a one-line method as written', () => {
    expect(methodSteps('1. Cook the rice.\n\n- Grill the chicken.\r\n3) Serve.')).toEqual([
      'Cook the rice.',
      'Grill the chicken.',
      'Serve.',
    ]);
    expect(methodSteps('  1. Cook the rice. 2. Grill the chicken.  ')).toEqual([
      '1. Cook the rice. 2. Grill the chicken.',
    ]);
  });
});
