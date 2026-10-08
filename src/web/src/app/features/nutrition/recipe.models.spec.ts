import { describe, expect, it } from 'vitest';
import {
  OATS_FOOD,
  recipeDetail,
  recipeSummary,
  YOGURT_FOOD,
} from '../../../testing/recipe-fixtures';
import {
  allergenText,
  draftFromDetail,
  draftSignature,
  emptyDraft,
  energySplit,
  foodFromView,
  ingredientRequests,
  lineForFood,
  lineMacros,
  linesFromSuggestion,
  matchLine,
  perServing,
  readSuggestion,
  recipeAllergens,
  recipeCard,
  recipeProblem,
  recipeTotal,
  useNewerFood,
} from './recipe.models';

const OATS = foodFromView(OATS_FOOD);
const YOGURT = foodFromView(YOGURT_FOOD);

describe('recipe totals as typed', () => {
  it('scales a food from its own measure to the amount typed', () => {
    const line = { ...lineForFood(OATS), quantity: 50 };
    expect(lineMacros(line)).toEqual({ calories: 190, protein: 6.5, carbs: 34, fat: 3.5 });
  });

  it('counts nothing for a line with no food or no usable amount', () => {
    expect(lineMacros({ ...lineForFood(OATS), quantity: null })).toBeNull();
    expect(lineMacros({ ...lineForFood(OATS), quantity: 0 })).toBeNull();
    expect(
      lineMacros(
        linesFromSuggestion([{ name: 'oats', quantity: 80, unit: 'g', uncertain: false }])[0],
      ),
    ).toBeNull();
  });

  it('adds the lines up and divides by the servings', () => {
    const lines = [
      { ...lineForFood(OATS), quantity: 80 },
      { ...lineForFood(YOGURT), quantity: 200 },
    ];
    const total = recipeTotal(lines);
    expect(total.calories).toBeCloseTo(444);
    expect(total.protein).toBeCloseTo(30.4);
    expect(perServing(total, 2)?.calories).toBeCloseTo(222);
    expect(perServing(total, null)).toBeNull();
    expect(perServing(total, 0)).toBeNull();
  });

  it('starts an existing recipe from its saved lines, each its own measure', () => {
    const draft = draftFromDetail(recipeDetail());
    expect(draft.lines.map((line) => [line.food?.name, line.quantity])).toEqual([
      ['Rolled oats', 80],
      ['Greek yogurt', 200],
    ]);
    // Doubling the oats doubles what the saved oats line held.
    const doubled = { ...draft.lines[0], quantity: 160 };
    expect(lineMacros(doubled)?.calories).toBeCloseTo(608);
    expect(draft.photoId).toBe('photo-1');
    expect([draft.prepMinutes, draft.cookMinutes]).toEqual([null, null]);
    const timed = recipeDetail();
    timed.latest = { ...timed.latest, prepMinutes: 10, cookMinutes: 0 };
    expect([draftFromDetail(timed).prepMinutes, draftFromDetail(timed).cookMinutes]).toEqual([
      10, 0,
    ]);
  });

  it('offers a food edited since, and takes its numbers into the line on request', () => {
    const detail = recipeDetail();
    const [oats, yogurt] = detail.latest.ingredients;
    const edited = {
      ...YOGURT_FOOD,
      currentVersion: { ...YOGURT_FOOD.currentVersion, id: 'yogurt-food-v2', proteinGrams: 11 },
    };
    const perServing = {
      ...YOGURT_FOOD,
      currentVersion: { ...edited.currentVersion, basisQuantity: 1, basisUnit: 'Serving' as const },
    };
    const draft = draftFromDetail({
      ...detail,
      latest: {
        ...detail.latest,
        ingredients: [
          { ...oats, newerFood: perServing, yieldFactorId: 'yield-1' },
          { ...yogurt, newerFood: edited },
        ],
      },
    });

    // A line through cooking factors is the server's to work out, so it is not offered.
    expect(draft.lines.map((line) => line.newer?.versionId ?? null)).toEqual([
      null,
      'yogurt-food-v2',
    ]);
    const taken = useNewerFood(draft.lines[1]);
    expect([taken.food?.versionId, taken.quantity, taken.newer]).toEqual([
      'yogurt-food-v2',
      200,
      null,
    ]);
    expect(lineMacros(taken)?.protein).toBeCloseTo(22);
    expect(draftSignature({ ...draft, lines: [draft.lines[0], taken] })).not.toBe(
      draftSignature(draft),
    );

    // Measured in another unit now: the amount is typed again, never converted.
    const remeasured = useNewerFood({ ...draft.lines[1], newer: foodFromView(perServing) });
    expect(remeasured.quantity).toBeNull();
  });

  it('gives each macro its share of the calories it brings', () => {
    expect(energySplit({ calories: 400, protein: 30, carbs: 50, fat: 9 })).toEqual({
      protein: 30,
      carbs: 50,
      fat: 20,
    });
    expect(energySplit({ calories: 0, protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });

  it('names every allergen the chosen foods declare, once and in the usual order', () => {
    const lines = [lineForFood(YOGURT), lineForFood(OATS), lineForFood(YOGURT)];
    expect(recipeAllergens(lines)).toEqual(['GlutenCereals', 'Milk']);
    expect(allergenText(recipeAllergens(lines))).toBe('Contains gluten, milk');
    expect(allergenText([])).toBe('');
  });
});

describe('an AI suggestion', () => {
  const json = JSON.stringify({
    name: 'Oat bowl',
    ingredients: [
      { name: 'oats', quantity: 80, unit: 'g', uncertain: false },
      { name: 'milk', quantity: 1, unit: 'serving', uncertain: true },
    ],
  });

  it('reads the checked suggestion, and nothing from anything else', () => {
    expect(readSuggestion(json)?.ingredients.map((item) => item.name)).toEqual(['oats', 'milk']);
    expect(readSuggestion('{"unexpected":true}')).toBeNull();
    expect(readSuggestion('not json')).toBeNull();
    expect(readSuggestion(null)).toBeNull();
  });

  it('carries a suggested amount over only when it is in the chosen food’s unit', () => {
    const [oats, milk] = linesFromSuggestion(readSuggestion(json)!.ingredients);
    expect(matchLine(oats, OATS).quantity).toBe(80);
    // A serving of milk is not grams of yogurt: the food's own measure stands until the coach types.
    expect(matchLine(milk, YOGURT).quantity).toBe(100);
    expect(matchLine(milk, YOGURT).suggestion?.uncertain).toBe(true);
  });
});

describe('what stops a save', () => {
  const ready = () => ({
    ...emptyDraft(),
    name: 'Overnight oats',
    servings: 2,
    instructions: 'Stir and chill.',
    lines: [{ ...lineForFood(OATS), quantity: 80 }],
  });

  it('finds nothing in a complete recipe', () => {
    expect(recipeProblem(ready())).toBeNull();
  });

  it('reads the editor top to bottom: name, servings, ingredients, method', () => {
    expect(recipeProblem({ ...ready(), name: '  ' })?.field).toBe('name');
    expect(recipeProblem({ ...ready(), servings: 0 })?.field).toBe('servings');
    expect(recipeProblem({ ...ready(), servings: null })?.field).toBe('servings');
    expect(recipeProblem({ ...ready(), lines: [] })?.message).toBe('Add at least one ingredient.');
    expect(recipeProblem({ ...ready(), instructions: ' ' })?.field).toBe('instructions');
    expect(recipeProblem({ ...ready(), prepMinutes: -1 })?.field).toBe('prep');
    expect(recipeProblem({ ...ready(), cookMinutes: 12.5 })?.message).toBe(
      'Give the time in whole minutes, up to 2880 (two days).',
    );
    expect(recipeProblem({ ...ready(), cookMinutes: 2_881 })?.field).toBe('cook');
    expect(recipeProblem({ ...ready(), prepMinutes: 0, cookMinutes: 2_880 })).toBeNull();
  });

  it('names the ingredient at fault', () => {
    const suggested = linesFromSuggestion([
      { name: 'tahini', quantity: 15, unit: 'g', uncertain: false },
    ])[0];
    const unmatched = recipeProblem({ ...ready(), lines: [...ready().lines, suggested] });
    expect(unmatched).toEqual({
      field: 'lines',
      lineKey: suggested.key,
      message: 'Choose a food for “tahini”, or remove it.',
    });
    const empty = { ...lineForFood(YOGURT), quantity: null };
    expect(recipeProblem({ ...ready(), lines: [empty] })?.message).toBe(
      'Give “Greek yogurt” an amount above 0.',
    );
  });

  it('sends each line as its food version, amount, unit and basis', () => {
    expect(ingredientRequests(ready().lines)).toEqual([
      {
        foodItemVersionId: 'oats-food-v1',
        quantity: 80,
        unit: 'Gram',
        basis: 'AsSold',
        yieldFactorId: null,
        retentionFactorId: null,
      },
    ]);
  });

  it('sees a change only when something saved would change', () => {
    const draft = ready();
    expect(draftSignature({ ...draft, name: ' Overnight oats ' })).toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, photoId: 'photo-2' })).not.toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, prepMinutes: 5 })).not.toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, cookMinutes: 0 })).not.toBe(draftSignature(draft));
  });
});

describe('a recipe card', () => {
  it('shows one serving, its macros and shares, servings and allergens', () => {
    const card = recipeCard(recipeSummary(), 'en-US');
    expect(card.kcal).toBe('222 kcal a serving');
    expect(card.macros).toBe('P 15.2 g · C 31.2 g · F 4.8 g');
    expect(card.servings).toBe('2 servings');
    expect(card.allergens).toBe('Contains gluten, milk');
    expect(card.status).toBeNull();
    expect(card.photoId).toBe('photo-1');
  });

  it('marks a draft, and a published recipe with changes not published', () => {
    expect(
      recipeCard(recipeSummary({ status: 'Draft', publishedVersionId: null }), 'en-US').status,
    ).toEqual({
      label: 'Draft',
      tone: 'neutral',
    });
    expect(recipeCard(recipeSummary({ status: 'Draft' }), 'en-US').status).toEqual({
      label: 'Changes not published',
      tone: 'warm',
    });
  });
});
